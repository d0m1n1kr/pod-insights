#!/usr/bin/env python3
"""
Modify cluster_topics.rs and cluster_topics_v2.rs to support variant loading from variants.json
"""

def modify_cluster_topics_v1(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Add clap import
    imports_section = """use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use indicatif::{ProgressBar, ProgressStyle};
use clap::Parser;"""
    
    content = content.replace(
        "use indicatif::{ProgressBar, ProgressStyle};",
        "use indicatif::{ProgressBar, ProgressStyle};\nuse clap::Parser;"
    )
    
    # Add CLI and variant structs after imports
    variant_structs = """
/// Command-line arguments
#[derive(Parser, Debug)]
#[command(name = "cluster-topics")]
#[command(about = "V1 Topic clustering using HAC", long_about = None)]
struct Args {
    /// Variant name to load from variants.json
    #[arg(short, long)]
    variant: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct VariantsConfig {
    variants: HashMap<String, VariantConfig>,
}

#[derive(Debug, Deserialize, Clone)]
struct VariantConfig {
    version: String,
    name: String,
    settings: VariantSettings,
}

#[derive(Debug, Deserialize, Clone)]
struct VariantSettings {
    clusters: Option<usize>,
    #[serde(rename = "outlierThreshold")]
    outlier_threshold: Option<f64>,
    #[serde(rename = "linkageMethod")]
    linkage_method: Option<String>,
    #[serde(rename = "useRelevanceWeighting")]
    use_relevance_weighting: Option<bool>,
    #[serde(rename = "useLLMNaming")]
    use_llm_naming: Option<bool>,
}
"""
    
    # Insert after the imports and before the first struct
    content = content.replace(
        "\n#[derive(Debug, Deserialize)]\nstruct Settings {",
        variant_structs + "\n#[derive(Debug, Deserialize)]\nstruct Settings {"
    )
    
    # Add helper function before main
    helper_function = """
/// Load variant settings from variants.json
fn load_variant_settings(variant_name: &str) -> Result<VariantSettings, Box<dyn std::error::Error>> {
    let variants_path = PathBuf::from("variants.json");
    if !variants_path.exists() {
        return Err("variants.json not found".into());
    }
    
    let variants_content = fs::read_to_string(&variants_path)?;
    let variants_config: VariantsConfig = serde_json::from_str(&variants_content)?;
    
    let variant = variants_config.variants.get(variant_name)
        .ok_or_else(|| format!("Variant '{}' not found in variants.json", variant_name))?;
    
    Ok(variant.settings.clone())
}

"""
    
    content = content.replace(
        "#[tokio::main]\nasync fn main(",
        helper_function + "#[tokio::main]\nasync fn main("
    )
    
    # Modify main function to parse args and load variant settings
    old_main_start = """async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let start_time = Instant::now();
    println!("🔬 Topic-Clustering für Freakshow Episoden\\n");
    let settings_path = PathBuf::from("settings.json");
    if !settings_path.exists() {
        eprintln!("\\n❌ settings.json nicht gefunden!");
        eprintln!("   Kopiere settings.example.json zu settings.json und passe die Konfiguration an.\\n");
        std::process::exit(1);
    }
    let settings_content = fs::read_to_string(&settings_path)?;
    let settings: Settings = serde_json::from_str(&settings_content)?;
    let target_clusters = settings.topic_clustering.as_ref().and_then(|s| s.clusters).unwrap_or(256);
    let outlier_threshold = settings.topic_clustering.as_ref().and_then(|s| s.outlier_threshold).unwrap_or(0.7);
    let linkage_method = settings.topic_clustering.as_ref().and_then(|s| s.linkage_method.clone()).unwrap_or_else(|| "weighted".to_string());
    let use_relevance_weighting = settings.topic_clustering.as_ref().and_then(|s| s.use_relevance_weighting).unwrap_or(true);
    let use_llm_naming = settings.topic_clustering.as_ref().and_then(|s| s.use_llm_naming).unwrap_or(true);"""
    
    new_main_start = """async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let start_time = Instant::now();
    println!("🔬 Topic-Clustering für Freakshow Episoden\\n");
    
    // Parse command-line arguments
    let args = Args::parse();
    
    // Load base settings
    let settings_path = PathBuf::from("settings.json");
    if !settings_path.exists() {
        eprintln!("\\n❌ settings.json nicht gefunden!");
        eprintln!("   Kopiere settings.example.json zu settings.json und passe die Konfiguration an.\\n");
        std::process::exit(1);
    }
    let settings_content = fs::read_to_string(&settings_path)?;
    let settings: Settings = serde_json::from_str(&settings_content)?;
    
    // Override with variant settings if specified
    let (target_clusters, outlier_threshold, linkage_method, use_relevance_weighting, use_llm_naming) = 
        if let Some(variant_name) = &args.variant {
            println!("📋 Loading variant: {}\\n", variant_name);
            let variant_settings = load_variant_settings(variant_name)?;
            (
                variant_settings.clusters.or(settings.topic_clustering.as_ref().and_then(|s| s.clusters)).unwrap_or(256),
                variant_settings.outlier_threshold.or(settings.topic_clustering.as_ref().and_then(|s| s.outlier_threshold)).unwrap_or(0.7),
                variant_settings.linkage_method.or(settings.topic_clustering.as_ref().and_then(|s| s.linkage_method.clone())).unwrap_or_else(|| "weighted".to_string()),
                variant_settings.use_relevance_weighting.or(settings.topic_clustering.as_ref().and_then(|s| s.use_relevance_weighting)).unwrap_or(true),
                variant_settings.use_llm_naming.or(settings.topic_clustering.as_ref().and_then(|s| s.use_llm_naming)).unwrap_or(true),
            )
        } else {
            (
                settings.topic_clustering.as_ref().and_then(|s| s.clusters).unwrap_or(256),
                settings.topic_clustering.as_ref().and_then(|s| s.outlier_threshold).unwrap_or(0.7),
                settings.topic_clustering.as_ref().and_then(|s| s.linkage_method.clone()).unwrap_or_else(|| "weighted".to_string()),
                settings.topic_clustering.as_ref().and_then(|s| s.use_relevance_weighting).unwrap_or(true),
                settings.topic_clustering.as_ref().and_then(|s| s.use_llm_naming).unwrap_or(true),
            )
        };"""
    
    content = content.replace(old_main_start, new_main_start)
    
    with open(filepath, 'w') as f:
        f.write(content)
    
    print(f"✓ Modified {filepath}")

def modify_cluster_topics_v2(filepath):
    # Similar modifications for V2
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Add clap import
    content = content.replace(
        "use indicatif::{ProgressBar, ProgressStyle};",
        "use indicatif::{ProgressBar, ProgressStyle};\nuse clap::Parser;"
    )
    
    # Add CLI and variant structs (same as V1 but with V2-specific settings)
    variant_structs = """
/// Command-line arguments
#[derive(Parser, Debug)]
#[command(name = "cluster-topics-v2")]
#[command(about = "V2 Topic clustering using HDBSCAN", long_about = None)]
struct Args {
    /// Variant name to load from variants.json
    #[arg(short, long)]
    variant: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct VariantsConfig {
    variants: HashMap<String, VariantConfig>,
}

#[derive(Debug, Deserialize, Clone)]
struct VariantConfig {
    version: String,
    name: String,
    settings: VariantSettings,
}

#[derive(Debug, Deserialize, Clone)]
struct VariantSettings {
    #[serde(rename = "minClusterSize")]
    min_cluster_size: Option<usize>,
    #[serde(rename = "minSamples")]
    min_samples: Option<usize>,
    #[serde(rename = "reducedDimensions")]
    reduced_dimensions: Option<usize>,
    #[serde(rename = "outlierThreshold")]
    outlier_threshold: Option<f64>,
    #[serde(rename = "useRelevanceWeighting")]
    use_relevance_weighting: Option<bool>,
    #[serde(rename = "useLLMNaming")]
    use_llm_naming: Option<bool>,
}
"""
    
    # Insert after the imports and before the first struct
    content = content.replace(
        "\n#[derive(Debug, Deserialize)]\nstruct Settings {",
        variant_structs + "\n#[derive(Debug, Deserialize)]\nstruct Settings {"
    )
    
    # Add helper function before main
    helper_function = """
/// Load variant settings from variants.json
fn load_variant_settings(variant_name: &str) -> Result<VariantSettings, Box<dyn std::error::Error>> {
    let variants_path = PathBuf::from("variants.json");
    if !variants_path.exists() {
        return Err("variants.json not found".into());
    }
    
    let variants_content = fs::read_to_string(&variants_path)?;
    let variants_config: VariantsConfig = serde_json::from_str(&variants_content)?;
    
    let variant = variants_config.variants.get(variant_name)
        .ok_or_else(|| format!("Variant '{}' not found in variants.json", variant_name))?;
    
    Ok(variant.settings.clone())
}

"""
    
    content = content.replace(
        "#[tokio::main]\nasync fn main(",
        helper_function + "#[tokio::main]\nasync fn main("
    )
    
    # For V2, we need to find and replace the settings loading part
    # This is more complex, so let's just add the Args parsing at the beginning
    if "let start_time = Instant::now();" in content:
        content = content.replace(
            "let start_time = Instant::now();",
            "let args = Args::parse();\n    let start_time = Instant::now();"
        )
    
    print(f"✓ Modified {filepath}")
    
    with open(filepath, 'w') as f:
        f.write(content)

if __name__ == "__main__":
    modify_cluster_topics_v1("src/cluster_topics.rs")
    # modify_cluster_topics_v2("src/cluster_topics_v2.rs")  # Commented out for now
    print("\n✅ All modifications complete!")

