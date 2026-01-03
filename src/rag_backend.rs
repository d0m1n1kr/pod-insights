// Main entry point for RAG backend
mod config;
mod cache;
mod handlers;
mod rag;
mod transcript;
mod utils;

use anyhow::{Context, Result};
use axum::{
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::post,
    Router,
};
use moka::future::Cache;
use reqwest::Client;
use std::time::Duration;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use config::{AppConfig, AppState};
use handlers::{chat, episodes_latest, episodes_search, speakers_list};

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
    info!("RAG databases will be loaded on-demand per podcast");

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

    // Initialize LRU caches with size limits and TTL
    // Transcript cache: up to 1000 episodes, 1 hour TTL
    let transcript_cache = Cache::builder()
        .max_capacity(1000)
        .time_to_live(Duration::from_secs(3600))
        .time_to_idle(Duration::from_secs(1800))
        .build();
    
    // RAG cache: up to 20 podcasts, 1 hour TTL
    let rag_cache = Cache::builder()
        .max_capacity(20)
        .time_to_live(Duration::from_secs(3600))
        .time_to_idle(Duration::from_secs(1800))
        .build();
    
    // Episode metadata cache: up to 5000 episodes, 1 hour TTL
    let episode_metadata_cache = Cache::builder()
        .max_capacity(5000)
        .time_to_live(Duration::from_secs(3600))
        .time_to_idle(Duration::from_secs(1800))
        .build();
    
    // Episode list cache: up to 20 podcasts, 30 minutes TTL
    let episode_list_cache = Cache::builder()
        .max_capacity(20)
        .time_to_live(Duration::from_secs(1800))
        .time_to_idle(Duration::from_secs(900))
        .build();
    
    // Speaker profile cache: up to 500 profiles, 1 hour TTL
    let speaker_profile_cache = Cache::builder()
        .max_capacity(500)
        .time_to_live(Duration::from_secs(3600))
        .time_to_idle(Duration::from_secs(1800))
        .build();
    
    // Speakers index cache: up to 20 podcasts, 30 minutes TTL
    let speakers_index_cache = Cache::builder()
        .max_capacity(20)
        .time_to_live(Duration::from_secs(1800))
        .time_to_idle(Duration::from_secs(900))
        .build();
    
    // Speaker meta cache: up to 500 entries, 1 hour TTL
    let speaker_meta_cache = Cache::builder()
        .max_capacity(500)
        .time_to_live(Duration::from_secs(3600))
        .time_to_idle(Duration::from_secs(1800))
        .build();
    
    // Episode topics map cache: up to 20 podcasts, 1 hour TTL
    let episode_topics_map_cache = Cache::builder()
        .max_capacity(20)
        .time_to_live(Duration::from_secs(3600))
        .time_to_idle(Duration::from_secs(1800))
        .build();

    let app_state = AppState {
        cfg: cfg.clone(),
        http,
        transcript_cache,
        rag_cache,
        episode_metadata_cache,
        episode_list_cache,
        speaker_profile_cache,
        speakers_index_cache,
        speaker_meta_cache,
        episode_topics_map_cache,
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
