#!/bin/bash

# Baue die Rust-Version
echo "🔨 Baue Rust-Version..."
cargo build --release

if [ $? -eq 0 ]; then
    echo "✅ Build erfolgreich!"
    echo ""
    echo "Führe Clustering aus..."
    time ./target/release/cluster-topics
else
    echo "❌ Build fehlgeschlagen!"
    exit 1
fi

