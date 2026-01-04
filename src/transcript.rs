use std::{path::{Path, PathBuf}, sync::Arc};

use anyhow::{anyhow, Context, Result};
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
    episodes_dir: &Path,
    episode_number: u32,
) -> Result<Arc<Vec<TranscriptEntry>>> {
    let cache_key = (podcast_id.to_string(), episode_number);
    // Fast path from cache (moka handles TTL and LRU automatically)
    if let Some(v) = st.transcript_cache.get(&cache_key).await {
        return Ok(v);
    }

    let fname = format!("{episode_number}-ts.json");
    let path = episodes_dir.join(fname);
    
    // Use streaming deserialization - open file directly in blocking task
    let path_clone = path.clone();
    let tf: TranscriptFile = match tokio::task::spawn_blocking(move || {
        use serde_json::Deserializer;
        use std::fs::File;
        use std::io::BufReader;
        
        // Check if file exists first to avoid unnecessary error context wrapping
        if !path_clone.exists() {
            return Err(anyhow::anyhow!("File not found: {}", path_clone.display()));
        }
        
        let file = File::open(&path_clone)
            .with_context(|| format!("Failed to open {}", path_clone.display()))?;
        let reader = BufReader::new(file);
        let mut deserializer = Deserializer::from_reader(reader);
        serde::Deserialize::deserialize(&mut deserializer)
            .with_context(|| format!("Failed to parse {}", path_clone.display()))
    }).await
        .with_context(|| "Failed to spawn blocking task")?
    {
        Ok(tf) => tf,
        Err(e) => {
            // Check if it's a "file not found" error by checking the entire error chain
            let error_msg = format!("{}", e);
            let mut is_file_not_found = false;
            
            // Check all levels of the error chain
            for cause in e.chain() {
                let cause_msg = format!("{}", cause);
                if cause_msg.contains("No such file") 
                    || cause_msg.contains("os error 2")
                    || cause_msg.contains("File not found")
                    || error_msg.contains("File not found") {
                    is_file_not_found = true;
                    break;
                }
            }
            
            // Also check the main error message
            if !is_file_not_found {
                is_file_not_found = error_msg.contains("File not found") 
                    || error_msg.contains("No such file") 
                    || error_msg.contains("os error 2");
            }
            
            if is_file_not_found {
                tracing::debug!("Transcript not found (skipping): {}", path.display());
                let arc = Arc::new(Vec::new());
                st.transcript_cache.insert(cache_key, arc.clone()).await;
                return Ok(arc);
            }
            // For other errors, log at warn level instead of error
            tracing::warn!("Failed to parse transcript {}: {}", path.display(), e);
            return Err(e.context(format!("Failed to parse transcript {}", path.display())));
        }
    };

    let arc = Arc::new(tf.transcript);
    st.transcript_cache.insert(cache_key, arc.clone()).await;
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

