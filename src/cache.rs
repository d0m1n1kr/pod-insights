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
fn get_file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
}

fn is_cache_valid(cached_time: SystemTime, file_path: &Path) -> bool {
    if let Some(file_mtime) = get_file_mtime(file_path) {
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
    let rag_db_path = if rag_db_path.exists() {
        rag_db_path
    } else {
        let fallback = PathBuf::from("db/rag-embeddings.json");
        if fallback.exists() {
            fallback
        } else {
            return Err(anyhow!("RAG database not found for podcast '{}'", podcast_id));
        }
    };

    // Check cache
    {
        let cache = st.rag_cache.read().await;
        if let Some(cached) = cache.get(podcast_id) {
            if cached.file_path == rag_db_path && is_cache_valid(cached.loaded_at, &rag_db_path) {
                return Ok(cached.rag.clone());
            }
        }
    }

    // Load and cache
    let rag = Arc::new(RagIndex::load(&rag_db_path)
        .with_context(|| format!("Failed to load RAG database: {}", rag_db_path.display()))?);
    
    let mut cache = st.rag_cache.write().await;
    cache.insert(podcast_id.to_string(), CachedRagIndex {
        rag: rag.clone(),
        loaded_at: SystemTime::now(),
        file_path: rag_db_path,
    });
    
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
    
    // Check cache
    {
        let cache = st.episode_metadata_cache.read().await;
        if let Some(cached) = cache.get(&cache_key) {
            if is_cache_valid(cached.loaded_at, &ep_file) {
                return Ok(Some(cached.metadata.clone()));
            }
        }
    }

    // Load and cache
    if !ep_file.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(&ep_file)
        .with_context(|| format!("Failed to read {}", ep_file.display()))?;
    let metadata: EpisodeMetadata = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", ep_file.display()))?;

    let mut cache = st.episode_metadata_cache.write().await;
    cache.insert(cache_key, CachedEpisodeMetadata {
        metadata: metadata.clone(),
        loaded_at: SystemTime::now(),
    });

    Ok(Some(metadata))
}

pub async fn load_episode_list_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<Vec<u32>> {
    let episodes_dir = PathBuf::from(format!("podcasts/{}/episodes", podcast_id));
    
    // Check cache (use directory mtime for invalidation)
    {
        let cache = st.episode_list_cache.read().await;
        if let Some(cached) = cache.get(podcast_id) {
            // Check if directory was modified (approximate check)
            if let Some(dir_mtime) = get_file_mtime(&episodes_dir) {
                if dir_mtime <= cached.loaded_at {
                    return Ok(cached.episode_numbers.clone());
                }
            }
        }
    }

    // Scan directory
    let mut episode_numbers = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&episodes_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
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
        }
    }
    
    episode_numbers.sort_by(|a, b| b.cmp(a));

    // Cache result
    let mut cache = st.episode_list_cache.write().await;
    cache.insert(podcast_id.to_string(), CachedEpisodeList {
        episode_numbers: episode_numbers.clone(),
        loaded_at: SystemTime::now(),
    });

    Ok(episode_numbers)
}

pub async fn load_speaker_profile_cached(
    st: &AppState,
    podcast_id: &str,
    slug: &str,
) -> Result<String> {
    let cache_key = (podcast_id.to_string(), slug.to_string());
    let profile_path = PathBuf::from(format!("podcasts/{}/speakers/{}.md", podcast_id, slug));
    
    if !profile_path.exists() {
        return Err(anyhow!("Speaker profile not found: {}", slug));
    }

    // Check cache
    {
        let cache = st.speaker_profile_cache.read().await;
        if let Some(cached) = cache.get(&cache_key) {
            if is_cache_valid(cached.loaded_at, &profile_path) {
                return Ok(cached.content.clone());
            }
        }
    }

    // Load and cache
    let content = std::fs::read_to_string(&profile_path)
        .with_context(|| format!("Failed to read profile {}", profile_path.display()))?;

    let mut cache = st.speaker_profile_cache.write().await;
    cache.insert(cache_key, CachedSpeakerProfile {
        content: content.clone(),
        loaded_at: SystemTime::now(),
    });

    Ok(content)
}

