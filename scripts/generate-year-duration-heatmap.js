import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateYearDurationHeatmap() {
  console.log('Loading episode files...');
  
  const dataDir = path.join(__dirname, 'episodes');
  const files = await fs.readdir(dataDir);
  const episodeFiles = files.filter(f => /^\d+\.json$/.test(f));
  
  console.log(`Found ${episodeFiles.length} episode files`);
  
  // Initialize matrix: years x duration buckets
  const matrix = {};
  const years = new Set();
  
  let minDuration = Infinity;
  let maxDuration = 0;
  let totalEpisodes = 0;
  
  // Process each episode
  for (const file of episodeFiles) {
    const episodeNum = parseInt(file.split('.')[0]);
    try {
      const episodePath = path.join(dataDir, file);
      const episodeData = JSON.parse(await fs.readFile(episodePath, 'utf-8'));
      
      if (!episodeData.date || !episodeData.duration) continue;
      
      // Get year
      const date = new Date(episodeData.date);
      const year = date.getFullYear();
      years.add(year);
      
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
      
      // Initialize year if not exists
      if (!matrix[year]) {
        matrix[year] = {};
      }
      
      // Add to matrix
      if (!matrix[year][durationBucket]) {
        matrix[year][durationBucket] = [];
      }
      matrix[year][durationBucket].push(episodeNum);
      totalEpisodes++;
      
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
  
  console.log(`Processed ${totalEpisodes} episodes`);
  console.log(`Duration range: ${minDuration} - ${maxDuration} minutes`);
  console.log(`Years: ${Array.from(years).sort().join(', ')}`);
  
  // Create duration buckets list
  const durationBuckets = [];
  for (let d = minDuration; d <= maxDuration; d += 30) {
    durationBuckets.push(d);
  }
  
  // Sort years
  const sortedYears = Array.from(years).sort((a, b) => a - b);
  
  // Build heatmap data structure
  const heatmapMatrix = sortedYears.map(year => ({
    year: year.toString(),
    values: durationBuckets.map(duration => ({
      duration,
      durationLabel: formatDuration(duration),
      count: matrix[year]?.[duration]?.length || 0,
      episodes: matrix[year]?.[duration] || []
    }))
  }));
  
  // Calculate statistics
  let totalCombinations = 0;
  const yearCounts = {};
  const durationCounts = {};
  
  sortedYears.forEach(year => {
    yearCounts[year] = 0;
  });
  
  durationBuckets.forEach(duration => {
    durationCounts[duration] = 0;
  });
  
  heatmapMatrix.forEach(row => {
    row.values.forEach(cell => {
      if (cell.count > 0) {
        totalCombinations++;
        yearCounts[row.year] += cell.count;
        durationCounts[cell.duration] += cell.count;
      }
    });
  });
  
  // Find most common year and duration
  const sortedYearCounts = Object.entries(yearCounts).sort((a, b) => b[1] - a[1]);
  const sortedDurations = Object.entries(durationCounts).sort((a, b) => b[1] - a[1]);
  
  // Handle case where no episodes were processed
  if (sortedYearCounts.length === 0 || sortedYearCounts[0][1] === 0) {
    console.error('No episodes were processed!');
    return;
  }
  
  const heatmapData = {
    generatedAt: new Date().toISOString(),
    description: 'Year × Episode Duration Heatmap Data',
    statistics: {
      totalEpisodes,
      totalYears: sortedYears.length,
      totalDurationBuckets: durationBuckets.length,
      totalCombinations,
      mostCommonYear: sortedYearCounts[0][0],
      mostCommonYearCount: sortedYearCounts[0][1],
      mostCommonDuration: parseInt(sortedDurations[0][0]),
      mostCommonDurationLabel: formatDuration(parseInt(sortedDurations[0][0])),
      mostCommonDurationCount: sortedDurations[0][1]
    },
    years: sortedYears.map(year => ({
      year: year.toString(),
      totalEpisodes: yearCounts[year]
    })),
    durations: durationBuckets.map(duration => ({
      minutes: duration,
      label: formatDuration(duration),
      totalEpisodes: durationCounts[duration]
    })),
    matrix: heatmapMatrix
  };
  
  // Write output
  const outputPath = path.join(__dirname, 'frontend/public/year-duration-heatmap.json');
  await fs.writeFile(outputPath, JSON.stringify(heatmapData, null, 2));
  
  console.log(`\n✓ Generated year-duration-heatmap.json`);
  console.log(`  - ${totalEpisodes} episodes`);
  console.log(`  - ${sortedYears.length} years × ${durationBuckets.length} duration buckets`);
  console.log(`  - ${totalCombinations} non-empty combinations`);
  console.log(`  - Most common: ${sortedYearCounts[0][0]} (${sortedYearCounts[0][1]} episodes)`);
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

generateYearDurationHeatmap().catch(console.error);

