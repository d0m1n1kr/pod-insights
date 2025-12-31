# UMAP Scatterplot Feature

## Overview

The UMAP (Uniform Manifold Approximation and Projection) scatterplot provides a 2D visualization of all topics in the Freak Show podcast dataset, colored by their cluster assignments. This allows you to see how topics relate to each other in semantic space.

## What is UMAP?

UMAP is a dimensionality reduction technique that projects high-dimensional data (in our case, 3072-dimensional embeddings from OpenAI's `text-embedding-3-large` model) into 2D space while preserving the local and global structure of the data. Points that are close together in 2D space represent topics that are semantically similar.

## Features

### Interactive Visualization
- **4056 topics** plotted as points in 2D space
- **256 clusters** represented by different colors
- Hover over points to see topic details, keywords, and episodes
- Click on points to select and view full details

### Filtering & Search
- Search bar to filter topics by name, cluster, or keywords
- Click cluster badges to highlight specific clusters
- Shows how many topics are displayed after filtering

### Cluster Highlighting
- Top 10 clusters shown as colored badges
- Click a badge to highlight only topics in that cluster
- See cluster size and distribution at a glance

### Statistics
- Total topics count
- Number of clusters
- Clustered vs unclustered topics breakdown

## How to Generate UMAP Data

```bash
# From the project root
npm run generate-umap

# Or directly
node generate-topic-umap.js
```

This script:
1. Loads topic embeddings from `topic-embeddings.json` (3072 dimensions)
2. Loads cluster assignments from `topic-taxonomy.json`
3. Runs UMAP dimensionality reduction to 2D
4. Saves output to `topic-umap-data.json` and `frontend/public/topic-umap-data.json`

### UMAP Parameters

The script uses the following default parameters (adjustable in `generate-topic-umap.js`):

- `nComponents`: 2 (output dimensions)
- `nNeighbors`: 15 (controls local vs global structure balance)
- `minDist`: 0.1 (minimum distance between points)
- `spread`: 1.0 (effective scale of embedded points)

**Tuning Tips:**
- Increase `nNeighbors` (30-50) for more global structure
- Decrease `nNeighbors` (5-10) for more local clusters
- Decrease `minDist` (0.01-0.05) for tighter clusters
- Increase `minDist` (0.3-0.5) for more spread out visualization

## Technical Details

### Data Flow

```
topic-embeddings.json (3072D)
         ↓
  UMAP reduction
         ↓
topic-umap-data.json (2D)
         ↓
   Vue.js + D3.js
         ↓
 Interactive Scatterplot
```

### Dependencies

- **Backend**: `umap-js` npm package
- **Frontend**: D3.js for visualization

### Files Created

- `generate-topic-umap.js` - Script to generate UMAP coordinates
- `frontend/src/views/UmapView.vue` - Vue component for visualization
- `topic-umap-data.json` - Generated UMAP data (~1.5 MB)

## Interpretation

### Cluster Colors
Each cluster is assigned a consistent color based on its ID. The color scheme uses D3's color palettes (Tableau10, Paired, Set3) to ensure visual distinction.

### Unclustered Topics
Topics not assigned to any cluster appear in gray and are labeled "Nicht zugeordnet".

### Spatial Proximity
Topics that appear close together in the visualization are semantically similar according to their embeddings. Distinct groups often represent different themes or categories in the podcast.

### Performance Notes
- Generation takes ~15 seconds for 4056 topics
- File size is ~1.5 MB (JSON with 4056 points)
- Frontend renders smoothly with all points
- Hover interactions are optimized with D3 transitions

## Usage in Frontend

The UMAP view is accessible via the navigation bar at `/umap` or by clicking the "UMAP" tab.

The visualization automatically:
- Scales axes based on data extent
- Colors points by cluster
- Shows tooltips on hover
- Allows point selection for detailed view
- Supports search and filtering

## Future Enhancements

Potential improvements:
- 3D UMAP visualization (nComponents: 3)
- Density plots or contour lines for cluster boundaries
- Animation between different UMAP parameters
- Topic trajectory over time (if embeddings change)
- Export selected clusters or regions
- Integration with episode timeline

## References

- [UMAP Documentation](https://umap-learn.readthedocs.io/)
- [umap-js GitHub](https://github.com/PAIR-code/umap-js)
- [D3.js Documentation](https://d3js.org/)

