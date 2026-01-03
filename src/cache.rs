use std::{collections::HashMap, path::Path, path::PathBuf, sync::Arc, time::SystemTime};

use anyhow::{anyhow, Context, Result};
use futures::future;
use serde::Deserialize;

use crate::config::AppState;
use crate::rag::RagIndex;

// Cache entry structures
#[derive(Clone)]
pub struct CachedRagIndex {
    pub rag: Arc<RagIndex>,
    pub loaded_at: SystemTime,
    pub file_path: PathBuf,
}

#[derive(Clone)]
pub struct CachedEpisodeMetadata {
    pub metadata: EpisodeMetadata,
    pub loaded_at: SystemTime,
}

#[derive(Clone)]
pub struct CachedEpisodeList {
    pub episode_numbers: Vec<u32>,
    pub loaded_at: SystemTime,
}

#[derive(Clone)]
pub struct CachedSpeakerProfile {
    pub content: String,
    pub loaded_at: SystemTime,
}

#[derive(Clone)]
pub struct CachedSpeakersIndex {
    pub speakers: Vec<SpeakerInfo>,
    pub loaded_at: SystemTime,
}

#[derive(Clone)]
pub struct CachedSpeakerMeta {
    pub meta: SpeakerMeta,
    pub loaded_at: SystemTime,
}

#[derive(Clone)]
pub struct CachedEpisodeTopicsMap {
    pub topics_map: HashMap<u32, std::collections::HashSet<String>>,
    pub loaded_at: SystemTime,
    pub rag_db_path: PathBuf,
}

