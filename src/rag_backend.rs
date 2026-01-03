use std::{
    cmp::Ordering,
    collections::HashMap,
    io,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::SystemTime,
};

use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use futures::future;
use rayon::prelude::*;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Deserialize, Clone)]
struct SettingsFile {
    llm: Option<LlmSettings>,
    #[serde(rename = "topicClustering")]
    topic_clustering: Option<TopicClusteringSettings>,
    rag: Option<RagSettings>,
}

#[derive(Debug, Deserialize, Clone)]
struct LlmSettings {
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TopicClusteringSettings {
    #[serde(rename = "embeddingModel")]
    embedding_model: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct RagSettings {
    #[serde(rename = "authToken")]
    auth_token: Option<String>,
    #[serde(rename = "bindAddr")]
    bind_addr: Option<String>,
}

fn try_read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).with_context(|| format!("Failed to read {}", path.display()))?;
    let parsed: T = serde_json::from_slice(&bytes).with_context(|| format!("Failed to parse {}", path.display()))?;
    Ok(Some(parsed))
}

fn load_settings() -> Result<(Option<SettingsFile>, String)> {
    // Prefer settings.json, fall back to settings.example.json (but still require non-placeholder API key unless env overrides)
    let settings_path = PathBuf::from("settings.json");
    if let Some(s) = try_read_json::<SettingsFile>(&settings_path)? {
        return Ok((Some(s), "settings.json".to_string()));
    }

    let example_path = PathBuf::from("settings.example.json");
    if let Some(s) = try_read_json::<SettingsFile>(&example_path)? {
        return Ok((Some(s), "settings.example.json".to_string()));
    }

    Ok((None, "env".to_string()))
}

#[derive(Clone, Debug)]
struct AppConfig {
    bind_addr: SocketAddr,
    rag_db_path: PathBuf,
    episodes_dir: PathBuf,
    speakers_dir: PathBuf,
    llm_base_url: String,
    llm_api_key: String,
    llm_model: String,
    embedding_model: String,
    top_k: usize,
    max_context_chars: usize,
    auth_token: Option<String>,
}

