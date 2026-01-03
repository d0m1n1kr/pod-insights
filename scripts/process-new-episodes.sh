#!/bin/bash
# Process only newly added episodes: extract, cluster, and generate visualizations
# This script processes new episodes and updates global data (clustering, visualizations)
# but does NOT update speaker profiles.
# Usage: ./scripts/process-new-episodes.sh [--podcast <podcast-id>] [--skip-scraping]
#
# Steps:
#   1: Detect and process new episodes (scraping, stats, topics)
#   2: Update global data (normalize topics, embeddings, clustering)
#   3: Regenerate visualizations (all podcasts)
#   4: Generate TS-live files for new episodes
#   5: Organize Frontend Files

# Safety: if this script is invoked via zsh/sh (or sourced), re-exec under bash.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
PODCAST_ID=${1:-freakshow}
SKIP_SCRAPING=false

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --podcast)
            # Will be handled in next iteration
            PODCAST_ARG=true
            ;;
        --skip-scraping)
            SKIP_SCRAPING=true
            ;;
        --help|-h)
            echo "Usage: $0 [--podcast <podcast-id>] [--skip-scraping]"
            echo ""
            echo "This script processes only newly added episodes and updates global data."
            echo "It does NOT update speaker profiles."
            echo ""
            echo "Options:"
            echo "  --podcast <id>     Podcast ID (default: freakshow)"
            echo "  --skip-scraping    Skip scraping phase (assume episodes already scraped)"
            echo ""
            echo "What this script does:"
            echo "  1. Detects new episodes (missing processed files)"
            echo "  2. Scrapes details for new episodes (if not skipped)"
            echo "  3. Generates speaker stats for new episodes"
            echo "  4. Extracts topics for new episodes"
            echo "  5. Updates global data (normalize topics, embeddings, clustering)"
            echo "  6. Regenerates visualizations (all podcasts)"
            echo "  7. Generates TS-live files for new episodes"
            echo "  8. Organizes frontend files"
            exit 0
            ;;
        *)
            if [ "${PODCAST_ARG:-false}" = true ]; then
                PODCAST_ID=$arg
                PODCAST_ARG=false
            fi
            ;;
    esac
done

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}🆕 Processing New Episodes for Podcast: ${PODCAST_ID}${NC}\n"

# Create necessary directories
echo -e "${YELLOW}📁 Creating necessary directories...${NC}"
mkdir -p "podcasts/$PODCAST_ID/episodes"
mkdir -p "podcasts/$PODCAST_ID/speakers"
mkdir -p "db"
mkdir -p "frontend/public/podcasts/$PODCAST_ID"
mkdir -p "frontend/public/podcasts/$PODCAST_ID/speakers"
mkdir -p "frontend/public/podcasts/$PODCAST_ID/topics"
echo -e "${GREEN}✓${NC} Directories created\n"

# Helper function to run a script with podcast parameter
run_script() {
    local script=$1
    shift
    echo -e "${YELLOW}→${NC} Running: $script --podcast $PODCAST_ID $@"
    if node "$script" --podcast "$PODCAST_ID" "$@"; then
        echo -e "${GREEN}✓${NC} $script completed\n"
    else
        echo -e "${RED}✗${NC} $script failed\n"
        exit 1
    fi
}

# Helper function to run an optional script (never abort the pipeline)
run_script_optional() {
    local script=$1
    shift
    echo -e "${YELLOW}→${NC} Running (optional): $script --podcast $PODCAST_ID $@"
    if node "$script" --podcast "$PODCAST_ID" "$@"; then
        echo -e "${GREEN}✓${NC} $script completed\n"
    else
        echo -e "${YELLOW}⚠${NC}  $script failed (skipped)\n"
        return 0
    fi
}

