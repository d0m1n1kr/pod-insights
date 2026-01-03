use std::{cmp::Ordering, path::PathBuf};

use anyhow::{anyhow, Context, Result};
use rayon::prelude::*;
use serde::Deserialize;

use crate::config::AppState;
use crate::rag::embeddings::embed_query;
use crate::utils::{dot, l2_norm, normalize_for_match};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagDb {
    #[allow(dead_code)]
    pub schema_version: Option<u32>,
    #[allow(dead_code)]
    pub embedding_model: Option<String>,
    pub items: Vec<RagItem>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RagItem {
    #[allow(dead_code)]
    pub id: u32,
    pub episode_number: u32,
    pub episode_title: Option<String>,
    pub topic: Option<String>,
    pub subject: Option<RagSubject>,
    pub start_sec: f64,
    pub end_sec: f64,
    pub start_hms: Option<String>,
    pub end_hms: Option<String>,
    pub summary: Option<String>,
    pub text: Option<String>,
    pub embedding: Option<Vec<f32>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RagSubject {
    pub coarse: Option<String>,
    pub fine: Option<String>,
}

#[derive(Clone)]
pub struct RagIndex {
    pub items: Vec<RagItem>,
    // Precomputed norms for cosine similarity; 0.0 if missing.
    pub norms: Vec<f32>,
    // True when *all* items have embeddings.
    pub has_embeddings: bool,
}

impl RagIndex {
    pub fn load(path: &PathBuf) -> Result<Self> {
        let bytes =
            std::fs::read(path).with_context(|| format!("Failed to read {}", path.display()))?;
        Self::load_from_bytes(&bytes)
            .with_context(|| format!("Failed to parse JSON {}", path.display()))
    }

    pub fn load_from_bytes(bytes: &[u8]) -> Result<Self> {
        use serde_json::Deserializer;
        use std::io::{BufReader, Cursor};

        // Use streaming deserializer with a reader for better memory efficiency
        // This allows the deserializer to read incrementally instead of loading everything
        let reader = BufReader::new(Cursor::new(bytes));
        let mut deserializer = Deserializer::from_reader(reader);
        
        // Deserialize the outer structure
        // The Deserializer will read incrementally from the reader
        let db: RagDb = serde::Deserialize::deserialize(&mut deserializer)
            .with_context(|| "Failed to parse JSON")?;

        // Calculate norms while processing (reduces memory pressure)
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
    
    /// Load from a file path using streaming deserialization
    /// This is more memory-efficient for large files as it reads incrementally
    pub fn load_from_path(path: &PathBuf) -> Result<Self> {
        use serde_json::Deserializer;
        use std::fs::File;
        use std::io::BufReader;

        // Open file and create a buffered reader for streaming
        let file = File::open(path)
            .with_context(|| format!("Failed to open {}", path.display()))?;
        let reader = BufReader::new(file);
        let mut deserializer = Deserializer::from_reader(reader);
        
        // Deserialize incrementally - the reader will fetch data as needed
        let db: RagDb = serde::Deserialize::deserialize(&mut deserializer)
            .with_context(|| format!("Failed to parse JSON {}", path.display()))?;

        // Calculate norms while processing
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
pub struct Hit {
    pub item: RagItem,
    pub score: f32,
}

pub async fn retrieve(st: &AppState, rag: &RagIndex, query: &str, top_k: usize) -> Result<Vec<Hit>> {
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

