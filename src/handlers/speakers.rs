use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Serialize;

use crate::cache::{load_speakers_index_cached, SpeakerInfo};
use crate::config::AppState as AppStateType;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakersListResponse {
    speakers: Vec<SpeakerInfo>,
}

pub async fn speakers_list(
    State(st): State<AppStateType>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    // Get podcast_id from query parameter or use default
    let podcast_id = params.get("podcast_id").map(|s| s.as_str()).unwrap_or("freakshow");
    
    match load_speakers_index_cached(&st, podcast_id).await {
        Ok(speakers) => (StatusCode::OK, Json(SpeakersListResponse { speakers })).into_response(),
        Err(e) => {
            tracing::error!("Failed to load speakers: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to load speakers: {}", e) })),
            )
                .into_response()
        }
    }
}