# Function to get list of existing episode numbers from .json files
get_existing_episodes() {
    local episodes_dir="podcasts/$PODCAST_ID/episodes"
    local existing_episodes=()
    
    if [ ! -d "$episodes_dir" ]; then
        return
    fi
    
    # Find all episode JSON files (format: <number>.json)
    for episode_file in "$episodes_dir"/*.json; do
        [ -f "$episode_file" ] || continue
        
        # Extract episode number from filename (e.g., "136.json" -> "136")
        local basename=$(basename "$episode_file")
        local episode_num=$(echo "$basename" | sed -E 's/^([0-9]+)\.json$/\1/')
        
        if [ -n "$episode_num" ] && [ "$episode_num" != "$basename" ]; then
            existing_episodes+=("$episode_num")
        fi
    done
    
    # Return sorted unique episode numbers
    printf '%s\n' "${existing_episodes[@]}" | sort -n | uniq
}

# Function to detect new episodes (episodes without speaker stats)
detect_new_episodes() {
    local episodes_dir="podcasts/$PODCAST_ID/episodes"
    local new_episodes=()
    
    if [ ! -d "$episodes_dir" ]; then
        echo -e "${YELLOW}⚠${NC}  Episodes directory not found: $episodes_dir"
        return 1
    fi
    
    # Find all episode JSON files (both .json and -ts.json)
    for episode_file in "$episodes_dir"/*.json "$episodes_dir"/*-ts.json; do
        [ -f "$episode_file" ] || continue
        
        # Extract episode number from filename
        # Handles: "136.json", "136-ts.json"
        local basename=$(basename "$episode_file")
        local episode_num=$(echo "$basename" | sed -E 's/^([0-9]+)(-ts)?\.json$/\1/')
        
        if [ -z "$episode_num" ] || [ "$episode_num" = "$basename" ]; then
            continue
        fi
        
        # Check if speaker stats exist for this episode
        local stats_file="podcasts/$PODCAST_ID/episodes/${episode_num}-stats.json"
        if [ ! -f "$stats_file" ]; then
            # Only add if not already in array
            if [[ ! " ${new_episodes[@]} " =~ " ${episode_num} " ]]; then
                new_episodes+=("$episode_num")
            fi
        fi
    done
    
    if [ ${#new_episodes[@]} -eq 0 ]; then
        echo -e "${GREEN}✓${NC} No new episodes detected\n"
        return 1
    else
        echo -e "${GREEN}✓${NC} Found ${#new_episodes[@]} new episode(s): ${new_episodes[*]}\n"
        NEW_EPISODES=("${new_episodes[@]}")
        return 0
    fi
}

# Phase 1: Check existing episodes and scrape new ones
echo -e "${BLUE}📥 Phase 1: Checking Existing Episodes and Scraping New Ones${NC}\n"

# Get list of existing episodes before scraping
echo -e "${YELLOW}→${NC} Checking existing episodes..."
EXISTING_BEFORE=$(get_existing_episodes)
EXISTING_BEFORE_COUNT=$(echo "$EXISTING_BEFORE" | grep -c '^' || echo "0")
echo -e "${GREEN}✓${NC} Found $EXISTING_BEFORE_COUNT existing episode(s)\n"

# Scrape new episodes if not skipped
if [ "$SKIP_SCRAPING" = false ]; then
    echo -e "${YELLOW}→${NC} Scraping episode list for new episodes..."
    run_script "scripts/scrape.js"
    
    # Get list of episodes after scraping
    EXISTING_AFTER=$(get_existing_episodes)
    EXISTING_AFTER_COUNT=$(echo "$EXISTING_AFTER" | grep -c '^' || echo "0")
    
    # Find newly scraped episodes (episodes that exist after but not before)
    NEWLY_SCRAPED=()
    while IFS= read -r episode_num; do
        if [ -n "$episode_num" ] && ! echo "$EXISTING_BEFORE" | grep -q "^${episode_num}$"; then
            NEWLY_SCRAPED+=("$episode_num")
        fi
    done <<< "$EXISTING_AFTER"
    
    if [ ${#NEWLY_SCRAPED[@]} -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Found ${#NEWLY_SCRAPED[@]} newly scraped episode(s): ${NEWLY_SCRAPED[*]}\n"
    else
        echo -e "${GREEN}✓${NC} No new episodes scraped\n"
    fi
    
    # Scrape details only for newly scraped episodes
    if [ ${#NEWLY_SCRAPED[@]} -gt 0 ]; then
        echo -e "${YELLOW}→${NC} Scraping episode details for new episodes..."
        # Calculate range for newly scraped episodes
        IFS=$'\n' sorted_newly_scraped=($(printf '%s\n' "${NEWLY_SCRAPED[@]}" | sort -n))
        MIN_NEW=${sorted_newly_scraped[0]}
        MAX_NEW=${sorted_newly_scraped[${#sorted_newly_scraped[@]}-1]}
        node scripts/scrape-details.js --podcast "$PODCAST_ID" --start "$MIN_NEW" --end "$MAX_NEW" || echo -e "${YELLOW}⚠${NC}  Scraping details failed\n"
        
        echo -e "${YELLOW}→${NC} Scraping chapters for new episodes..."
        node scripts/scrape-chapters.js --podcast "$PODCAST_ID" --start "$MIN_NEW" --end "$MAX_NEW" || echo -e "${YELLOW}⚠${NC}  Chapter scraping skipped\n"
    else
        echo -e "${YELLOW}→${NC} No newly scraped episodes, skipping details/chapters scraping\n"
    fi
else
    echo -e "${YELLOW}⏭${NC}  Skipping scraping phase\n"
fi

# Detect new episodes (episodes without speaker stats)
echo -e "${YELLOW}→${NC} Detecting episodes that need processing..."
if ! detect_new_episodes; then
    echo -e "${YELLOW}ℹ${NC}  No new episodes to process. Exiting.\n"
    exit 0
fi

# Calculate episode range for efficient processing
if [ ${#NEW_EPISODES[@]} -gt 0 ]; then
    # Sort episodes numerically
    IFS=$'\n' sorted_episodes=($(printf '%s\n' "${NEW_EPISODES[@]}" | sort -n))
    MIN_EPISODE=${sorted_episodes[0]}
    MAX_EPISODE=${sorted_episodes[${#sorted_episodes[@]}-1]}
    
    echo -e "${YELLOW}→${NC} Processing episodes: ${NEW_EPISODES[*]} (range: $MIN_EPISODE-$MAX_EPISODE)\n"
else
    echo -e "${YELLOW}ℹ${NC}  No episodes to process\n"
    exit 0
fi

# Generate speaker stats for new episodes
echo -e "${YELLOW}→${NC} Generating speaker stats for new episodes..."
for episode_num in "${NEW_EPISODES[@]}"; do
    echo -e "${YELLOW}  Processing episode $episode_num...${NC}"
    node scripts/generate-speaker-stats.js --podcast "$PODCAST_ID" --episode "$episode_num" || echo -e "${YELLOW}⚠${NC}  Failed to generate stats for episode $episode_num"
done
echo -e "${GREEN}✓${NC} Speaker stats generation completed\n"

# Extract topics for new episodes
echo -e "${YELLOW}→${NC} Extracting topics for new episodes..."
for episode_num in "${NEW_EPISODES[@]}"; do
    echo -e "${YELLOW}  Processing episode $episode_num...${NC}"
    node scripts/extract-topics.js --podcast "$PODCAST_ID" "$episode_num" || echo -e "${YELLOW}⚠${NC}  Failed to extract topics for episode $episode_num"
done
echo -e "${GREEN}✓${NC} Topic extraction completed\n"

# Phase 2: Update global data (all podcasts)
echo -e "${BLUE}🔬 Phase 2: Updating Global Data${NC}\n"

echo -e "${YELLOW}→${NC} Normalizing topics (updates all podcasts)..."
run_script "scripts/normalize-topics.js"

echo -e "${YELLOW}→${NC} Generating extended topics for new episodes (for RAG)..."
if [ ${#NEW_EPISODES[@]} -gt 0 ]; then
    # Use range for efficiency
    node scripts/generate-extended-topics.js --podcast "$PODCAST_ID" --from "$MIN_EPISODE" --to "$MAX_EPISODE" || echo -e "${YELLOW}⚠${NC}  Extended topics generation skipped\n"
    echo -e "${GREEN}✓${NC} Extended topics generation completed\n"
else
    echo -e "${YELLOW}⚠${NC}  No new episodes for extended topics\n"
fi

echo -e "${YELLOW}→${NC} Creating embeddings (updates all podcasts)..."
run_script "scripts/create-embeddings.js"

# Phase 3: Clustering (all podcasts)
echo -e "${BLUE}🎯 Phase 3: Clustering (V2 auto-v2.1)${NC}\n"

echo -e "${YELLOW}→${NC} Building clustering variant: auto-v2.1 (updates all podcasts)..."
if ./scripts/build-variant.sh v2 auto-v2.1 --podcast "$PODCAST_ID"; then
    echo -e "${GREEN}✓${NC} Clustering completed\n"
else
    echo -e "${RED}✗${NC} Clustering failed\n"
    exit 1
fi

# Phase 4: Regenerate visualizations (all podcasts)
echo -e "${BLUE}📊 Phase 4: Regenerating Visualizations${NC}\n"

echo -e "${YELLOW}→${NC} Generating speaker river data (all podcasts)..."
run_script "scripts/generate-speaker-river.js"

echo -e "${YELLOW}→${NC} Generating speaker-speaker heatmap (all podcasts)..."
run_script "scripts/generate-speaker-speaker-heatmap.js"

echo -e "${YELLOW}→${NC} Generating year-duration heatmap (all podcasts)..."
run_script "scripts/generate-year-duration-heatmap.js"

echo -e "${YELLOW}→${NC} Generating dayofweek-duration heatmap (all podcasts)..."
run_script "scripts/generate-dayofweek-duration-heatmap.js"

echo -e "${YELLOW}→${NC} Generating speaker-duration heatmap (all podcasts)..."
run_script "scripts/generate-speaker-duration-heatmap.js"

# Check and generate UMAP if needed
echo -e "${YELLOW}→${NC} Checking topic UMAP data..."
VARIANT_UMAP="frontend/public/podcasts/$PODCAST_ID/topics/auto-v2.1/topic-umap-data.json"
if [ ! -f "$VARIANT_UMAP" ]; then
    echo -e "${YELLOW}→${NC} Generating topic UMAP data (from variant taxonomy)..."
    VARIANT_TAXONOMY="frontend/public/podcasts/$PODCAST_ID/topics/auto-v2.1/topic-taxonomy.json"
    if [ -f "$VARIANT_TAXONOMY" ]; then
        cp "$VARIANT_TAXONOMY" "frontend/public/podcasts/$PODCAST_ID/topic-taxonomy.json"
        run_script "scripts/generate-topic-umap.js"
        rm -f "frontend/public/podcasts/$PODCAST_ID/topic-taxonomy.json"
        if [ -f "frontend/public/podcasts/$PODCAST_ID/topic-umap-data.json" ]; then
            mv "frontend/public/podcasts/$PODCAST_ID/topic-umap-data.json" "$VARIANT_UMAP"
            echo -e "${GREEN}✓${NC} UMAP data moved to variant directory\n"
        fi
    else
        echo -e "${YELLOW}⚠${NC}  Variant taxonomy not found, skipping UMAP\n"
    fi
else
    echo -e "${GREEN}✓${NC} UMAP data already exists in variant directory\n"
fi

# Phase 5: Generate TS-live files for new episodes
echo -e "${BLUE}⚙️  Phase 5: Generating TS-live Files${NC}\n"

echo -e "${YELLOW}→${NC} Generating TS-live files for new episodes..."
for episode_num in "${NEW_EPISODES[@]}"; do
    echo -e "${YELLOW}  Processing episode $episode_num...${NC}"
    node scripts/generate-ts-live.js --podcast "$PODCAST_ID" --episode "$episode_num" || echo -e "${YELLOW}⚠${NC}  Failed to generate TS-live for episode $episode_num"
done
echo -e "${GREEN}✓${NC} TS-live generation completed\n"

# Phase 6: Copy/Move Files to Frontend
echo -e "${BLUE}📦 Phase 6: Organize Frontend Files${NC}\n"

FRONTEND_PODCAST_DIR="frontend/public/podcasts/$PODCAST_ID"
mkdir -p "$FRONTEND_PODCAST_DIR"
mkdir -p "$FRONTEND_PODCAST_DIR/speakers"
mkdir -p "$FRONTEND_PODCAST_DIR/topics"

echo -e "${YELLOW}→${NC} Copying visualization data files..."

# Copy main visualization files
[ -f "speaker-river-data.json" ] && cp "speaker-river-data.json" "$FRONTEND_PODCAST_DIR/" && echo "  ✓ speaker-river-data.json"
[ -f "speaker-speaker-heatmap.json" ] && cp "speaker-speaker-heatmap.json" "$FRONTEND_PODCAST_DIR/" && echo "  ✓ speaker-speaker-heatmap.json"
[ -f "year-duration-heatmap.json" ] && cp "year-duration-heatmap.json" "$FRONTEND_PODCAST_DIR/" && echo "  ✓ year-duration-heatmap.json"
[ -f "dayofweek-duration-heatmap.json" ] && cp "dayofweek-duration-heatmap.json" "$FRONTEND_PODCAST_DIR/" && echo "  ✓ dayofweek-duration-heatmap.json"
[ -f "speaker-duration-heatmap.json" ] && cp "speaker-duration-heatmap.json" "$FRONTEND_PODCAST_DIR/" && echo "  ✓ speaker-duration-heatmap.json"
[ -f "episodes.json" ] && cp "episodes.json" "$FRONTEND_PODCAST_DIR/" && echo "  ✓ episodes.json"

# Copy topic files from variant directory
VARIANT_DIR="$FRONTEND_PODCAST_DIR/topics/auto-v2.1"
if [ -d "$VARIANT_DIR" ]; then
    echo -e "${GREEN}✓${NC} Topic variant data already in place: $VARIANT_DIR"
fi

# Create symlink for episodes
EPISODES_SYMLINK="$FRONTEND_PODCAST_DIR/episodes"
PODCAST_EPISODES_DIR="podcasts/$PODCAST_ID/episodes"

if [ -d "$PODCAST_EPISODES_DIR" ]; then
    if [ -L "$EPISODES_SYMLINK" ]; then
        rm "$EPISODES_SYMLINK"
    fi
    if [ ! -e "$EPISODES_SYMLINK" ]; then
        ln -s "../../../../podcasts/$PODCAST_ID/episodes" "$EPISODES_SYMLINK"
        echo -e "${GREEN}✓${NC} Created episodes symlink: $EPISODES_SYMLINK → $PODCAST_EPISODES_DIR"
    else
        echo -e "${YELLOW}⚠${NC}  Episodes symlink already exists or target exists"
    fi
fi

# Summary
echo -e "\n${GREEN}✅ New episodes processing completed!${NC}\n"
if [ ${#NEW_EPISODES[@]} -gt 0 ]; then
    echo -e "📝 Processed ${#NEW_EPISODES[@]} new episode(s): ${NEW_EPISODES[*]}"
fi
echo -e "\n📁 Data location:"
echo -e "   Backend: podcasts/$PODCAST_ID/"
echo -e "   Frontend: frontend/public/podcasts/$PODCAST_ID/"
echo -e "\n⚠️  Note: Speaker profiles were NOT updated (as requested)"
echo -e "\n🎯 Next steps:"
echo -e "   1. Start frontend: cd frontend && npm run dev"
echo -e "   2. Select podcast '$PODCAST_ID' in the dropdown"
echo -e "   3. View visualizations at http://localhost:5173"

