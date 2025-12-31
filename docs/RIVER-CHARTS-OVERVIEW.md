# River Chart Visualization Options

This document provides an overview of all available river chart visualizations for the Freak Show podcast data.

## Overview

The project supports **three types of river charts**, each offering different insights into the podcast's evolution over time:

| Chart Type | Granularity | Number of Streams | Best For |
|------------|-------------|-------------------|----------|
| **Topic River** | Detailed | ~256 topics | Deep dive into specific themes |
| **Category River** | High-level | ~12 categories | Big picture overview |
| **Speaker River** | Individual | ~50+ speakers | Host & guest participation patterns |

## 1. Topic River (Detailed View)

**File:** `topic-river-data.json`  
**Streams:** 256 topic clusters  
**Examples:** "iPhone", "Podcasting", "Bitcoin", "KI & Machine Learning"

### What it shows:
- Detailed evolution of specific topics over time
- When certain technologies/themes emerged and declined
- Topic trends and their relative importance

### Best use cases:
- Finding when specific topics were discussed
- Identifying topic lifecycle (emergence → peak → decline)
- Comparing related topics (e.g., "iPhone" vs "Android")

### Generation:
```bash
npm run cluster-topics    # or ./build-and-run.sh
npm run topic-river
```

### Customization:
- Adjust number of clusters in `settings.json`:
```json
{
  "topicClustering": {
    "clusters": 256  // 128-512 range
  }
}
```

---

## 2. Category River (Overview)

**File:** `category-river-data.json`  
**Streams:** 12 high-level categories  
**Examples:** "Technologie & Hardware", "Politik & Gesellschaft", "Medien & Kommunikation"

### What it shows:
- Broad thematic shifts in podcast focus
- Balance between different content areas
- Long-term strategic direction changes

### Best use cases:
- Understanding overall podcast positioning
- Identifying major focus shifts (e.g., more politics, less tech)
- Getting a quick overview without topic clutter

### Generation:
```bash
npm run cluster-categories
npm run category-river
```

### Customization:
- Adjust number of categories in `settings.json`:
```json
{
  "categoryGrouping": {
    "categories": 12  // 8-25 range
  }
}
```

**Recommendations:**
- **8-10**: Very abstract (good for presentations)
- **12-15**: Balanced (recommended)
- **20-25**: More detailed categories

---

## 3. Speaker River

**File:** `speaker-river-data.json`  
**Streams:** 50+ individual speakers  
**Examples:** "Tim Pritlove", "hukl", "Ralf Stockmann", "Denis Ahrens"

### What it shows:
- Speaker participation over time
- Host changes and guest frequency
- Community evolution

### Best use cases:
- Identifying main hosts across different eras
- Finding when specific guests appeared
- Understanding podcast format changes

### Generation:
```bash
npm run speaker-river
```

**Note:** This visualization is already implemented and doesn't require topic extraction.

---

## Comparison Matrix

### By Implementation Effort

| Chart | Prerequisites | Processing Time | API Costs |
|-------|--------------|----------------|-----------|
| Speaker River | Episode metadata only | ~2 seconds | $0 |
| Topic River | Topics + embeddings + clustering | ~30 seconds | ~$5-10 (one-time) |
| Category River | Topic River + category clustering | ~40 seconds | ~$0.10 (additional) |

### By Information Density

| Chart | Information Density | Visual Complexity | Recommended Filter |
|-------|-------------------|------------------|-------------------|
| Speaker River | Low | Simple | Show top 10-15 |
| Category River | Medium | Moderate | Show all 12 |
| Topic River | High | Complex | Show top 15-20 |

### By Use Case

| Use Case | Best Chart | Why |
|----------|-----------|-----|
| Quick overview | Category River | Few streams, clear patterns |
| Finding specific topic | Topic River | Detailed granularity |
| Host/guest analysis | Speaker River | Individual attribution |
| Identifying trends | Topic River | Shows emergence/decline |
| Strategic overview | Category River | Shows focus areas |
| Format evolution | Speaker River | Shows panel changes |

---

## Frontend Integration

All three charts are integrated into a single interface with tabs:

```
┌─────────────────────────────────────────┐
│  Topics (Detail) │ Kategorien │ Speaker │  ← Tabs
├─────────────────────────────────────────┤
│                                         │
│     [River Visualization]               │
│                                         │
│  Slider: Show top 15 ───●───            │
│                                         │
└─────────────────────────────────────────┘
```