// Types used in cache
#[derive(Debug, Deserialize, Clone)]
pub struct EpisodeMetadata {
    pub title: Option<String>,
    #[allow(dead_code)]
    pub number: Option<u32>,
    pub date: Option<String>,
    pub duration: Option<Vec<u32>>,
    pub description: Option<String>,
    pub speakers: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerInfo {
    pub speaker: String,
    pub slug: String,
    #[serde(default)]
    pub episodes_count: u32,
    #[serde(default)]
    pub utterances_count: u32,
    #[serde(default)]
    pub total_words: u32,
    #[serde(skip_deserializing, default)]
    pub has_profile: bool,
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SpeakerMeta {
    pub image: Option<String>,
}

// Helper functions
async fn get_file_mtime(path: &Path) -> Option<SystemTime> {
    tokio::fs::metadata(path)
        .await
        .ok()?
        .modified()
        .ok()
}

async fn is_cache_valid(cached_time: SystemTime, file_path: &Path) -> bool {
    if let Some(file_mtime) = get_file_mtime(file_path).await {
        file_mtime <= cached_time
    } else {
        // If we can't get file mtime, assume cache is invalid
        false
    }
}

// Cache loading functions
pub async fn load_rag_index_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<Arc<RagIndex>> {
    // Determine RAG database path
    let rag_db_path = PathBuf::from(format!("db/{}/rag-embeddings.json", podcast_id));
    let rag_db_path = if tokio::fs::metadata(&rag_db_path).await.is_ok() {
        rag_db_path
    } else {
        let fallback = PathBuf::from("db/rag-embeddings.json");
        if tokio::fs::metadata(&fallback).await.is_ok() {
            fallback
        } else {
            return Err(anyhow!("RAG database not found for podcast '{}'", podcast_id));
        }
    };

    // Check cache (moka handles TTL and LRU automatically)
    if let Some(cached) = st.rag_cache.get(podcast_id).await {
        if cached.file_path == rag_db_path && is_cache_valid(cached.loaded_at, &rag_db_path).await {
            return Ok(cached.rag.clone());
        }
    }

    // Load and cache - use streaming deserialization for large files
    // Open file directly in blocking task to enable true streaming
    let rag_db_path_for_cache = rag_db_path.clone();
    let rag_db_path_for_load = rag_db_path.clone();
    let display_path = rag_db_path_for_load.display().to_string();
    let rag = tokio::task::spawn_blocking(move || {
        RagIndex::load_from_path(&rag_db_path_for_load)
    }).await
        .with_context(|| "Failed to spawn blocking task")?
        .with_context(|| format!("Failed to parse RAG database: {}", display_path))?;
    
    let rag = Arc::new(rag);
    
    // Insert into cache
    st.rag_cache.insert(
        podcast_id.to_string(),
        CachedRagIndex {
            rag: rag.clone(),
            loaded_at: SystemTime::now(),
            file_path: rag_db_path_for_cache,
        }
    ).await;
    
    Ok(rag)
}

pub async fn load_episode_metadata_batch_cached(
    st: &AppState,
    podcast_id: &str,
    episode_numbers: &[u32],
) -> Result<HashMap<u32, EpisodeMetadata>> {
    let mut results = HashMap::new();
    
    // Create futures for all episodes
    let futures: Vec<_> = episode_numbers.iter()
        .map(|&ep_num| load_episode_metadata_cached(st, podcast_id, ep_num))
        .collect();
    
    // Execute all in parallel
    let metadata_results = future::join_all(futures).await;
    
    // Collect results
    for (ep_num, result) in episode_numbers.iter().zip(metadata_results) {
        if let Ok(Some(meta)) = result {
            results.insert(*ep_num, meta);
        }
    }
    
    Ok(results)
}

pub async fn load_episode_metadata_cached(
    st: &AppState,
    podcast_id: &str,
    episode_number: u32,
) -> Result<Option<EpisodeMetadata>> {
    let cache_key = (podcast_id.to_string(), episode_number);
    let ep_file = PathBuf::from(format!("podcasts/{}/episodes/{}.json", podcast_id, episode_number));
    
    // Check cache (moka handles TTL and LRU automatically)
    if let Some(cached) = st.episode_metadata_cache.get(&cache_key).await {
        if is_cache_valid(cached.loaded_at, &ep_file).await {
            return Ok(Some(cached.metadata.clone()));
        }
    }

    // Load and cache
    if tokio::fs::metadata(&ep_file).await.is_err() {
        return Ok(None);
    }

    // Use streaming deserialization for better memory efficiency
    let ep_file_clone = ep_file.clone();
    let metadata: EpisodeMetadata = tokio::task::spawn_blocking(move || {
        use serde_json::Deserializer;
        use std::fs::File;
        use std::io::BufReader;
        
        let file = File::open(&ep_file_clone)
            .with_context(|| format!("Failed to open {}", ep_file_clone.display()))?;
        let reader = BufReader::new(file);
        let mut deserializer = Deserializer::from_reader(reader);
        serde::Deserialize::deserialize(&mut deserializer)
            .with_context(|| format!("Failed to parse {}", ep_file_clone.display()))
    }).await
        .with_context(|| "Failed to spawn blocking task")??;

    // Insert into cache
    st.episode_metadata_cache.insert(
        cache_key,
        CachedEpisodeMetadata {
            metadata: metadata.clone(),
            loaded_at: SystemTime::now(),
        }
    ).await;

    Ok(Some(metadata))
}

pub async fn load_episode_list_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<Vec<u32>> {
    let episodes_dir = PathBuf::from(format!("podcasts/{}/episodes", podcast_id));
    
    // Check cache (use directory mtime for invalidation)
    if let Some(cached) = st.episode_list_cache.get(podcast_id).await {
        // Check if directory was modified (approximate check)
        if let Some(dir_mtime) = get_file_mtime(&episodes_dir).await {
            if dir_mtime <= cached.loaded_at {
                return Ok(cached.episode_numbers.clone());
            }
        }
    }

    // Scan directory using async I/O
    let mut episode_numbers = Vec::new();
    let mut entries = tokio::fs::read_dir(&episodes_dir).await
        .with_context(|| format!("Failed to read directory {}", episodes_dir.display()))?;
    
    while let Some(entry) = entries.next_entry().await
        .with_context(|| format!("Failed to read directory entry in {}", episodes_dir.display()))? {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if let Some(ep_num_str) = file_name.strip_suffix(".json") {
                    if ep_num_str.chars().all(|c| c.is_ascii_digit()) {
                        if let Ok(ep_num) = ep_num_str.parse::<u32>() {
                            episode_numbers.push(ep_num);
                        }
                    }
                }
            }
        }
    }
    
