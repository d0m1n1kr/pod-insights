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

const EPISODES_DIR = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
const COARSE_SUBJECTS_FILE = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'coarse-subjects.json');

/**
 * Normalize coarse subject name (remove " / Subname" part)
 */
function normalizeCoarseSubject(coarse) {
  if (!coarse || typeof coarse !== 'string') return coarse;
  const trimmed = coarse.trim();
  const parts = trimmed.split(' / ');
  return parts[0].trim();
}

/**
 * Map a subject to a top subject using the subjectMapping
 */
function mapToTopSubject(subject, topSubjects, subjectMapping) {
  // Check if it's already a top subject
  if (topSubjects.includes(subject)) {
    return subject;
  }
  
  // Check mapping
  const mapped = subjectMapping[subject];
  if (mapped && typeof mapped === 'string' && mapped !== 'null' && topSubjects.includes(mapped)) {
    return mapped;
  }
  
  // Return null if not mapped to a top subject
  return null;
}

/**
 * Load topics data (prefer extended-topics, fallback to topics)
 */
function loadTopicsData(episodeNumber) {
  const extendedPath = path.join(EPISODES_DIR, `${episodeNumber}-extended-topics.json`);
  const topicsPath = path.join(EPISODES_DIR, `${episodeNumber}-topics.json`);
  
  let data = null;
  let source = null;
  
  if (fs.existsSync(extendedPath)) {
    data = JSON.parse(fs.readFileSync(extendedPath, 'utf-8'));
    source = 'extended-topics';
  } else if (fs.existsSync(topicsPath)) {
    data = JSON.parse(fs.readFileSync(topicsPath, 'utf-8'));
    source = 'topics';
  }
  
  return { data, source };
}

/**
 * Get timing information for a topic
 * Priority: positionSec/durationSec from topics.json > summaryMeta.startSec/endSec > null
 */
function getTopicTiming(topic, topicsData) {
  // First check if topic has positionSec/durationSec (from topics.json)
  if (typeof topic.positionSec === 'number' && typeof topic.durationSec === 'number') {
    return {
      startSec: topic.positionSec,
      endSec: topic.positionSec + topic.durationSec,
      source: 'topics'
    };
  }
  
  // Fallback to summaryMeta.startSec/endSec (from extended-topics.json)
  if (topic.summaryMeta) {
    const startSec = topic.summaryMeta.startSec;
    const endSec = topic.summaryMeta.endSec;
    
    if (typeof startSec === 'number' && typeof endSec === 'number' && endSec >= startSec) {
      return {
        startSec,
        endSec,
        source: 'summaryMeta'
      };
    }
  }
  
  return {
    startSec: null,
    endSec: null,
    source: null
  };
}

/**
 * Generate subject radar chart data and timeline for an episode
 */
function generateEpisodeSubjects(episodeNumber, coarseSubjectsData) {
  const { data: topicsData, source } = loadTopicsData(episodeNumber);
  
  if (!topicsData || !topicsData.topics || !Array.isArray(topicsData.topics)) {
    return null;
  }
  
  const topSubjects = coarseSubjectsData.topSubjects || [];
  const subjectMapping = coarseSubjectsData.subjectMapping || {};
  
  // Initialize radar chart values (duration-based)
  const radarValues = {};
  const topicCounts = {};
  topSubjects.forEach(subject => {
    radarValues[subject] = 0;
    topicCounts[subject] = 0;
  });
  
  // Build timeline entries
  const timelineEntries = [];
  let totalDuration = 0;
  
  // Process each topic
  for (const topic of topicsData.topics) {
    if (!topic.subject || !topic.subject.coarse) {
      continue;
    }
    
    const coarseRaw = normalizeCoarseSubject(topic.subject.coarse);
    const topSubject = mapToTopSubject(coarseRaw, topSubjects, subjectMapping);
    
    if (!topSubject) {
      // Skip subjects not mapped to top subjects
      continue;
    }
    
    const timing = getTopicTiming(topic, topicsData);
    
    // Update radar chart values (based on duration)
    if (timing.startSec !== null && timing.endSec !== null) {
      const duration = timing.endSec - timing.startSec;
      radarValues[topSubject] += duration;
      totalDuration += duration;
    }
    
    // Count topics per subject
    topicCounts[topSubject]++;
    
    // Add timeline entry
    if (timing.startSec !== null && timing.endSec !== null) {
      timelineEntries.push({
        subject: topSubject,
        startSec: timing.startSec,
        endSec: timing.endSec,
        durationSec: timing.endSec - timing.startSec,
        topic: topic.topic,
        fineSubject: topic.subject.fine || null,
        topicIndex: topicsData.topics.indexOf(topic)
      });
    } else {
      // Topic without timing - still add to timeline but mark as untimed
      timelineEntries.push({
        subject: topSubject,
        startSec: null,
        endSec: null,
        durationSec: null,
        topic: topic.topic,
        fineSubject: topic.subject.fine || null,
        topicIndex: topicsData.topics.indexOf(topic),
        untimed: true
      });
    }
  }
  
  // Normalize radar values to 0-1 range (based on total duration)
  const normalizedRadarValues = {};
  if (totalDuration > 0) {
    topSubjects.forEach(subject => {
      normalizedRadarValues[subject] = radarValues[subject] / totalDuration;
    });
  } else {
    // If no timing data, use topic counts instead
    const totalTopics = Object.values(topicCounts).reduce((a, b) => a + b, 0);
    if (totalTopics > 0) {
      topSubjects.forEach(subject => {
        normalizedRadarValues[subject] = topicCounts[subject] / totalTopics;
      });
    } else {
      topSubjects.forEach(subject => {
        normalizedRadarValues[subject] = 0;
      });
    }
  }
  
  // Sort timeline by startSec (untimed entries go to the end)
  timelineEntries.sort((a, b) => {
    if (a.startSec === null && b.startSec === null) return 0;
    if (a.startSec === null) return 1;
    if (b.startSec === null) return -1;
    return a.startSec - b.startSec;
  });
  
  // Build output
  const output = {
    episodeNumber: episodeNumber,
    title: topicsData.title || null,
    generatedAt: new Date().toISOString(),
    dataSource: source,
    
    // Radar chart data
    radarChart: {
      // Normalized values (0-1) for each top subject
      values: normalizedRadarValues,
      // Raw duration in seconds for each subject
      durations: radarValues,
      // Topic counts per subject
      topicCounts: topicCounts,
      // Total duration of all timed topics
      totalDurationSec: totalDuration,
      // Total number of topics
      totalTopics: topicsData.topics.length
    },
    
    // Subject timeline (chronological)
    timeline: timelineEntries
  };
  
  return output;
}

