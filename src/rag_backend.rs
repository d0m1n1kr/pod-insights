// Main entry point for RAG backend
mod config;
mod cache;
mod handlers;
mod rag;
mod transcript;
mod utils;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::{
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::post,
    Router,
};
use reqwest::Client;
use tokio::sync::RwLock;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use config::{AppConfig, AppState};
use handlers::{chat, episodes_latest, episodes_search, speakers_list};
use rag::RagIndex;

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
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