    episode_numbers.sort_by(|a, b| b.cmp(a));

    // Cache result
    st.episode_list_cache.insert(
        podcast_id.to_string(),
        CachedEpisodeList {
            episode_numbers: episode_numbers.clone(),
            loaded_at: SystemTime::now(),
        }
    ).await;

    Ok(episode_numbers)
}

pub async fn load_speaker_profile_cached(
    st: &AppState,
    podcast_id: &str,
    slug: &str,
) -> Result<String> {
    let cache_key = (podcast_id.to_string(), slug.to_string());
    let profile_path = PathBuf::from(format!("podcasts/{}/speakers/{}.md", podcast_id, slug));
    
    if tokio::fs::metadata(&profile_path).await.is_err() {
        return Err(anyhow!("Speaker profile not found: {}", slug));
    }

    // Check cache (moka handles TTL and LRU automatically)
    if let Some(cached) = st.speaker_profile_cache.get(&cache_key).await {
        if is_cache_valid(cached.loaded_at, &profile_path).await {
            return Ok(cached.content.clone());
        }
    }

    // Load and cache using async I/O
    let content = tokio::fs::read_to_string(&profile_path).await
        .with_context(|| format!("Failed to read profile {}", profile_path.display()))?;

    st.speaker_profile_cache.insert(
        cache_key,
        CachedSpeakerProfile {
            content: content.clone(),
            loaded_at: SystemTime::now(),
        }
    ).await;

    Ok(content)
}

pub async fn load_speakers_index_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<Vec<SpeakerInfo>> {
    let speakers_dir = PathBuf::from(format!("podcasts/{}/speakers", podcast_id));
    let index_path = speakers_dir.join("index.json");
    
    if tokio::fs::metadata(&index_path).await.is_err() {
        return Ok(Vec::new());
    }

    // Check cache (moka handles TTL and LRU automatically)
    if let Some(cached) = st.speakers_index_cache.get(podcast_id).await {
        if is_cache_valid(cached.loaded_at, &index_path).await {
            return Ok(cached.speakers.clone());
        }
    }

    // Load and cache
    let mut speakers = load_speakers_index(&speakers_dir).await?;
    
    // Load speaker meta data for each speaker (with caching)
    for speaker in &mut speakers {
        if let Ok(Some(meta)) = load_speaker_meta_cached(st, podcast_id, &speaker.slug).await {
            speaker.image = meta.image;
        }
    }

    st.speakers_index_cache.insert(
        podcast_id.to_string(),
        CachedSpeakersIndex {
            speakers: speakers.clone(),
            loaded_at: SystemTime::now(),
        }
    ).await;

    Ok(speakers)
}