impl AppConfig {
    fn from_env_and_settings() -> Result<(Self, String)> {
        let (settings, settings_source) = load_settings()?;

        let rag_db_path = PathBuf::from(
            std::env::var("RAG_DB_PATH").unwrap_or_else(|_| "db/rag-embeddings.json".to_string()),
        );
        // Default podcast ID, can be overridden via PODCAST_ID env var
        let podcast_id = std::env::var("PODCAST_ID").unwrap_or_else(|_| "freakshow".to_string());
        let episodes_dir = PathBuf::from(
            std::env::var("EPISODES_DIR")
                .unwrap_or_else(|_| format!("podcasts/{}/episodes", podcast_id)),
        );
        let speakers_dir = PathBuf::from(
            std::env::var("SPEAKERS_DIR")
                .unwrap_or_else(|_| format!("podcasts/{}/speakers", podcast_id)),
        );

        // Resolve from settings first, then allow env override.
        let settings_llm = settings.as_ref().and_then(|s| s.llm.as_ref());
        let settings_cluster = settings.as_ref().and_then(|s| s.topic_clustering.as_ref());
        let settings_rag = settings.as_ref().and_then(|s| s.rag.as_ref());

        let bind_addr_s = std::env::var("RAG_BIND_ADDR")
            .ok()
            .or_else(|| settings_rag.and_then(|r| r.bind_addr.clone()))
            .unwrap_or_else(|| "127.0.0.1:7878".to_string());

        let bind_addr: SocketAddr = bind_addr_s
            .parse()
            .with_context(|| format!("Invalid RAG bind address '{bind_addr_s}' (expected host:port)"))?;

        let llm_base_url = std::env::var("LLM_BASE_URL")
            .ok()
            .or_else(|| settings_llm.and_then(|l| l.base_url.clone()))
            .ok_or_else(|| anyhow!("Missing LLM base URL (set LLM_BASE_URL or settings.json: llm.baseURL)"))?;

        let llm_api_key = std::env::var("LLM_API_KEY")
            .ok()
            .or_else(|| settings_llm.and_then(|l| l.api_key.clone()))
            .ok_or_else(|| anyhow!("Missing LLM API key (set LLM_API_KEY or settings.json: llm.apiKey)"))?;

        if llm_api_key.trim().is_empty() || llm_api_key == "YOUR_API_KEY_HERE" {
            return Err(anyhow!(
                "LLM API key is missing/placeholder (set LLM_API_KEY or update settings.json: llm.apiKey)"
            ));
        }

        let llm_model = std::env::var("LLM_MODEL")
            .ok()
            .or_else(|| settings_llm.and_then(|l| l.model.clone()))
            .unwrap_or_else(|| "gpt-4o-mini".to_string());

        let embedding_model = std::env::var("EMBEDDING_MODEL")
            .ok()
            .or_else(|| settings_cluster.and_then(|c| c.embedding_model.clone()))
            .unwrap_or_else(|| "text-embedding-3-small".to_string());

        let top_k = std::env::var("RAG_TOP_K")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(6);

        let max_context_chars = std::env::var("RAG_MAX_CONTEXT_CHARS")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(24_000);

        let auth_token = std::env::var("RAG_AUTH_TOKEN")
            .ok()
            .or_else(|| settings_rag.and_then(|r| r.auth_token.clone()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok((
            Self {
            bind_addr,
            rag_db_path,
            episodes_dir,
            speakers_dir,
            llm_base_url: llm_base_url.trim_end_matches('/').to_string(),
            llm_api_key,
            llm_model,
            embedding_model,
            top_k,
            max_context_chars,
            auth_token,
            },
            settings_source,
        ))
    }
}

// Cache entry with timestamp for invalidation
#[derive(Clone)]
struct CachedRagIndex {
    rag: Arc<RagIndex>,
    loaded_at: SystemTime,
    file_path: PathBuf,
}

#[derive(Clone)]
struct CachedEpisodeMetadata {
    metadata: EpisodeMetadata,
    loaded_at: SystemTime,
}

#[derive(Clone)]
struct CachedEpisodeList {
    episode_numbers: Vec<u32>,
    loaded_at: SystemTime,
}

#[derive(Clone)]
struct CachedSpeakerProfile {
    content: String,
    loaded_at: SystemTime,
}

#[derive(Clone)]
struct CachedSpeakersIndex {
    speakers: Vec<SpeakerInfo>,
    loaded_at: SystemTime,
}

#[derive(Clone)]
struct CachedSpeakerMeta {
    meta: SpeakerMeta,
    loaded_at: SystemTime,
}

#[derive(Clone)]
struct CachedEpisodeTopicsMap {
    topics_map: std::collections::HashMap<u32, std::collections::HashSet<String>>,
    loaded_at: SystemTime,
    rag_db_path: PathBuf,
}

#[derive(Clone)]
struct AppState {
    cfg: AppConfig,
    http: Client,
    rag: Arc<RagIndex>,
    // Cache transcript entries per (podcast_id, episode_number). Needed for multi-podcast support.
    transcript_cache: Arc<RwLock<HashMap<(String, u32), Arc<Vec<TranscriptEntry>>>>>,
    // Cache RAG databases per podcast_id
    rag_cache: Arc<RwLock<HashMap<String, CachedRagIndex>>>,
    // Cache episode metadata per (podcast_id, episode_number)
    episode_metadata_cache: Arc<RwLock<HashMap<(String, u32), CachedEpisodeMetadata>>>,
    // Cache episode lists per podcast_id
    episode_list_cache: Arc<RwLock<HashMap<String, CachedEpisodeList>>>,
    // Cache speaker profiles per (podcast_id, slug)
    speaker_profile_cache: Arc<RwLock<HashMap<(String, String), CachedSpeakerProfile>>>,
    // Cache speakers index per podcast_id
    speakers_index_cache: Arc<RwLock<HashMap<String, CachedSpeakersIndex>>>,
    // Cache speaker meta data per (podcast_id, slug)
    speaker_meta_cache: Arc<RwLock<HashMap<(String, String), CachedSpeakerMeta>>>,
    // Cache episode topics map per podcast_id
    episode_topics_map_cache: Arc<RwLock<HashMap<String, CachedEpisodeTopicsMap>>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse()?))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let (cfg, settings_source) = AppConfig::from_env_and_settings()?;
    info!("Settings source: {}", settings_source);
    info!("Loading RAG DB: {}", cfg.rag_db_path.display());
    let rag = RagIndex::load(&cfg.rag_db_path)?;
    info!("RAG items: {}", rag.items.len());

    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("*"))
        .allow_methods([Method::POST, Method::GET, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-auth-token"),
        ]);

    // Configure HTTP client with connection pooling
    let http = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .pool_max_idle_per_host(10)
        .build()
        .context("Failed to create HTTP client")?;

    let app_state = AppState {
        cfg: cfg.clone(),
        http,
        rag: Arc::new(rag),
        transcript_cache: Arc::new(RwLock::new(HashMap::new())),
        rag_cache: Arc::new(RwLock::new(HashMap::new())),
        episode_metadata_cache: Arc::new(RwLock::new(HashMap::new())),
        episode_list_cache: Arc::new(RwLock::new(HashMap::new())),
        speaker_profile_cache: Arc::new(RwLock::new(HashMap::new())),
        speakers_index_cache: Arc::new(RwLock::new(HashMap::new())),
        speaker_meta_cache: Arc::new(RwLock::new(HashMap::new())),
        episode_topics_map_cache: Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/api/chat", post(chat))
        .route("/api/episodes/search", post(episodes_search))
        .route("/api/episodes/latest", post(episodes_latest))
        .route("/api/speakers", axum::routing::get(speakers_list))
        .route("/api/health", axum::routing::get(health))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    info!("RAG backend listening on http://{}", cfg.bind_addr);
    let listener = tokio::net::TcpListener::bind(cfg.bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
struct SpeakerInfo {
    speaker: String,
    slug: String,
    episodes_count: u32,
    utterances_count: u32,
    total_words: u32,
    #[serde(skip_deserializing, default)]
    has_profile: bool,
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    image: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct SpeakerMeta {
    image: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakersListResponse {
    speakers: Vec<SpeakerInfo>,
}

async fn speakers_list(
    State(st): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    // Get podcast_id from query parameter or use default
    let podcast_id = params.get("podcast_id").map(|s| s.as_str()).unwrap_or("freakshow");
    
    match load_speakers_index_cached(&st, podcast_id).await {
        Ok(speakers) => (StatusCode::OK, Json(SpeakersListResponse { speakers })).into_response(),
        Err(e) => {
            error!("Failed to load speakers: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to load speakers: {}", e) })),
            )
                .into_response()
        }
    }
}

