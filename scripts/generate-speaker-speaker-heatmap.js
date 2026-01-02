#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const podcastIndex = args.indexOf('--podcast');
const PODCAST_ID = podcastIndex !== -1 && args[podcastIndex + 1] ? args[podcastIndex + 1] : 'freakshow';

const PROJECT_ROOT = path.join(__dirname, '..');
// Read all episode files
const episodesDir = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
const episodeFiles = fs.readdirSync(episodesDir)
  .filter(f => f.endsWith('.json'))
  .sort((a, b) => {
    const numA = parseInt(a.replace('.json', ''));
    const numB = parseInt(b.replace('.json', ''));
    return numA - numB;
  });

console.log(`Processing podcast: ${PODCAST_ID}`);
console.log(`Found ${episodeFiles.length} episode files`);

// Build speaker co-occurrence matrix
const speakerEpisodes = new Map(); // speaker name -> set of episode numbers

// First pass: collect all speakers and their episodes
episodeFiles.forEach(file => {
  const episodeNum = parseInt(file.replace('.json', ''));
  const episodePath = path.join(episodesDir, file);
  
  try {
    const episode = JSON.parse(fs.readFileSync(episodePath, 'utf-8'));
    
    if (!episode.speakers || episode.speakers.length === 0) return;
    
    episode.speakers.forEach(speaker => {
      if (!speakerEpisodes.has(speaker)) {
        speakerEpisodes.set(speaker, new Set());
      }
      speakerEpisodes.get(speaker).add(episodeNum);
    });
    
  } catch (error) {
    console.error(`Error processing ${file}:`, error.message);
  }
});

// Build speaker info array
const speakerArray = Array.from(speakerEpisodes.entries())
  .map(([name, episodes]) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    totalEpisodes: episodes.size,
    episodes
  }))
  .sort((a, b) => b.totalEpisodes - a.totalEpisodes);

console.log(`Processing ${speakerArray.length} speakers`);

// Build co-occurrence matrix
const matrix = [];

speakerArray.forEach((speaker1, i) => {
  const row = {
    speakerId: speaker1.id,
    speaker1Name: speaker1.name,
    values: []
  };
  
  speakerArray.forEach((speaker2, j) => {
    // Count episodes where both speakers appear
    const intersection = new Set(
      [...speaker1.episodes].filter(ep => speaker2.episodes.has(ep))
    );
    
    if (intersection.size > 0) {
      row.values.push({
        speakerId: speaker2.id,
        speaker2Name: speaker2.name,
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
  description: "Speaker-Speaker Co-occurrence Heatmap Data",
  statistics: {
    totalSpeakers: speakerArray.length,
    totalCombinations: matrix.reduce((sum, row) => sum + row.values.length, 0),
    topSpeakersByEpisodes: speakerArray.slice(0, 20).map(s => ({
      id: s.id,
      name: s.name,
      totalEpisodes: s.totalEpisodes
    }))
  },
  speakers: speakerArray.map(s => ({
    id: s.id,
    name: s.name,
    totalEpisodes: s.totalEpisodes
  })),
  matrix
};

// Write output
const outputDir = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts', PODCAST_ID);
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'speaker-speaker-heatmap.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✅ Generated speaker-speaker heatmap data`);
console.log(`   Total speakers: ${output.statistics.totalSpeakers}`);
console.log(`   Total combinations: ${output.statistics.totalCombinations}`);
console.log(`   Output: ${outputPath}`);

