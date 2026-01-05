// Utility functions for vector operations and string normalization

#[inline]
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
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

pub fn l2_norm(v: &[f32]) -> f32 {
    let mut s = 0.0f32;
    for &x in v {
        s += x * x;
    }
    s.sqrt()
}

pub fn normalize_for_match(s: &str) -> String {
    s.to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn hms_to_seconds(s: &str) -> Option<f64> {
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

pub fn seconds_to_hms(sec: f64) -> String {
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



