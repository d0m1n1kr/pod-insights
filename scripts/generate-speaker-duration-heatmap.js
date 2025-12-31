import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateSpeakerDurationHeatmap() {
  console.log('Loading episode files...');
  
  const dataDir = path.join(__dirname, 'episodes');
  const files = await fs.readdir(dataDir);
  const episodeFiles = files.filter(f => /^\d+\.json$/.test(f));
  
  console.log(`Found ${episodeFiles.length} episode files`);
  
  // Initialize matrix: speakers x duration buckets
  const matrix = {};
  const speakers = new Set();
  const speakerEpisodeCounts = {};
  
  let minDuration = Infinity;
  let maxDuration = 0;
  let totalEpisodes = 0;
  
  // Process each episode
  for (const file of episodeFiles) {
    const episodeNum = parseInt(file.split('.')[0]);
    try {
      const episodePath = path.join(dataDir, file);
      const episodeData = JSON.parse(await fs.readFile(episodePath, 'utf-8'));
      
      if (!episodeData.date || !episodeData.duration || !episodeData.speakers || episodeData.speakers.length === 0) continue;
      
      // Calculate duration in minutes
      let durationMinutes;
      if (Array.isArray(episodeData.duration) && episodeData.duration.length === 3) {
        const [h, m, s] = episodeData.duration;
        durationMinutes = h * 60 + m + Math.round(s / 60);
      } else {
        continue;
      }
      
      // Round to 30-minute buckets
      const durationBucket = Math.floor(durationMinutes / 30) * 30;
      
      minDuration = Math.min(minDuration, durationBucket);
      maxDuration = Math.max(maxDuration, durationBucket);
      
      // Add to matrix for each speaker in the episode
      for (const speaker of episodeData.speakers) {
        speakers.add(speaker);
        
        // Count episodes per speaker
        if (!speakerEpisodeCounts[speaker]) {
          speakerEpisodeCounts[speaker] = 0;
        }
        speakerEpisodeCounts[speaker]++;
        
        // Initialize speaker if not exists
        if (!matrix[speaker]) {
          matrix[speaker] = {};
        }
        
        // Add to matrix
        if (!matrix[speaker][durationBucket]) {
          matrix[speaker][durationBucket] = [];
        }
        matrix[speaker][durationBucket].push(episodeNum);
      }
      
      totalEpisodes++;
      
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
  
  console.log(`Processed ${totalEpisodes} episodes`);
  console.log(`Duration range: ${minDuration} - ${maxDuration} minutes`);
  console.log(`Speakers: ${speakers.size}`);
  
  // Create duration buckets list
  const durationBuckets = [];
  for (let d = minDuration; d <= maxDuration; d += 30) {
    durationBuckets.push(d);
  }
  
  // Sort speakers by episode count (descending)
  const sortedSpeakers = Array.from(speakers).sort((a, b) => {
    return speakerEpisodeCounts[b] - speakerEpisodeCounts[a];
  });
  
  // Build heatmap data structure
  const heatmapMatrix = sortedSpeakers.map(speaker => ({
    speaker,
    totalEpisodes: speakerEpisodeCounts[speaker],
    values: durationBuckets.map(duration => ({
      duration,
      durationLabel: formatDuration(duration),
      count: matrix[speaker]?.[duration]?.length || 0,
      episodes: matrix[speaker]?.[duration] || []
    }))
  }));
  
  // Calculate statistics
  let totalCombinations = 0;
  const speakerCounts = {};
  const durationCounts = {};
  
  sortedSpeakers.forEach(speaker => {
    speakerCounts[speaker] = 0;
  });
  
  durationBuckets.forEach(duration => {
    durationCounts[duration] = 0;
  });
  
  heatmapMatrix.forEach(row => {
    row.values.forEach(cell => {
      if (cell.count > 0) {
        totalCombinations++;
        speakerCounts[row.speaker] += cell.count;
        durationCounts[cell.duration] += cell.count;
      }
    });
  });
  
  // Find most common speaker and duration
  const sortedSpeakerCounts = Object.entries(speakerCounts).sort((a, b) => b[1] - a[1]);
  const sortedDurations = Object.entries(durationCounts).sort((a, b) => b[1] - a[1]);
  
  // Handle case where no episodes were processed
  if (sortedSpeakerCounts.length === 0 || sortedSpeakerCounts[0][1] === 0) {
    console.error('No episodes were processed!');
    return;
  }
  
  const heatmapData = {
    generatedAt: new Date().toISOString(),
    description: 'Speaker × Episode Duration Heatmap Data',
    statistics: {
      totalEpisodes,
      totalSpeakers: sortedSpeakers.length,
      totalDurationBuckets: durationBuckets.length,
      totalCombinations,
      mostCommonSpeaker: sortedSpeakerCounts[0][0],
      mostCommonSpeakerCount: sortedSpeakerCounts[0][1],
      mostCommonDuration: parseInt(sortedDurations[0][0]),
      mostCommonDurationLabel: formatDuration(parseInt(sortedDurations[0][0])),
      mostCommonDurationCount: sortedDurations[0][1]
    },
    speakers: sortedSpeakers.map(speaker => ({
      name: speaker,
      totalEpisodes: speakerEpisodeCounts[speaker]
    })),
    durations: durationBuckets.map(duration => ({
      minutes: duration,
      label: formatDuration(duration),
      totalEpisodes: durationCounts[duration]
    })),
    matrix: heatmapMatrix
  };
  
  // Write output
  const outputPath = path.join(__dirname, 'frontend/public/speaker-duration-heatmap.json');
  await fs.writeFile(outputPath, JSON.stringify(heatmapData, null, 2));
  
  console.log(`\n✓ Generated speaker-duration-heatmap.json`);
  console.log(`  - ${totalEpisodes} episodes`);
  console.log(`  - ${sortedSpeakers.length} speakers × ${durationBuckets.length} duration buckets`);
  console.log(`  - ${totalCombinations} non-empty combinations`);
  console.log(`  - Most common: ${sortedSpeakerCounts[0][0]} (${sortedSpeakerCounts[0][1]} episodes)`);
  console.log(`  - Most common duration: ${formatDuration(parseInt(sortedDurations[0][0]))} (${sortedDurations[0][1]} episodes)`);
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours === 0) {
    return `${mins}min`;
  } else if (mins === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${mins}min`;
  }
}

generateSpeakerDurationHeatmap().catch(console.error);

