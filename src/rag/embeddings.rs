use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::AppState;

#[derive(Debug, Deserialize)]
struct EmbeddingsResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingDatum {
    embedding: Vec<f32>,
}

pub async fn embed_query(st: &AppState, query: &str) -> Result<Vec<f32>> {
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

pub async fn llm_answer(
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