/**
 * Main function
 */
function main() {
  console.log(`📊 Generating episode subject data for ${PODCAST_ID}\n`);
  
  // Load coarse subjects data
  if (!fs.existsSync(COARSE_SUBJECTS_FILE)) {
    console.error(`❌ Coarse subjects file not found: ${COARSE_SUBJECTS_FILE}`);
    console.error(`   Run generate-coarse-subjects.js first!`);
    process.exit(1);
  }
  
  const coarseSubjectsData = JSON.parse(fs.readFileSync(COARSE_SUBJECTS_FILE, 'utf-8'));
  console.log(`✅ Loaded coarse subjects: ${coarseSubjectsData.topSubjects.length} top subjects\n`);
  
  // Parse episode filter arguments
  const episodeIndex = args.indexOf('--episode');
  const fromIndex = args.indexOf('--from');
  const toIndex = args.indexOf('--to');
  const allFlag = args.includes('--all');
  const overwriteFlag = args.includes('--overwrite');
  
  let targetEpisodes = [];
  
  if (episodeIndex !== -1 && args[episodeIndex + 1]) {
    // Single episode
    const episodeNumber = parseInt(args[episodeIndex + 1], 10);
    targetEpisodes = [episodeNumber];
  } else if (allFlag || fromIndex !== -1 || toIndex !== -1) {
    // Range or all episodes
    const files = fs.readdirSync(EPISODES_DIR);
    const episodeNumbers = files
      .filter(f => /^\d+-(topics|extended-topics)\.json$/.test(f))
      .map(f => {
        const match = f.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter(n => n !== null)
      .sort((a, b) => a - b);
    
    const uniqueEpisodes = [...new Set(episodeNumbers)];
    
    if (fromIndex !== -1 || toIndex !== -1) {
      const from = fromIndex !== -1 ? parseInt(args[fromIndex + 1], 10) : -Infinity;
      const to = toIndex !== -1 ? parseInt(args[toIndex + 1], 10) : Infinity;
      targetEpisodes = uniqueEpisodes.filter(n => n >= from && n <= to);
    } else {
      targetEpisodes = uniqueEpisodes;
    }
  } else {
    console.error('❌ Specify --episode <n>, --all, or --from/--to range');
    console.error('   Example: node scripts/generate-episode-subjects.js --podcast freakshow --episode 123');
    console.error('   Example: node scripts/generate-episode-subjects.js --podcast freakshow --all');
    process.exit(1);
  }
  
  console.log(`📝 Processing ${targetEpisodes.length} episode(s)\n`);
  
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const episodeNumber of targetEpisodes) {
    const outputPath = path.join(EPISODES_DIR, `${episodeNumber}-subjects.json`);
    
    if (!overwriteFlag && fs.existsSync(outputPath)) {
      console.log(`⏭️  Episode ${episodeNumber}: output exists, skipping (use --overwrite)`);
      skipped++;
      continue;
    }
    
    try {
      const result = generateEpisodeSubjects(episodeNumber, coarseSubjectsData);
      
      if (!result) {
        console.log(`⚠️  Episode ${episodeNumber}: no topics data found`);
        skipped++;
        continue;
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');
      console.log(`✅ Episode ${episodeNumber}: ${result.timeline.length} timeline entries, ${Object.keys(result.radarChart.values).filter(k => result.radarChart.values[k] > 0).length} subjects`);
      processed++;
    } catch (error) {
      console.error(`❌ Episode ${episodeNumber}: ${error.message}`);
      errors++;
    }
  }
  
  console.log(`\n✅ Done! Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
}

try {
  main();
} catch (error) {
  console.error('❌ Critical error:', error);
  process.exit(1);
}

