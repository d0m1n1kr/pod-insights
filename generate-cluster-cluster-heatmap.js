#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read topic taxonomy
const taxonomyPath = path.join(__dirname, 'topic-taxonomy.json');
const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8'));

// Read all episode files
const episodesDir = path.join(__dirname, 'episodes');
const episodeFiles = fs.readdirSync(episodesDir)
  .filter(f => f.endsWith('.json'))
  .sort((a, b) => {
    const numA = parseInt(a.replace('.json', ''));
    const numB = parseInt(b.replace('.json', ''));
    return numA - numB;
  });

console.log(`Found ${episodeFiles.length} episode files`);

// Build cluster co-occurrence matrix
const clusterEpisodes = new Map(); // cluster ID -> set of episode numbers
const clusterInfo = new Map(); // cluster ID -> {name, totalEpisodes}

// Build cluster info array with episodes from taxonomy
taxonomy.clusters.forEach(cluster => {
  const episodes = new Set();
  
  // Collect all episodes that have topics from this cluster
  if (cluster.topics && Array.isArray(cluster.topics)) {
    cluster.topics.forEach(topic => {
      if (topic.episodes && Array.isArray(topic.episodes)) {
        topic.episodes.forEach(ep => episodes.add(ep));
      }
    });
  }
  
  if (episodes.size > 0) {
    clusterInfo.set(cluster.id, {
      id: cluster.id,
      name: cluster.name,
      totalEpisodes: episodes.size,
      episodes
    });
  }
});

console.log(`Found ${clusterInfo.size} clusters with episodes`);

// Build co-occurrence matrix
const matrix = [];
const clusterArray = Array.from(clusterInfo.values())
  .filter(c => c.totalEpisodes > 0)
  .sort((a, b) => b.totalEpisodes - a.totalEpisodes);

console.log(`Processing ${clusterArray.length} clusters with episodes`);

clusterArray.forEach((cluster1, i) => {
  const row = {
    clusterId: cluster1.id,
    cluster1Name: cluster1.name,
    values: []
  };
  
  clusterArray.forEach((cluster2, j) => {
    // Count episodes where both clusters appear
    const intersection = new Set(
      [...cluster1.episodes].filter(ep => cluster2.episodes.has(ep))
    );
    
    if (intersection.size > 0) {
      row.values.push({
        clusterId: cluster2.id,
        cluster2Name: cluster2.name,
        count: intersection.size,
        episodes: Array.from(intersection).sort((a, b) => a - b)
      });
    }
  });
  
  matrix.push(row);
});

// Create output
const output = {
  generatedAt: new Date().toISOString(),
  description: "Cluster-Cluster Co-occurrence Heatmap Data",
  statistics: {
    totalClusters: clusterArray.length,
    totalCombinations: matrix.reduce((sum, row) => sum + row.values.length, 0),
    topClustersByEpisodes: clusterArray.slice(0, 20).map(c => ({
      id: c.id,
      name: c.name,
      totalEpisodes: c.totalEpisodes
    }))
  },
  clusters: clusterArray.map(c => ({
    id: c.id,
    name: c.name,
    totalEpisodes: c.totalEpisodes
  })),
  matrix
};

// Write output
const outputPath = path.join(__dirname, 'frontend/public/cluster-cluster-heatmap.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✅ Generated cluster-cluster heatmap data`);
console.log(`   Total clusters: ${output.statistics.totalClusters}`);
console.log(`   Total combinations: ${output.statistics.totalCombinations}`);
console.log(`   Output: ${outputPath}`);