// Helper function to get file modification time
fn get_file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
}

// Helper function to check if cache entry is still valid (file hasn't changed)
fn is_cache_valid(cached_time: SystemTime, file_path: &Path) -> bool {
    if let Some(file_mtime) = get_file_mtime(file_path) {
        file_mtime <= cached_time
    } else {
        // If we can't get file mtime, assume cache is invalid
        false
    }
}

// Load RAG index with caching
async fn load_rag_index_cached(
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

// Load episode metadata batch with caching (parallel)
async fn load_episode_metadata_batch_cached(
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

// Load episode metadata with caching
async fn load_episode_metadata_cached(
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

// Load episode list with caching
async fn load_episode_list_cached(
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

// Load speaker profile with caching
async fn load_speaker_profile_cached(
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

// Load speakers index with caching
async fn load_speakers_index_cached(
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

// Load speaker meta data with caching
async fn load_speaker_meta_cached(
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

// Load episode topics map with caching
async fn load_episode_topics_map_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<std::collections::HashMap<u32, std::collections::HashSet<String>>> {
    // Determine RAG database path
    let rag_db_path = PathBuf::from(format!("db/{}/rag-embeddings.json", podcast_id));
    let rag_db_path = if rag_db_path.exists() {
        rag_db_path
    } else {
        PathBuf::from("db/rag-embeddings.json")
    };

    if !rag_db_path.exists() {
        return Ok(std::collections::HashMap::new());
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
    let mut topics_map: std::collections::HashMap<u32, std::collections::HashSet<String>> = std::collections::HashMap::new();
    
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

fn load_speakers_index(speakers_dir: &Path) -> Result<Vec<SpeakerInfo>> {
    let index_path = speakers_dir.join("index.json");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&index_path)
        .with_context(|| format!("Failed to read {}", index_path.display()))?;
    let mut speakers: Vec<SpeakerInfo> = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", index_path.display()))?;
    
    // Check which speakers have profile markdown files and load image URLs from meta files
    for speaker in &mut speakers {
        let profile_path = speakers_dir.join(format!("{}.md", speaker.slug));
        speaker.has_profile = profile_path.exists();
        
        // Try to load image from meta file
        let meta_path = speakers_dir.join(format!("{}-meta.json", speaker.slug));
        if meta_path.exists() {
            if let Ok(meta_bytes) = std::fs::read(&meta_path) {
                if let Ok(meta) = serde_json::from_slice::<SpeakerMeta>(&meta_bytes) {
                    speaker.image = meta.image;
                }
            }
        }
        
        info!("Speaker '{}' (slug: {}): profile at {} exists = {}, image = {:?}", 
              speaker.speaker, speaker.slug, profile_path.display(), speaker.has_profile, speaker.image);
    }
    
    Ok(speakers)
}

fn load_speaker_profile(speakers_dir: &Path, slug: &str) -> Result<String> {
    let profile_path = speakers_dir.join(format!("{}.md", slug));
    if !profile_path.exists() {
        return Err(anyhow!("Speaker profile not found: {}", slug));
    }
    let content = std::fs::read_to_string(&profile_path)
        .with_context(|| format!("Failed to read profile {}", profile_path.display()))?;
    Ok(content)
}

fn get_speaker_name_from_slug(speakers_dir: &Path, slug: &str) -> Result<String> {
    let index = load_speakers_index(speakers_dir)?;
    for speaker in index {
        if speaker.slug == slug {
            return Ok(speaker.speaker);
        }
    }
    Err(anyhow!("Speaker not found: {}", slug))
}

fn extract_auth_token(headers: &HeaderMap) -> Option<String> {
    // Prefer explicit x-auth-token, but also accept Authorization: Bearer <token>
    if let Some(v) = headers.get("x-auth-token").and_then(|v| v.to_str().ok()) {
        let t = v.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }

    if let Some(v) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let s = v.trim();
        if let Some(rest) = s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")) {
            let t = rest.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }

    None
}

fn is_auth_ok(cfg: &AppConfig, headers: &HeaderMap) -> bool {
    let Some(expected) = cfg.auth_token.as_ref() else {
        // No auth configured => allow.
        return true;
    };
    let Some(got) = extract_auth_token(headers) else {
        return false;
    };
    got == *expected
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    query: String,
    #[serde(default)]
    top_k: Option<usize>,
    #[serde(default)]
    speaker_slug: Option<String>,
    #[serde(default)]
    speaker_slug2: Option<String>,
    #[serde(default)]
    podcast_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatResponse {
    answer: String,
    sources: Vec<ChatSource>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatSource {
    episode_number: u32,
    episode_title: Option<String>,
    start_sec: f64,
    end_sec: f64,
    start_hms: Option<String>,
    end_hms: Option<String>,
    score: f32,
    topic: Option<String>,
    subject_coarse: Option<String>,
    subject_fine: Option<String>,
    excerpt: String,
}

async fn chat(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    if !is_auth_ok(&st.cfg, &headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "permission denied" })),
        )
            .into_response();
    }
    match chat_impl(&st, req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => {
            error!("{:?}", e);
            let msg = format!("{}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response()
        }
    }
}

async fn chat_impl(st: &AppState, req: ChatRequest) -> Result<ChatResponse> {
    let query = req.query.trim();
    if query.is_empty() {
        return Err(anyhow!("query must not be empty"));
    }

    // Determine podcast ID from request or use default
    let podcast_id = req.podcast_id.as_deref().unwrap_or("freakshow");
    
    // Load RAG database for this podcast (with caching)
    let rag = load_rag_index_cached(st, podcast_id).await?;
    
    // Use podcast-specific episodes directory
    let episodes_dir = PathBuf::from(format!("podcasts/{}/episodes", podcast_id));

    let top_k = req.top_k.unwrap_or(st.cfg.top_k).clamp(1, 20);

    // Get speaker name from slug if requested (using cached speakers index)
    let speaker_name = if let Some(slug) = req.speaker_slug.as_ref() {
        load_speakers_index_cached(st, podcast_id).await.ok()
            .and_then(|speakers| speakers.iter().find(|s| s.slug == *slug).map(|s| s.speaker.clone()))
    } else {
        None
    };
    
    // Get second speaker name from slug if requested (discussion mode)
    let speaker2_name = if let Some(slug) = req.speaker_slug2.as_ref() {
        load_speakers_index_cached(st, podcast_id).await.ok()
            .and_then(|speakers| speakers.iter().find(|s| s.slug == *slug).map(|s| s.speaker.clone()))
    } else {
        None
    };

    // Load speaker profile if requested (with caching)
    let speaker_profile = if let Some(slug) = req.speaker_slug.as_ref() {
        load_speaker_profile_cached(st, podcast_id, slug).await.ok()
    } else {
        None
    };
    
    // Load second speaker profile if requested (discussion mode, with caching)
    let speaker2_profile = if let Some(slug) = req.speaker_slug2.as_ref() {
        load_speaker_profile_cached(st, podcast_id, slug).await.ok()
    } else {
        None
    };

    // 1) Retrieve - get more results if we need to filter by speaker
    let search_k = if speaker_name.is_some() || speaker2_name.is_some() {
        top_k * 3
    } else {
        top_k
    };
    let hits = retrieve(st, &rag, query, search_k).await?;

    // 2) Build context from transcripts
    let mut sources: Vec<ChatSource> = Vec::with_capacity(hits.len());
    let mut context_parts: Vec<String> = Vec::with_capacity(hits.len());

    for h in hits {
        let transcript =
            load_transcript_entries(st, podcast_id, &episodes_dir, h.item.episode_number).await?;

        // If discussion mode is active (two speakers), build per-speaker excerpts so each position
        // is grounded in that speaker's actual transcript lines.
        let (excerpt, should_skip) = if let (Some(name1), Some(name2)) =
            (speaker_name.as_deref(), speaker2_name.as_deref())
        {
            let ex1 = excerpt_for_window(
                &transcript,
                h.item.start_sec,
                h.item.end_sec,
                2200,
                Some(name1),
            );
            let ex2 = excerpt_for_window(
                &transcript,
                h.item.start_sec,
                h.item.end_sec,
                2200,
                Some(name2),
            );

            let empty1 = ex1.contains("[no transcript entries found");
            let empty2 = ex2.contains("[no transcript entries found");

            let combined = format!("{name1}:\n{ex1}\n\n{name2}:\n{ex2}");
            (combined, empty1 && empty2)
        } else {
            let ex = excerpt_for_window(
                &transcript,
                h.item.start_sec,
                h.item.end_sec,
                4000,
                speaker_name.as_deref(),
            );
            // Skip empty excerpts when filtering by a single speaker
            let should_skip = speaker_name.is_some() && ex.contains("[no transcript entries found");
            (ex, should_skip)
        };

        if should_skip {
            continue;
        }

        let ep = h.item.episode_number;
        let start = h
            .item
            .start_hms
            .clone()
            .unwrap_or_else(|| seconds_to_hms(h.item.start_sec));
        let end = h
            .item
            .end_hms
            .clone()
            .unwrap_or_else(|| seconds_to_hms(h.item.end_sec));
        let topic = h.item.topic.clone().filter(|s| !s.trim().is_empty());

        context_parts.push(format!(
            "SOURCE: Episode {ep} ({start} - {end}){}\n{excerpt}\n",
            topic
                .as_ref()
                .map(|t| format!(" | Topic: {t}"))
                .unwrap_or_default()
        ));

        sources.push(ChatSource {
            episode_number: h.item.episode_number,
            episode_title: h
                .item
                .episode_title
                .clone()
                .filter(|s| !s.trim().is_empty()),
            start_sec: h.item.start_sec,
            end_sec: h.item.end_sec,
            start_hms: h.item.start_hms.clone(),
            end_hms: h.item.end_hms.clone(),
            score: h.score,
            topic,
            subject_coarse: h.item.subject.as_ref().and_then(|s| s.coarse.clone()),
            subject_fine: h.item.subject.as_ref().and_then(|s| s.fine.clone()),
            excerpt,
        });

        // Stop when we have enough sources
        if sources.len() >= top_k {
            break;
        }
    }

    // Keep prompt bounded.
    let mut context = context_parts.join("\n");
    if context.len() > st.cfg.max_context_chars {
        // Truncate at a valid UTF-8 char boundary
        let mut truncate_pos = st.cfg.max_context_chars;
        while truncate_pos > 0 && !context.is_char_boundary(truncate_pos) {
            truncate_pos -= 1;
        }
        context.truncate(truncate_pos);
        context.push_str("\n\n[context truncated]\n");
    }

    // 3) Ask LLM
    let answer = llm_answer(
        st, 
        query, 
        &context, 
        speaker_profile.as_deref(),
        speaker2_profile.as_deref(),
        speaker_name.as_deref(),
        speaker2_name.as_deref(),
    ).await?;

    Ok(ChatResponse { answer, sources })
}

// ------------------------ Episode Search ------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpisodesSearchRequest {
    query: String,
    #[serde(default)]
    podcast_id: Option<String>,
    #[serde(default)]
    top_k: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpisodesLatestRequest {
    #[serde(default)]
    podcast_id: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EpisodesSearchResponse {
    episodes: Vec<EpisodeSearchResult>,
    has_more: bool,
    total: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EpisodeSearchResult {
    episode_number: u32,
    title: String,
    date: Option<String>,
    duration_sec: Option<u32>,
    speakers: Vec<String>,
    description: Option<String>,
    score: f32,
    topics: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    positions_sec: Vec<f64>,
}

#[derive(Debug, Deserialize, Clone)]
struct EpisodeMetadata {
    title: Option<String>,
    number: Option<u32>,
    date: Option<String>,
    duration: Option<Vec<u32>>,
    description: Option<String>,
    speakers: Option<Vec<String>>,
}

async fn episodes_search(
    State(st): State<AppState>,
    Json(req): Json<EpisodesSearchRequest>,
) -> impl IntoResponse {
    match episodes_search_impl(&st, req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => {
            error!("{:?}", e);
            let msg = format!("{}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response()
        }
    }
}

async fn episodes_search_impl(st: &AppState, req: EpisodesSearchRequest) -> Result<EpisodesSearchResponse> {
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
    let mut episode_data: std::collections::HashMap<u32, (f32, Vec<(f64, f32)>)> = std::collections::HashMap::new();
    
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
    let mut episode_positions: std::collections::HashMap<u32, Vec<f64>> = std::collections::HashMap::new();
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

async fn episodes_latest(
    State(st): State<AppState>,
    Json(req): Json<EpisodesLatestRequest>,
) -> impl IntoResponse {
    match episodes_latest_impl(&st, req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => {
            error!("{:?}", e);
            let msg = format!("{}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response()
        }
    }
}

async fn episodes_latest_impl(st: &AppState, req: EpisodesLatestRequest) -> Result<EpisodesSearchResponse> {
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
    let mut episode_topics_map: std::collections::HashMap<u32, std::collections::HashSet<String>> = std::collections::HashMap::new();
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

// ------------------------ Retrieval ------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagDb {
    #[allow(dead_code)]
    schema_version: Option<u32>,
    #[allow(dead_code)]
    embedding_model: Option<String>,
    items: Vec<RagItem>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RagItem {
    #[allow(dead_code)]
    id: u32,
    episode_number: u32,
    episode_title: Option<String>,
    topic: Option<String>,
    subject: Option<RagSubject>,
    start_sec: f64,
    end_sec: f64,
    start_hms: Option<String>,
    end_hms: Option<String>,
    summary: Option<String>,
    text: Option<String>,
    embedding: Option<Vec<f32>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RagSubject {
    coarse: Option<String>,
    fine: Option<String>,
}

struct RagIndex {
    items: Vec<RagItem>,
    // Precomputed norms for cosine similarity; 0.0 if missing.
    norms: Vec<f32>,
    // True when *all* items have embeddings.
    has_embeddings: bool,
}

impl RagIndex {
    fn load(path: &PathBuf) -> Result<Self> {
        let bytes =
            std::fs::read(path).with_context(|| format!("Failed to read {}", path.display()))?;
        let db: RagDb = serde_json::from_slice(&bytes)
            .with_context(|| format!("Failed to parse JSON {}", path.display()))?;

        let mut norms = Vec::with_capacity(db.items.len());
        let mut has_embeddings = true;
        for it in &db.items {
            if let Some(v) = &it.embedding {
                norms.push(l2_norm(v));
            } else {
                norms.push(0.0);
                has_embeddings = false;
            }
        }

        Ok(Self {
            items: db.items,
            norms,
            has_embeddings,
        })
    }
}

#[derive(Clone)]
struct Hit {
    item: RagItem,
    score: f32,
}

async fn retrieve(st: &AppState, rag: &RagIndex, query: &str, top_k: usize) -> Result<Vec<Hit>> {
    if rag.has_embeddings {
        let q = embed_query(st, query).await?;
        let qn = l2_norm(&q);
        if qn <= 0.0 {
            return Err(anyhow!("Query embedding norm is 0"));
        }

        // Parallel computation of scores
        let mut scored: Vec<(usize, f32)> = rag.items
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

        // Use partial sort for better performance when we only need top-K
        if scored.len() > top_k {
            let (top_part, _, _) = scored.select_nth_unstable_by(top_k - 1, |a, b| {
                b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal)
            });
            top_part.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
            scored = top_part.to_vec();
        } else {
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        }
        Ok(scored
            .into_iter()
            .map(|(i, score)| Hit {
                item: rag.items[i].clone(),
                score,
            })
            .collect())
    } else {
        // Fallback if DB was built with --no-embeddings.
        let q = normalize_for_match(query);
        let q_tokens: Vec<&str> = q.split_whitespace().collect();

        let mut scored: Vec<(usize, f32)> = Vec::with_capacity(rag.items.len());
        for (i, it) in rag.items.iter().enumerate() {
            let hay = normalize_for_match(
                it.text
                    .as_deref()
                    .or(it.summary.as_deref())
                    .unwrap_or_default(),
            );
            if hay.is_empty() {
                continue;
            }
            let mut score = 0.0f32;
            for t in &q_tokens {
                if hay.contains(t) {
                    score += 1.0;
                }
            }
            // Mild bonus for exact substring match.
            if hay.contains(&q) {
                score += 2.0;
            }
            if score > 0.0 {
                scored.push((i, score));
            }
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        scored.truncate(top_k);

        Ok(scored
            .into_iter()
            .map(|(i, score)| Hit {
                item: rag.items[i].clone(),
                score,
            })
            .collect())
    }
}

fn normalize_for_match(s: &str) -> String {
    s.to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    // Use chunked iteration for better cache locality and potential SIMD optimization
    // by the compiler
    let mut sum = 0.0f32;
    let chunks = n / 4;
    
    // Process 4 elements at a time (helps compiler auto-vectorize)
    for i in 0..chunks {
        let idx = i * 4;
        sum += a[idx] * b[idx]
            + a[idx + 1] * b[idx + 1]
            + a[idx + 2] * b[idx + 2]
            + a[idx + 3] * b[idx + 3];
    }
    
    // Handle remainder
    for i in (chunks * 4)..n {
        sum += a[i] * b[i];
    }
    
    sum
}

fn l2_norm(v: &[f32]) -> f32 {
    let mut s = 0.0f32;
    for &x in v {
        s += x * x;
    }
    s.sqrt()
}

// ------------------------ Transcript extraction ------------------------

#[derive(Debug, Deserialize, Clone)]
struct TranscriptFile {
    transcript: Vec<TranscriptEntry>,
}

#[derive(Debug, Deserialize, Clone)]
struct TranscriptEntry {
    speaker: Option<String>,
    time: String,
    text: String,
}

async fn load_transcript_entries(
    st: &AppState,
    podcast_id: &str,
    episodes_dir: &PathBuf,
    episode_number: u32,
) -> Result<Arc<Vec<TranscriptEntry>>> {
    let cache_key = (podcast_id.to_string(), episode_number);
    // Fast path from cache
    {
        let cache = st.transcript_cache.read().await;
        if let Some(v) = cache.get(&cache_key) {
            return Ok(v.clone());
        }
    }

    let fname = format!("{episode_number}-ts.json");
    let path = episodes_dir.join(fname);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            warn!("Transcript not found: {}", path.display());
            let arc = Arc::new(Vec::new());
            let mut cache = st.transcript_cache.write().await;
            cache.insert(cache_key, arc.clone());
            return Ok(arc);
        }
        Err(e) => {
            return Err(anyhow!(e).context(format!("Failed to read transcript {}", path.display())));
        }
    };
    let tf: TranscriptFile = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", path.display()))?;

    let arc = Arc::new(tf.transcript);
    let mut cache = st.transcript_cache.write().await;
    cache.insert(cache_key, arc.clone());
    Ok(arc)
}

fn excerpt_for_window(
    transcript: &[TranscriptEntry],
    start_sec: f64,
    end_sec: f64,
    max_chars: usize,
    speaker_filter: Option<&str>,
) -> String {
    let mut out = String::new();
    let mut first = true;

    for e in transcript {
        let Some(t) = hms_to_seconds(&e.time) else {
            continue;
        };
        if t + 0.001 < start_sec {
            continue;
        }
        if t - 0.001 > end_sec {
            break;
        }

        // Filter by speaker if requested
        if let Some(filter_speaker) = speaker_filter {
            let entry_speaker = e.speaker.as_deref().unwrap_or("").trim();
            if !entry_speaker.eq_ignore_ascii_case(filter_speaker) {
                continue;
            }
        }

        if !first {
            out.push('\n');
        }
        first = false;

        let who = e
            .speaker
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("unknown");
        out.push_str(&format!("[{}] {}: {}", e.time, who, e.text.trim()));

        if out.len() >= max_chars {
            // Truncate at a valid UTF-8 char boundary
            // Find the last valid char boundary before max_chars
            let mut truncate_pos = max_chars;
            while truncate_pos > 0 && !out.is_char_boundary(truncate_pos) {
                truncate_pos -= 1;
            }
            out.truncate(truncate_pos);
            out.push_str("\n…");
            break;
        }
    }

    if out.trim().is_empty() {
        // Still provide something so the LLM has a stable format.
        let speaker_note = speaker_filter
            .map(|s| format!(" (filtered by speaker: {})", s))
            .unwrap_or_default();
        format!(
            "[no transcript entries found in window {} - {}{}]",
            seconds_to_hms(start_sec),
            seconds_to_hms(end_sec),
            speaker_note
        )
    } else {
        out
    }
}

fn hms_to_seconds(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let parts: Vec<&str> = s.split(':').collect();
    let nums: Vec<i64> = parts
        .iter()
        .map(|p| p.parse::<i64>().ok())
        .collect::<Option<_>>()?;
    match nums.as_slice() {
        [m, sec] => Some((*m as f64) * 60.0 + (*sec as f64)),
        [h, m, sec] => Some((*h as f64) * 3600.0 + (*m as f64) * 60.0 + (*sec as f64)),
        [sec] => Some(*sec as f64),
        _ => None,
    }
}

fn seconds_to_hms(sec: f64) -> String {
    if !sec.is_finite() || sec < 0.0 {
        return "0:00".to_string();
    }
    let s = sec.floor() as i64;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let ss = s % 60;
    if h > 0 {
        format!("{h}:{:02}:{:02}", m, ss)
    } else {
        format!("{m}:{:02}", ss)
    }
}

// ------------------------ LLM (OpenAI-compatible) ------------------------

#[derive(Debug, Deserialize)]
struct EmbeddingsResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingDatum {
    embedding: Vec<f32>,
}

async fn embed_query(st: &AppState, query: &str) -> Result<Vec<f32>> {
    #[derive(Serialize)]
    struct EmbReq<'a> {
        model: &'a str,
        input: Vec<&'a str>,
    }
    let url = format!("{}/embeddings", st.cfg.llm_base_url);
    let resp = st
        .http
        .post(url)
        .bearer_auth(&st.cfg.llm_api_key)
        .json(&EmbReq {
            model: &st.cfg.embedding_model,
            input: vec![query],
        })
        .send()
        .await
        .context("Embedding request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("Embedding API error: {} - {}", status, body));
    }
    let data: EmbeddingsResponse = resp.json().await.context("Invalid embeddings JSON")?;
    let v = data
        .data
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("Embedding API returned no vectors"))?
        .embedding;
    Ok(v)
}

async fn llm_answer(
    st: &AppState, 
    query: &str, 
    context: &str, 
    speaker_profile: Option<&str>,
    speaker2_profile: Option<&str>,
    speaker_name: Option<&str>,
    speaker2_name: Option<&str>,
) -> Result<String> {
    #[derive(Serialize)]
    struct ChatReq<'a> {
        model: &'a str,
        messages: Vec<ChatMsg<'a>>,
        temperature: f32,
    }
    #[derive(Serialize)]
    struct ChatMsg<'a> {
        role: &'a str,
        content: &'a str,
    }

    #[derive(Deserialize)]
    struct ChatResp {
        choices: Vec<ChatChoice>,
    }
    #[derive(Deserialize)]
    struct ChatChoice {
        message: ChatChoiceMsg,
    }
    #[derive(Deserialize)]
    struct ChatChoiceMsg {
        content: String,
    }

    let (system, user_prompt) = if let (Some(profile1), Some(profile2), Some(name1), Some(name2)) = 
        (speaker_profile, speaker2_profile, speaker_name, speaker2_name) {
        // Discussion/debate mode with two speakers
        let system = format!(
            "You are orchestrating a DISCUSSION/DEBATE between two people with the following profiles. \
            Answer the user's question by creating a natural dialogue between these two speakers, \
            where they discuss, debate, or even argue about the topic based ONLY on the provided SOURCES.\n\n\
            SPEAKER 1 ({}):\n{}\n\n\
            SPEAKER 2 ({}):\n{}\n\n\
            IMPORTANT:\n\
            - Create a natural back-and-forth discussion or debate between the two speakers\n\
            - Each speaker should stay in character with their unique personality, vocabulary, and style\n\
            - They should present different perspectives, challenge each other, or build on each other's points\n\
            - Format the response as a dialogue with clear speaker labels (e.g., '{}: <text>' and '{}: <text>')\n\
            - Use only information from the SOURCES provided\n\
            - Include citations inline like: (Episode 281, 12:38-17:19)\n\
            - If sources don't contain enough information, have the speakers acknowledge this in character\n\
            - Make it feel like a real conversation with interruptions, agreements, disagreements, humor, etc.\n\
            - Answer in German unless the user asks otherwise",
            name1, profile1, name2, profile2, name1, name2
        );
        
        let user_prompt = format!(
            "QUESTION:\n{}\n\nSOURCES:\n{}\n\n\
            Remember: Create a discussion/debate between {} and {} about this question. \
            Make them each bring their unique perspective and personality to the conversation. \
            Use only information from the sources.",
            query, context, name1, name2
        );
        
        (system, user_prompt)
    } else if let Some(profile) = speaker_profile {
        // Single speaker persona mode
        let system = format!(
            "You are roleplaying as a fictional person described in the following speaker profile. \
            Answer the user's question using ONLY the provided SOURCES (transcript excerpts), \
            but deliver the answer in the voice, style, and personality described in the profile below.\n\n\
            SPEAKER PROFILE:\n{}\n\n\
            IMPORTANT:\n\
            - Stay in character throughout your response\n\
            - Use the vocabulary, phrases, and speech patterns from the profile\n\
            - Match the humor style and attitude described\n\
            - If the sources don't contain enough information, say so in character\n\
            - Include citations inline like: (Episode 281, 12:38-17:19)\n\
            - Answer in German unless the user asks otherwise",
            profile
        );
        
        let user_prompt = format!(
            "QUESTION:\n{}\n\nSOURCES:\n{}\n\n\
            Remember: Answer this question as the person from the speaker profile, \
            using their typical vocabulary, style, and humor. Use only information from the sources.",
            query, context
        );
        
        (system, user_prompt)
    } else {
        // Neutral mode (original behavior)
        let system = "You are a helpful RAG assistant. Answer the user's question using ONLY the provided SOURCES (transcript excerpts). If the sources do not contain enough information, say so explicitly. When you make a factual claim, cite it inline like: (Episode 281, 12:38-17:19). Keep the answer concise and in German unless the user asks otherwise.".to_string();
        
        let user_prompt = format!(
            "QUESTION:\n{query}\n\nSOURCES:\n{context}\n\nINSTRUCTIONS:\n- Use the sources only.\n- Prefer quoting short phrases when helpful.\n- Include citations with episode number and time window.\n"
        );
        
        (system, user_prompt)
    };

    let url = format!("{}/chat/completions", st.cfg.llm_base_url);
    let resp = st
        .http
        .post(url)
        .bearer_auth(&st.cfg.llm_api_key)
        .json(&ChatReq {
            model: &st.cfg.llm_model,
            messages: vec![
                ChatMsg {
                    role: "system",
                    content: &system,
                },
                ChatMsg {
                    role: "user",
                    content: &user_prompt,
                },
            ],
            temperature: 0.2,
        })
        .send()
        .await
        .context("Chat request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("Chat API error: {} - {}", status, body));
    }

    let data: ChatResp = resp.json().await.context("Invalid chat JSON")?;
    let content = data
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("Chat API returned no choices"))?
        .message
        .content;
    Ok(content.trim().to_string())
}
