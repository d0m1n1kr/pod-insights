# 🦀 Rust Topic Clustering - Quick Start Guide

## Prerequisites

Install Rust if you haven't already:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

## 1️⃣ One-Time Setup

```bash
# Build the optimized binary (takes ~15 seconds)
cargo build --release
```

That's it! The binary is now at `target/release/cluster-topics`

## 2️⃣ Run Clustering

```bash
# Quick way
./build-and-run.sh

# Or directly
./target/release/cluster-topics
```

## 3️⃣ Configuration

Edit `settings.json` to customize:

```json
{
  "topicClustering": {
    "clusters": 256,                    // Target number of clusters
    "outlierThreshold": 0.7,            // Distance threshold for outliers
    "linkageMethod": "weighted",        // weighted|ward|average|complete|single
    "useRelevanceWeighting": true,      // Weight by episode frequency
    "useLLMNaming": true                // Use LLM for naming (slower but better)
  }
}
```

## 🎯 Key Features

- **Speed**: ~10x faster than JavaScript for pure clustering
- **Quality**: Identical results to JavaScript version
- **Parallel**: Uses all your CPU cores automatically
- **Progress**: Real-time progress bars
- **Compatible**: Drop-in replacement for `node cluster-topics.js`

## 📊 Performance Comparison

Run both versions and compare:
```bash
./compare-performance.sh
```

Expected results (M1 Mac, 4500 topics):
- **JavaScript**: ~5 minutes
- **Rust**: ~2.5 minutes (without LLM), ~20-30 seconds (pure clustering)

## 🔧 Troubleshooting

### "settings.json not found"
```bash
cp settings.example.json settings.json
# Edit settings.json with your API key
```

### "topic-embeddings.json not found"
```bash
node create-embeddings.js
```

### Rebuild after changes
```bash
cargo build --release
```

## 📚 More Information

- **Full documentation**: [RUST-CLUSTERING.md](RUST-CLUSTERING.md)
- **Port details**: [RUST-PORT-SUMMARY.md](RUST-PORT-SUMMARY.md)
- **JavaScript reference**: `cluster-topics.js`

## 🚀 Production Use

Replace your JavaScript clustering:
```bash
# Old way
node cluster-topics.js

# New way (faster)
./target/release/cluster-topics
```

Output is identical, so all downstream tools keep working!
