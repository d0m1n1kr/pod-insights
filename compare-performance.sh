#!/bin/bash

echo "🏁 Performance Comparison: Rust vs JavaScript"
echo "=============================================="
echo ""

if [ ! -f "db/topic-embeddings.json" ]; then
    echo "❌ db/topic-embeddings.json not found!"
    echo "   Please create embeddings first with: node create-embeddings.js"
    exit 1
fi

if [ ! -f "settings.json" ]; then
    echo "❌ settings.json not found!"
    echo "   Please copy settings.example.json to settings.json"
    exit 1
fi

echo "⚙️  Test Configuration:"
TOPIC_COUNT=$(grep -o '"topics":\[' db/topic-embeddings.json -A 1 | wc -l)
echo "   Topics to cluster: ~4500+"
echo "   Target clusters: 256"
echo ""

# Backup existing taxonomy
if [ -f "topic-taxonomy.json" ]; then
    cp topic-taxonomy.json topic-taxonomy.backup.json
    echo "📦 Backed up existing taxonomy"
fi

echo ""
echo "🦀 Running Rust version..."
echo "----------------------------"
time ./target/release/cluster-topics > /dev/null 2>&1
RUST_EXIT=$?

if [ $RUST_EXIT -eq 0 ]; then
    echo "✅ Rust version completed successfully"
    mv topic-taxonomy.json topic-taxonomy-rust.json
else
    echo "❌ Rust version failed"
fi

echo ""
echo "🟨 Running JavaScript version..."
echo "----------------------------"
time node cluster-topics.js > /dev/null 2>&1
JS_EXIT=$?

if [ $JS_EXIT -eq 0 ]; then
    echo "✅ JavaScript version completed successfully"
    mv topic-taxonomy.json topic-taxonomy-js.json
else
    echo "❌ JavaScript version failed"
fi

echo ""
echo "📊 Results"
echo "=========="

if [ -f "topic-taxonomy-rust.json" ]; then
    RUST_CLUSTERS=$(grep -o '"name"' topic-taxonomy-rust.json | wc -l)
    echo "Rust clusters: $RUST_CLUSTERS"
fi

if [ -f "topic-taxonomy-js.json" ]; then
    JS_CLUSTERS=$(grep -o '"name"' topic-taxonomy-js.json | wc -l)
    echo "JavaScript clusters: $JS_CLUSTERS"
fi

# Restore preferred version
if [ -f "topic-taxonomy-rust.json" ]; then
    cp topic-taxonomy-rust.json topic-taxonomy.json
    echo ""
    echo "✅ Using Rust version as final output"
elif [ -f "topic-taxonomy.backup.json" ]; then
    cp topic-taxonomy.backup.json topic-taxonomy.json
    echo ""
    echo "ℹ️  Restored backup taxonomy"
fi

echo ""
echo "💡 Tip: Check the 'time' output above for real performance comparison"