### Controls:
- **Tab switching**: Switch between visualizations
- **Top-N filter**: Show only top N streams (adjustable slider)
- **Hover**: Highlight specific stream
- **Click**: Show details and lock selection

---

## Complete Workflow

### Initial Setup (One-time)
```bash
# 1. Scrape episodes
npm run scrape
npm run scrape-details

# 2. Extract topics with LLM
npm run extract-topics -- --all  # ~$5-10 in API costs

# 3. Create embeddings
npm run create-embeddings  # ~$2-3 in API costs

# 4. Cluster topics
./build-and-run.sh  # Fast with Rust

# 5. Create categories
npm run cluster-categories  # ~$0.10 in API costs

# 6. Generate all river data
npm run topic-river
npm run category-river
npm run speaker-river

# 7. Copy to frontend
cp *-river-data.json frontend/public/

# 8. Start frontend
cd frontend && npm run dev
```

### Regeneration (After changes)

**Change number of categories only:**
```bash
npm run cluster-categories
npm run category-river
cp category-river-data.json frontend/public/
```

**Change number of topic clusters:**
```bash
./build-and-run.sh  # or npm run cluster-topics
npm run topic-river
npm run cluster-categories  # Categories depend on topics
npm run category-river
cp topic-river-data.json category-river-data.json frontend/public/
```

---

## Advanced: Custom River Charts

You could create additional specialized river charts by modifying the aggregation logic:

### Potential Ideas:

**4. Technical Depth River**
- Measure technical complexity of topics
- Streams: "Very Technical", "Moderate", "Accessible"
- Shows podcast accessibility over time

**5. Sentiment River**  
- Analyze topic sentiment
- Streams: "Positive", "Neutral", "Critical", "Controversial"
- Shows tone evolution

**6. Topic Category Facets**
- Multiple rivers showing different category perspectives
- E.g., separate rivers for "Security", "Privacy", "Politics", etc.

**7. Guest Type River**
- Classify guests by domain
- Streams: "Tech Industry", "Journalism", "Academia", "Government"
- Shows diversity of perspectives

**8. Format River**
- Classify episodes by format
- Streams: "News", "Deep Dive", "Interview", "Panel Discussion"

To implement custom rivers:
1. Modify aggregation logic in `generate-*-river.js`
2. Ensure output format matches `TopicRiverData` type
3. Add to frontend if desired

---

## Technical Notes

### Data Format Compatibility

All river visualizations use the same data structure for frontend compatibility:

```typescript
interface RiverData {
  generatedAt: string;
  description: string;
  statistics: {
    totalTopics: number;  // or totalCategories, totalSpeakers
    yearRange: { start: number; end: number };
    years: number[];
  };
  topics: {  // "topics" is used generically for all stream types
    [id: string]: {
      id: string;
      name: string;
      totalEpisodes: number;
      yearData: Array<{
        year: number;
        count: number;
        episodes: Array<{...}>;
      }>;
    };
  };
}
```

### Performance Characteristics

- **Topic River**: Most computationally intensive (clustering)
- **Category River**: Fast (only 12 LLM calls)
- **Speaker River**: Fastest (no LLM needed)

### Storage Requirements

- `topic-embeddings.json`: ~500MB (large, 4000+ vectors)
- `topic-taxonomy.json`: ~1MB (256 clusters)
- `topic-categories.json`: ~50KB (12 categories)
- `topic-river-data.json`: ~5MB (yearly aggregations)
- `category-river-data.json`: ~5KB (fewer streams)
- `speaker-river-data.json`: ~50KB (speaker data)

---

## Tips & Best Practices

1. **Start with Category River** - Get the big picture first
2. **Use Topic River for deep dives** - Explore specific areas of interest
3. **Speaker River complements others** - Correlate topics with guests
4. **Adjust filters dynamically** - Too many streams = visual clutter
5. **Compare across charts** - Switch tabs to see different perspectives

## Conclusion

Each river chart type serves a different purpose:

- **Category River** → Strategic overview, trends
- **Topic River** → Detailed analysis, specific themes  
- **Speaker River** → People and participation

Together, they provide a comprehensive multi-faceted view of the podcast's 300-episode history.

