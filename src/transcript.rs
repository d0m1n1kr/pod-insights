use std::{io, path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::config::AppState;
use crate::utils::{hms_to_seconds, seconds_to_hms};

#[derive(Debug, Deserialize, Clone)]
pub struct TranscriptFile {
    pub transcript: Vec<TranscriptEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct TranscriptEntry {
    pub speaker: Option<String>,
    pub time: String,
    pub text: String,
}

pub async fn load_transcript_entries(
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
            tracing::warn!("Transcript not found: {}", path.display());
            let arc = Arc::new(Vec::new());
            let mut cache = st.transcript_cache.write().await;
            cache.insert(cache_key, arc.clone());
            return Ok(arc);
        }
        Err(e) => {
            return Err(anyhow::anyhow!(e).context(format!("Failed to read transcript {}", path.display())));
        }
    };
    let tf: TranscriptFile = serde_json::from_slice(&bytes)
        .with_context(|| format!("Failed to parse {}", path.display()))?;

    let arc = Arc::new(tf.transcript);
    let mut cache = st.transcript_cache.write().await;
    cache.insert(cache_key, arc.clone());
    Ok(arc)
}

pub fn excerpt_for_window(
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