pub async fn load_speakers_index_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<Vec<SpeakerInfo>> {
    let speakers_dir = PathBuf::from(format!("podcasts/{}/speakers", podcast_id));
    let index_path = speakers_dir.join("index.json");
    
    if !index_path.exists() {
        return Ok(Vec::new());
    }

    // Check cache
    {
        let cache = st.speakers_index_cache.read().await;
        if let Some(cached) = cache.get(podcast_id) {
            if is_cache_valid(cached.loaded_at, &index_path) {
                return Ok(cached.speakers.clone());
            }
        }
    }

    // Load and cache
    let mut speakers = load_speakers_index(&speakers_dir)?;
    
    // Load speaker meta data for each speaker (with caching)
    for speaker in &mut speakers {
        if let Ok(Some(meta)) = load_speaker_meta_cached(st, podcast_id, &speaker.slug).await {
            speaker.image = meta.image;
        }
    }

    let mut cache = st.speakers_index_cache.write().await;
    cache.insert(podcast_id.to_string(), CachedSpeakersIndex {
        speakers: speakers.clone(),
        loaded_at: SystemTime::now(),
    });

    Ok(speakers)
}

pub async fn load_speaker_meta_cached(
    st: &AppState,
    podcast_id: &str,
    slug: &str,
) -> Result<Option<SpeakerMeta>> {
    let cache_key = (podcast_id.to_string(), slug.to_string());
    let meta_path = PathBuf::from(format!("podcasts/{}/speakers/{}-meta.json", podcast_id, slug));
    
    if !meta_path.exists() {
        return Ok(None);
    }

    // Check cache
    {
        let cache = st.speaker_meta_cache.read().await;
        if let Some(cached) = cache.get(&cache_key) {
            if is_cache_valid(cached.loaded_at, &meta_path) {
                return Ok(Some(cached.meta.clone()));
            }
        }
    }

    // Load and cache
    let bytes = std::fs::read(&meta_path)
        .with_context(|| format!("Failed to read {}", meta_path.display()))?;
    let meta: SpeakerMeta = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", meta_path.display()))?;

    let mut cache = st.speaker_meta_cache.write().await;
    cache.insert(cache_key, CachedSpeakerMeta {
        meta: meta.clone(),
        loaded_at: SystemTime::now(),
    });

    Ok(Some(meta))
}

pub async fn load_episode_topics_map_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<HashMap<u32, std::collections::HashSet<String>>> {
    // Determine RAG database path
    let rag_db_path = PathBuf::from(format!("db/{}/rag-embeddings.json", podcast_id));
    let rag_db_path = if rag_db_path.exists() {
        rag_db_path
    } else {
        PathBuf::from("db/rag-embeddings.json")
    };

    if !rag_db_path.exists() {
        return Ok(HashMap::new());
    }

    // Check cache
    {
        let cache = st.episode_topics_map_cache.read().await;
        if let Some(cached) = cache.get(podcast_id) {
            if cached.rag_db_path == rag_db_path && is_cache_valid(cached.loaded_at, &rag_db_path) {
                return Ok(cached.topics_map.clone());
            }
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
    let mut cache = st.episode_topics_map_cache.write().await;
    cache.insert(podcast_id.to_string(), CachedEpisodeTopicsMap {
        topics_map: topics_map.clone(),
        loaded_at: SystemTime::now(),
        rag_db_path: rag_db_path.clone(),
    });

    Ok(topics_map)
}

pub fn load_speakers_index(speakers_dir: &Path) -> Result<Vec<SpeakerInfo>> {
    let index_path = speakers_dir.join("index.json");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&index_path)
        .with_context(|| format!("Failed to read {}", index_path.display()))?;
    let mut speakers: Vec<SpeakerInfo> = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", index_path.display()))?;
    
    // Check for profile files
    for speaker in &mut speakers {
        let profile_path = speakers_dir.join(format!("{}.md", speaker.slug));
        speaker.has_profile = profile_path.exists();
    }
    
    Ok(speakers)
}

