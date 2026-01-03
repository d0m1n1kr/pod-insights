use std::collections::HashMap;

use anyhow::{anyhow, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::cache::{
    load_episode_list_cached, load_episode_metadata_batch_cached, load_episode_topics_map_cached,
};
use crate::config::AppState as AppStateType;
use crate::cache::load_rag_index_cached;
use crate::rag::embeddings::embed_query;
use crate::utils::{dot, l2_norm};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodesSearchRequest {
    pub query: String,
    #[serde(default)]
    pub podcast_id: Option<String>,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodesLatestRequest {
    #[serde(default)]
    pub podcast_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodesSearchResponse {
    pub episodes: Vec<EpisodeSearchResult>,
    pub has_more: bool,
    pub total: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeSearchResult {
    pub episode_number: u32,
    pub title: String,
    pub date: Option<String>,
    pub duration_sec: Option<u32>,
    pub speakers: Vec<String>,
    pub description: Option<String>,
    pub score: f32,
    pub topics: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub positions_sec: Vec<f64>,
}

pub async fn episodes_search(
    State(st): State<AppStateType>,
    Json(req): Json<EpisodesSearchRequest>,
) -> impl IntoResponse {
    match episodes_search_impl(&st, req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => {
            tracing::error!("{:?}", e);
            let msg = format!("{}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response()
        }
    }
}

async fn episodes_search_impl(st: &AppStateType, req: EpisodesSearchRequest) -> Result<EpisodesSearchResponse> {
    use std::cmp::Ordering;
    
    let query = req.query.trim();
    if query.is_empty() {
        return Err(anyhow!("query must not be empty"));
    }

    let podcast_id = req.podcast_id.as_deref().unwrap_or("freakshow");
    let page_size = req.limit.unwrap_or(req.top_k.unwrap_or(10)).clamp(1, 50);
    let offset = req.offset.unwrap_or(0);
    
    // Load RAG database for this podcast (with caching)
    let rag = load_rag_index_cached(st, podcast_id).await?;
    
    // Get embedding for query
    let q = embed_query(st, query).await?;
    let qn = l2_norm(&q);
    if qn <= 0.0 {
        return Err(anyhow!("Query embedding norm is 0"));
    }

    // Score all items with parallel computation and early termination optimization
    // We need more than page_size to account for grouping by episode
    let keep_count = (offset + page_size) * 5;
    
    // Parallel computation of all scores
    let scored: Vec<(usize, f32)> = rag.items
        .par_iter()
        .enumerate()
        .filter_map(|(i, it)| {
            let v = it.embedding.as_ref()?;
            let dn = rag.norms[i];
            if dn <= 0.0 {
                return None;
            }
            let s = dot(&q, v) / (qn * dn);
            if s.is_finite() {
                Some((i, s))
            } else {
                None
            }
        })
        .collect();
    
    // Use partial sort to get top-K without sorting everything
    // This is faster than full sort when we only need top-K
    let mut scored = scored;
    if scored.len() > keep_count {
        // Use partial sort: sort only the top keep_count elements
        let (top_part, _, _) = scored.select_nth_unstable_by(keep_count - 1, |a, b| {
            b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal)
        });
        top_part.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        scored = top_part.to_vec();
    } else {
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
    }
    
    // Load episode topics map (with caching)
    let episode_topics_map = load_episode_topics_map_cached(st, podcast_id).await?;
    
    // Group by episode_number and get best score per episode
    // Also track multiple positions (start_sec) of matching items (top 3 per episode)
    let mut episode_data: HashMap<u32, (f32, Vec<(f64, f32)>)> = HashMap::new();
    
    // Take more items than page_size to ensure we have enough episodes after grouping
    // (since multiple items can belong to the same episode)
    for (idx, score) in scored.iter().take((offset + page_size) * 5) {
        let item = &rag.items[*idx];
        let ep_num = item.episode_number;
        
        // Track best score per episode and collect positions with their scores
        let entry = episode_data.entry(ep_num).or_insert_with(|| (*score, Vec::new()));
        if *score > entry.0 {
            entry.0 = *score;
        }
        
        // Collect positions with their scores
        entry.1.push((item.start_sec, *score));
    }
    
    // Sort positions by score and keep top 3 per episode, then extract just positions
    let mut episode_positions: HashMap<u32, Vec<f64>> = HashMap::new();
    for (ep_num, (_, positions_with_scores)) in &episode_data {
        let mut sorted_positions: Vec<(f64, f32)> = positions_with_scores.clone();
        // Sort by score descending
        sorted_positions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        // Take top 3, remove duplicates, and extract just positions
        let mut unique_positions = Vec::new();
        for (pos, _) in sorted_positions {
            if !unique_positions.contains(&pos) {
                unique_positions.push(pos);
                if unique_positions.len() >= 3 {
                    break;
                }
            }
        }
        episode_positions.insert(*ep_num, unique_positions);
    }
    
    // Convert to vector and sort by score
    let mut episode_results: Vec<(u32, f32, Vec<f64>)> = episode_data.into_iter()
        .map(|(ep_num, (score, _))| {
            let positions = episode_positions.get(&ep_num).cloned().unwrap_or_default();
            (ep_num, score, positions)
        })
        .collect();
    episode_results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
    
    let total = episode_results.len();
    let has_more = (offset + page_size) < total;
    
    // Apply pagination
    let paginated_results: Vec<(u32, f32, Vec<f64>)> = episode_results
        .into_iter()
        .skip(offset)
        .take(page_size)
        .collect();
    
    // Load episode metadata in parallel (batch loading with caching)
    let episode_numbers: Vec<u32> = paginated_results.iter().map(|(ep_num, _, _)| *ep_num).collect();
    let metadata_map = load_episode_metadata_batch_cached(st, podcast_id, &episode_numbers).await?;
    
    // Build results
    let mut results = Vec::new();
    for (ep_num, score, positions_sec) in paginated_results {
        let mut title = format!("Episode {}", ep_num);
        let mut date = None;
        let mut duration_sec = None;
        let mut description = None;
        let mut speakers = Vec::new();
        
        if let Some(meta) = metadata_map.get(&ep_num) {
            if let Some(t) = &meta.title {
                title = t.clone();
            }
            date = meta.date.clone();
            if let Some(dur) = &meta.duration {
                if dur.len() >= 3 {
                    duration_sec = Some(dur[0] * 3600 + dur[1] * 60 + dur[2]);
                }
            }
            description = meta.description.clone();
            if let Some(s) = &meta.speakers {
                speakers = s.clone();
            }
        }
        
        let topics: Vec<String> = episode_topics_map
            .get(&ep_num)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        
        results.push(EpisodeSearchResult {
            episode_number: ep_num,
            title,
            date,
            duration_sec,
            speakers,
            description,
            score,
            topics,
            positions_sec,
        });
    }
    
    Ok(EpisodesSearchResponse { 
        episodes: results,
        has_more,
        total: Some(total),
    })
}

pub async fn episodes_latest(
    State(st): State<AppStateType>,
    Json(req): Json<EpisodesLatestRequest>,
) -> impl IntoResponse {
    match episodes_latest_impl(&st, req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => {
            tracing::error!("{:?}", e);
            let msg = format!("{}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response()
        }
    }
}

async fn episodes_latest_impl(st: &AppStateType, req: EpisodesLatestRequest) -> Result<EpisodesSearchResponse> {
    let podcast_id = req.podcast_id.as_deref().unwrap_or("freakshow");
    let page_size = req.limit.unwrap_or(10).clamp(1, 50);
    let offset = req.offset.unwrap_or(0);
    
    // Load episode list (with caching)
    let episode_numbers = load_episode_list_cached(st, podcast_id).await?;
    
    let total = episode_numbers.len();
    let has_more = (offset + page_size) < total;
    
    // Apply pagination
    let paginated_episodes: Vec<u32> = episode_numbers
        .into_iter()
        .skip(offset)
        .take(page_size)
        .collect();
    
    // Load RAG database once to get topics for all episodes (with caching)
    let mut episode_topics_map: HashMap<u32, std::collections::HashSet<String>> = HashMap::new();
    if let Ok(rag) = load_rag_index_cached(st, podcast_id).await {
        for item in &rag.items {
            if let Some(topic) = &item.topic {
                episode_topics_map
                    .entry(item.episode_number)
                    .or_insert_with(std::collections::HashSet::new)
                    .insert(topic.clone());
            }
        }
    }
    
    // Load episode metadata in parallel (batch loading with caching)
    let metadata_map = load_episode_metadata_batch_cached(st, podcast_id, &paginated_episodes).await?;
    
    // Build results
    let mut results = Vec::new();
    for ep_num in paginated_episodes {
        let mut title = format!("Episode {}", ep_num);
        let mut date = None;
        let mut duration_sec = None;
        let mut description = None;
        let mut speakers = Vec::new();
        
        if let Some(meta) = metadata_map.get(&ep_num) {
            if let Some(t) = &meta.title {
                title = t.clone();
            }
            date = meta.date.clone();
            if let Some(dur) = &meta.duration {
                if dur.len() >= 3 {
                    duration_sec = Some(dur[0] * 3600 + dur[1] * 60 + dur[2]);
                }
            }
            description = meta.description.clone();
            if let Some(s) = &meta.speakers {
                speakers = s.clone();
            }
        }
        
        // Get topics from pre-loaded map
        let topics: Vec<String> = episode_topics_map
            .get(&ep_num)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        
        results.push(EpisodeSearchResult {
            episode_number: ep_num,
            title,
            date,
            duration_sec,
            speakers,
            description,
            score: 1.0, // No relevance score for latest episodes
            topics,
            positions_sec: Vec::new(), // No positions for latest episodes
        });
    }
    
    Ok(EpisodesSearchResponse { 
        episodes: results,
        has_more,
        total: Some(total),
    })
}