pub async fn load_speaker_meta_cached(
    st: &AppState,
    podcast_id: &str,
    slug: &str,
) -> Result<Option<SpeakerMeta>> {
    let cache_key = (podcast_id.to_string(), slug.to_string());
    let meta_path = PathBuf::from(format!("podcasts/{}/speakers/{}-meta.json", podcast_id, slug));
    
    if tokio::fs::metadata(&meta_path).await.is_err() {
        return Ok(None);
    }

    // Check cache (moka handles TTL and LRU automatically)
    if let Some(cached) = st.speaker_meta_cache.get(&cache_key).await {
        if is_cache_valid(cached.loaded_at, &meta_path).await {
            return Ok(Some(cached.meta.clone()));
        }
    }

    // Use streaming deserialization
    let meta_path_clone = meta_path.clone();
    let meta: SpeakerMeta = tokio::task::spawn_blocking(move || {
        use serde_json::Deserializer;
        use std::fs::File;
        use std::io::BufReader;
        
        let file = File::open(&meta_path_clone)
            .with_context(|| format!("Failed to open {}", meta_path_clone.display()))?;
        let reader = BufReader::new(file);
        let mut deserializer = Deserializer::from_reader(reader);
        serde::Deserialize::deserialize(&mut deserializer)
            .with_context(|| format!("Failed to parse {}", meta_path_clone.display()))
    }).await
        .with_context(|| "Failed to spawn blocking task")??;

    st.speaker_meta_cache.insert(
        cache_key,
        CachedSpeakerMeta {
            meta: meta.clone(),
            loaded_at: SystemTime::now(),
        }
    ).await;

    Ok(Some(meta))
}

pub async fn load_episode_topics_map_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<HashMap<u32, std::collections::HashSet<String>>> {
    // Determine RAG database path
    let rag_db_path = PathBuf::from(format!("db/{}/rag-embeddings.json", podcast_id));
    let rag_db_path = if tokio::fs::metadata(&rag_db_path).await.is_ok() {
        rag_db_path
    } else {
        PathBuf::from("db/rag-embeddings.json")
    };

    if tokio::fs::metadata(&rag_db_path).await.is_err() {
        return Ok(HashMap::new());
    }

    // Check cache (moka handles TTL and LRU automatically)
    if let Some(cached) = st.episode_topics_map_cache.get(podcast_id).await {
        if cached.rag_db_path == rag_db_path && is_cache_valid(cached.loaded_at, &rag_db_path).await {
            return Ok(cached.topics_map.clone());
        }
    }

    // Load RAG database and build topics map
    let rag = load_rag_index_cached(st, podcast_id).await?;
    let mut topics_map: HashMap<u32, std::collections::HashSet<String>> = HashMap::new();
    
    for item in &rag.items {
        if let Some(topic) = &item.topic {
            topics_map
                .entry(item.episode_number)
                .or_insert_with(std::collections::HashSet::new)
                .insert(topic.clone());
        }
    }

    // Cache result
    st.episode_topics_map_cache.insert(
        podcast_id.to_string(),
        CachedEpisodeTopicsMap {
            topics_map: topics_map.clone(),
            loaded_at: SystemTime::now(),
            rag_db_path: rag_db_path.clone(),
        }
    ).await;

    Ok(topics_map)
}

pub async fn load_speakers_index(speakers_dir: &Path) -> Result<Vec<SpeakerInfo>> {
    let index_path = speakers_dir.join("index.json");
    if tokio::fs::metadata(&index_path).await.is_err() {
        return Ok(Vec::new());
    }
    
    // Use streaming deserialization
    let index_path_clone = index_path.clone();
    let mut speakers: Vec<SpeakerInfo> = tokio::task::spawn_blocking(move || {
        use serde_json::Deserializer;
        use std::fs::File;
        use std::io::BufReader;
        
        let file = File::open(&index_path_clone)
            .with_context(|| format!("Failed to open {}", index_path_clone.display()))?;
        let reader = BufReader::new(file);
        let mut deserializer = Deserializer::from_reader(reader);
        serde::Deserialize::deserialize(&mut deserializer)
            .with_context(|| format!("Failed to parse {}", index_path_clone.display()))
    }).await
        .with_context(|| "Failed to spawn blocking task")??;
    
    // Check for profile files using async I/O
    for speaker in &mut speakers {
        let profile_path = speakers_dir.join(format!("{}.md", speaker.slug));
        speaker.has_profile = tokio::fs::metadata(&profile_path).await.is_ok();
    }
    
    Ok(speakers)
}

