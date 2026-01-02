import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const podcastIndex = args.indexOf('--podcast');
const PODCAST_ID = podcastIndex !== -1 && args[podcastIndex + 1] ? args[podcastIndex + 1] : 'freakshow';

const PROJECT_ROOT = path.join(__dirname, '..');

const DAYS_OF_WEEK = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag'
];

async function generateDayOfWeekDurationHeatmap() {
  console.log(`Processing podcast: ${PODCAST_ID}`);
  console.log('Loading episode files...');
  
  const dataDir = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
  const files = await fs.readdir(dataDir);
  const episodeFiles = files.filter(f => /^\d+\.json$/.test(f));
  
  console.log(`Found ${episodeFiles.length} episode files`);
  
  // Initialize matrix: 7 days x duration buckets
  const matrix = {};
  DAYS_OF_WEEK.forEach(day => {
    matrix[day] = {};
  });
  
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
      
      // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
      const date = new Date(episodeData.date);
      const dayIndex = date.getDay();
      // Convert to Monday-first (0 = Monday, 6 = Sunday)
      const adjustedDayIndex = dayIndex === 0 ? 6 : dayIndex - 1;
      const dayName = DAYS_OF_WEEK[adjustedDayIndex];
      
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
      
      // Add to matrix
      if (!matrix[dayName][durationBucket]) {
        matrix[dayName][durationBucket] = [];
      }
      matrix[dayName][durationBucket].push(episodeNum);
      totalEpisodes++;
      
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
  
  console.log(`Processed ${totalEpisodes} episodes`);
  console.log(`Duration range: ${minDuration} - ${maxDuration} minutes`);
  
  // Create duration buckets list
  const durationBuckets = [];
  for (let d = minDuration; d <= maxDuration; d += 30) {
    durationBuckets.push(d);
  }
  
  // Build heatmap data structure
  const heatmapMatrix = DAYS_OF_WEEK.map(day => ({
    day,
    values: durationBuckets.map(duration => ({
      duration,
      durationLabel: formatDuration(duration),
      count: matrix[day][duration]?.length || 0,
      episodes: matrix[day][duration] || []
    }))
  }));
  
  // Calculate statistics
  let totalCombinations = 0;
  const dayCounts = {};
  const durationCounts = {};
  
  DAYS_OF_WEEK.forEach(day => {
    dayCounts[day] = 0;
  });
  
  durationBuckets.forEach(duration => {
    durationCounts[duration] = 0;
  });
  
  heatmapMatrix.forEach(row => {
    row.values.forEach(cell => {
      if (cell.count > 0) {
        totalCombinations++;
        dayCounts[row.day] += cell.count;
        durationCounts[cell.duration] += cell.count;
      }
    });
  });
  
  // Find most common day and duration
  const sortedDays = Object.entries(dayCounts).sort((a, b) => b[1] - a[1]);
  const sortedDurations = Object.entries(durationCounts).sort((a, b) => b[1] - a[1]);
  
  // Handle case where no episodes were processed
  if (sortedDays.length === 0 || sortedDays[0][1] === 0) {
    console.error('No episodes were processed!');
    return;
  }
  
  const heatmapData = {
    generatedAt: new Date().toISOString(),
    description: 'Day of Week × Episode Duration Heatmap Data',
    statistics: {
      totalEpisodes,
      totalDays: 7,
      totalDurationBuckets: durationBuckets.length,
      totalCombinations,
      mostCommonDay: sortedDays[0][0],
      mostCommonDayCount: sortedDays[0][1],
      mostCommonDuration: parseInt(sortedDurations[0][0]),
      mostCommonDurationLabel: formatDuration(parseInt(sortedDurations[0][0])),
      mostCommonDurationCount: sortedDurations[0][1]
    },
    days: DAYS_OF_WEEK.map(day => ({
      name: day,
      totalEpisodes: dayCounts[day]
    })),
    durations: durationBuckets.map(duration => ({
      minutes: duration,
      label: formatDuration(duration),
      totalEpisodes: durationCounts[duration]
    })),
    matrix: heatmapMatrix
  };
  
  // Write output
  const outputDir = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts', PODCAST_ID);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'dayofweek-duration-heatmap.json');
  await fs.writeFile(outputPath, JSON.stringify(heatmapData, null, 2));
  
  console.log(`\n✓ Generated dayofweek-duration-heatmap.json`);
  console.log(`  - ${totalEpisodes} episodes`);
  console.log(`  - 7 days × ${durationBuckets.length} duration buckets`);
  console.log(`  - ${totalCombinations} non-empty combinations`);
  console.log(`  - Most common: ${sortedDays[0][0]} (${sortedDays[0][1]} episodes)`);
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

generateDayOfWeekDurationHeatmap().catch(console.error);

