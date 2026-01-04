/**
 * Generate episode data files from RSS feed
 * 
 * This script fetches episodes from a podcast RSS feed and generates:
 * - Episode JSON files (N.json) with metadata
 * - Chapters JSON files (N-chapters.json) from podcast:chapters URLs
 * - Transcript JSON files (N-ts.json) from podcast:transcript URLs
 * 
 * The output format is compatible with the existing scrape scripts.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const podcastIndex = args.indexOf('--podcast');
const PODCAST_ID = podcastIndex !== -1 && args[podcastIndex + 1] ? args[podcastIndex + 1] : 'minkorrekt';
const FORCE = args.includes('--force') || args.includes('-f');

// Parse episode filter
const episodeIndex = args.indexOf('--episode');
const EPISODE_FILTER = episodeIndex !== -1 && args[episodeIndex + 1] 
  ? parseInt(args[episodeIndex + 1], 10) 
  : null;

const PROJECT_ROOT = path.join(__dirname, '..');
const EPISODES_DIR = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');

// Load podcasts.json to get feed URL
const PODCASTS_JSON = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts.json');

// Parse duration string like "5974" (seconds) or "1:39:34" into [hh, mm, ss]
function parseDuration(durationText) {
  if (!durationText) return [0, 0, 0];
  
  const s = String(durationText).trim();
  
  // If it's just a number, assume seconds
  if (/^\d+$/.test(s)) {
    const totalSeconds = parseInt(s, 10);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds];
  }
  
  // Try HH:MM:SS or MM:SS format
  const parts = s.split(':').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
  if (parts.length === 3) {
    return [parts[0], parts[1], parts[2]];
  } else if (parts.length === 2) {
    return [0, parts[0], parts[1]];
  }
  
  return [0, 0, 0];
}

// Parse date string like "Tue, 16 Dec 2025 09:39:46 +0000" into "yyyy-mm-dd"
function parseDate(dateText) {
  if (!dateText) return null;
  
  try {
    const date = new Date(dateText);
    if (isNaN(date.getTime())) return null;
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    return null;
  }
}

// Extract episode number from title like "Mi374" or "Mi374 – "Ig-Nobelpreis-Sonderfolge 2025""
// or "Minkorrekt Folge 26 „In Ear Löffelglocke"" or "WR324 Realität als Einschränkung"
// Format is always: <letters><number> (e.g., "WR324", "Mi374")
function extractEpisodeNumber(title) {
  if (!title) return null;
  
  // Match pattern: one or more letters followed by digits (e.g., "Mi374", "WR324", "LNP540")
  // This must be at the start of the title or after whitespace
  const match = title.match(/(?:^|\s)([A-Za-z]+)(\d+)(?:\s|$|–|-|„|"|\))/);
  if (match) {
    const num = parseInt(match[2], 10);
    // Only return if it's a reasonable episode number (not a year like 2025)
    if (num > 0 && num < 10000) {
      return num;
    }
  }
  
  // Fallback: Match "Minkorrekt Folge" or "Folge" followed by digits (e.g., "Minkorrekt Folge 26")
  const folgeMatch = title.match(/(?:Minkorrekt\s+)?Folge\s+(\d+)/i);
  if (folgeMatch) {
    const num = parseInt(folgeMatch[1], 10);
    if (num > 0 && num < 10000) {
      return num;
    }
  }
  
  return null;
}

// Download a URL and return the response text
async function fetchUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`  ✗ Error fetching ${url}:`, error.message);
    return null;
  }
}

// Parse PSCC (Podcast Simple Chapters) format
function parsePSCC(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text'
  });
  
  try {
    const json = parser.parse(xmlText);
    const chapters = [];
    
    // PSCC format: <psc:chapters version="1.2"><psc:chapter start="..." title="..."/>
    const chaptersEl = json['psc:chapters'] || json.chapters;
    if (!chaptersEl) return [];
    
    const chapterList = Array.isArray(chaptersEl['psc:chapter']) 
      ? chaptersEl['psc:chapter'] 
      : (chaptersEl['psc:chapter'] ? [chaptersEl['psc:chapter']] : []);
    
    chapterList.forEach((ch, idx) => {
      const start = ch['@_start'] || ch.start;
      const title = ch['@_title'] || ch.title || '';
      
      if (start && title) {
        const startSec = parseDurationToSeconds(start);
        chapters.push({
          number: idx + 1,
          title: title.trim(),
          startSec: startSec
        });
      }
    });
    
    // Sort by start time and calculate durations
    chapters.sort((a, b) => a.startSec - b.startSec);
    
    return chapters.map((ch, idx) => {
      const next = chapters[idx + 1];
      const durationSec = next ? next.startSec - ch.startSec : 0;
      
      return {
        number: ch.number,
        title: ch.title,
        durationSec: Math.max(0, Math.floor(durationSec)),
        positionSec: Math.floor(ch.startSec)
      };
    });
  } catch (error) {
    console.error(`  ✗ Error parsing PSCC:`, error.message);
    return [];
  }
}

// Parse duration string to seconds
function parseDurationToSeconds(durationText) {
  if (!durationText) return 0;
  
  const s = String(durationText).trim();
  
  // HH:MM:SS.mmm or MM:SS.mmm format
  const parts = s.split(':').map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  
  // Try as seconds
  const seconds = parseFloat(s);
  return isNaN(seconds) ? 0 : seconds;
}

// Parse VTT transcript format
function parseVTT(vttText) {
  const entries = [];
  const lines = vttText.split('\n');
  
  let i = 0;
  // Skip WEBVTT header
  while (i < lines.length && (lines[i].trim() === '' || lines[i].includes('WEBVTT'))) {
    i++;
  }
  
  while (i < lines.length) {
    // Skip empty lines
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    
    // Check if this is a timestamp line (format: 00:00:01.260 --> 00:00:03.239)
    const timeMatch = lines[i].match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (timeMatch) {
      // Parse start and end times
      const startHours = parseInt(timeMatch[1], 10);
      const startMinutes = parseInt(timeMatch[2], 10);
      const startSeconds = parseInt(timeMatch[3], 10);
      const startMillis = parseInt(timeMatch[4], 10);
      const startSec = startHours * 3600 + startMinutes * 60 + startSeconds + startMillis / 1000;
      
      const endHours = parseInt(timeMatch[5], 10);
      const endMinutes = parseInt(timeMatch[6], 10);
      const endSeconds = parseInt(timeMatch[7], 10);
      const endMillis = parseInt(timeMatch[8], 10);
      const endSec = endHours * 3600 + endMinutes * 60 + endSeconds + endMillis / 1000;
      
      const durationSec = endSec - startSec;
      
      // Get the text line(s) that follow
      i++;
      let text = '';
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/)) {
        text += (text ? ' ' : '') + lines[i].trim();
        i++;
      }
      
      // Extract speaker from text
      // Try patterns: "Speaker 0: text", "Speaker 1: text", "Ruth: text", "Florian: text", etc.
      let speaker = '';
      
      // First try "Speaker 0/1" pattern
      let speakerMatch = text.match(/^Speaker\s+(\d+):\s*(.+)$/i);
      if (speakerMatch) {
        speaker = `Speaker ${speakerMatch[1]}`;
        text = speakerMatch[2];
      } else {
        // Try actual speaker name pattern (e.g., "Ruth:", "Florian:", "Nico:", etc.)
        // Match word characters followed by colon at the start of the text
        speakerMatch = text.match(/^([A-Za-zÄÖÜäöüß]+):\s*(.+)$/);
        if (speakerMatch) {
          speaker = speakerMatch[1];
          text = speakerMatch[2];
        }
      }
      
      if (text) {
        entries.push({
          speaker: speaker,
          time: formatTime(startSec),
          duration: Math.max(0, Math.floor(durationSec * 1000) / 1000), // Duration in seconds with 3 decimal places
          text: text
        });
      }
    } else {
      i++;
    }
  }
  
  return entries;
}

// Parse transcript JSON (various formats)
function parseTranscript(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    
    // Helper function to extract speaker from text if speaker field is empty
    function extractSpeakerFromText(speaker, text) {
      if (speaker && speaker.trim()) {
        return { speaker, text };
      }
      // Try to extract speaker name from text (e.g., "Ruth:", "Florian:", "Nico:")
      const speakerMatch = text.match(/^([A-Za-zÄÖÜäöüß]+):\s*(.+)$/);
      if (speakerMatch) {
        return { speaker: speakerMatch[1], text: speakerMatch[2] };
      }
      return { speaker: '', text };
    }
    
    // Format 1: { transcript: [{ speaker, time, text }] }
    if (data.transcript && Array.isArray(data.transcript)) {
      return data.transcript.map(item => {
        const speaker = item.speaker || item.speakerName || item.name || '';
        let text = item.text || item.content || item.transcript || '';
        const extracted = extractSpeakerFromText(speaker, text);
        return {
          speaker: extracted.speaker,
          time: item.time || item.startTime || item.timestamp || formatTime(item.start || item.startSec || 0),
          text: extracted.text,
          duration: item.duration || undefined
        };
      });
    }
    
    // Format 2: Array directly [{ speaker, time, text }]
    if (Array.isArray(data)) {
      return data.map(item => {
        const speaker = item.speaker || item.speakerName || item.name || '';
        let text = item.text || item.content || item.transcript || '';
        const extracted = extractSpeakerFromText(speaker, text);
        return {
          speaker: extracted.speaker,
          time: item.time || item.startTime || item.timestamp || formatTime(item.start || item.startSec || 0),
          text: extracted.text,
          duration: item.duration || undefined
        };
      });
    }
    
    // Format 3: { segments: [{ speaker, startTime, text }] }
    if (data.segments && Array.isArray(data.segments)) {
      return data.segments.map(seg => {
        const speaker = seg.speaker || seg.speakerName || seg.name || '';
        let text = seg.text || seg.content || seg.transcript || '';
        const extracted = extractSpeakerFromText(speaker, text);
        return {
          speaker: extracted.speaker,
          time: seg.time || seg.startTime || seg.timestamp || formatTime(seg.start || seg.startSec || 0),
          text: extracted.text,
          duration: seg.duration || undefined
        };
      });
    }
    
    // Format 4: Podigee format - object with numeric keys: { "0": { start, end, text }, "1": {...} }
    // Check if data is an object with numeric string keys (and possibly other keys)
    const numericKeys = Object.keys(data).filter(k => /^\d+$/.test(k));
    if (numericKeys.length > 0) {
      // This is Podigee format - convert to array format
      const entries = numericKeys
        .map(k => parseInt(k, 10))
        .sort((a, b) => a - b)
        .map(k => {
          const entry = data[String(k)];
          const speaker = entry.speaker || entry.speakerName || '';
          let text = entry.text || entry.word || entry.content || '';
          const extracted = extractSpeakerFromText(speaker, text);
          return {
            speaker: extracted.speaker,
            time: formatTime(entry.start || entry.startTime || 0),
            text: extracted.text
          };
        })
        .filter(e => e.text); // Filter out empty entries
      
      if (entries.length > 0) {
        return entries;
      }
    }
    
    // Format 5: Podigee format - { words: [{ word, start, speaker }] } or similar
    if (data.words && Array.isArray(data.words)) {
      // Group words by speaker and time windows
      const segments = [];
      let currentSegment = null;
      
      for (const word of data.words) {
        const speaker = word.speaker || word.speakerName || '';
        const start = word.start || word.startTime || 0;
        const text = word.word || word.text || '';
        
        if (!currentSegment || currentSegment.speaker !== speaker || 
            (start - currentSegment.startSec) > 2) { // New segment if >2s gap or different speaker
          if (currentSegment) {
            segments.push({
              speaker: currentSegment.speaker,
              time: formatTime(currentSegment.startSec),
              text: currentSegment.text.trim()
            });
          }
          currentSegment = {
            speaker: speaker,
            startSec: start,
            text: text
          };
        } else {
          currentSegment.text += ' ' + text;
        }
      }
      
      if (currentSegment) {
        segments.push({
          speaker: currentSegment.speaker,
          time: formatTime(currentSegment.startSec),
          text: currentSegment.text.trim()
        });
      }
      
      return segments;
    }
    
    // Format 5: Plain text segments without speaker/time
    if (data.segments && Array.isArray(data.segments) && data.segments[0] && typeof data.segments[0] === 'string') {
      return data.segments.map((text, idx) => ({
        speaker: '',
        time: formatTime(idx * 5), // Estimate 5 seconds per segment
        text: text
      }));
    }
    
    console.warn(`  ⚠ Unknown transcript format. Keys:`, Object.keys(data));
    // Try to extract any text content
    if (data.text) {
      return [{
        speaker: '',
        time: '0:00',
        text: typeof data.text === 'string' ? data.text : JSON.stringify(data.text)
      }];
    }
    
    return [];
  } catch (error) {
    console.error(`  ✗ Error parsing transcript JSON:`, error.message);
    return [];
  }
}

// Format seconds as HH:MM:SS
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function printHelp() {
  console.log(`
Generate episode data files from RSS feed

Usage:
  node scripts/generate-from-feed.js [options]

Options:
  --podcast <id>    Podcast ID (default: minkorrekt)
  --episode <num>   Process only this episode number (for testing)
  --force, -f       Overwrite existing episode files
  --help, -h        Show this help message

Examples:
  node scripts/generate-from-feed.js --podcast minkorrekt
  node scripts/generate-from-feed.js --podcast minkorrekt --force
  node scripts/generate-from-feed.js --podcast minkorrekt --episode 248
`);
}

async function generateFromFeed() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  
  console.log(`Generating episode data from feed for podcast: ${PODCAST_ID}`);
  if (FORCE) {
    console.log('⚠ Force mode enabled - will overwrite existing files');
  }
  if (EPISODE_FILTER !== null) {
    console.log(`🔍 Filtering: Only processing episode ${EPISODE_FILTER}`);
  }
  
  // Load podcasts.json to get feed URL
  let podcastsData;
  try {
    const podcastsJson = await fs.readFile(PODCASTS_JSON, 'utf-8');
    podcastsData = JSON.parse(podcastsJson);
  } catch (error) {
    console.error(`Error loading podcasts.json:`, error.message);
    process.exit(1);
  }
  
  const podcast = podcastsData.podcasts?.find(p => p.id === PODCAST_ID);
  if (!podcast) {
    console.error(`Error: Podcast '${PODCAST_ID}' not found in podcasts.json`);
    process.exit(1);
  }
  
  const feedUrl = podcast.feedUrl;
  if (!feedUrl) {
    console.error(`Error: feedUrl not configured for podcast '${PODCAST_ID}'`);
    process.exit(1);
  }
  
  console.log(`Feed URL: ${feedUrl}`);
  console.log(`Episodes directory: ${EPISODES_DIR}\n`);
  
  // Create episodes directory
  await fs.mkdir(EPISODES_DIR, { recursive: true });
  
  // Fetch RSS feed
  console.log('Fetching RSS feed...');
  const feedXml = await fetchUrl(feedUrl);
  if (!feedXml) {
    console.error('Failed to fetch RSS feed');
    process.exit(1);
  }
  
  // Parse XML - handle namespaces properly
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    parseTagValue: true,
    ignoreNameSpace: false,
    removeNSPrefix: false,
    parseTrueNumberOnly: false,
    // Preserve namespaces
    nameSpace: true
  });
  
  const feedData = parser.parse(feedXml);
  
  // Extract items - handle different namespace formats
  const channel = feedData.rss?.channel || feedData.feed || feedData['rss:rss']?.channel;
  if (!channel) {
    console.error('Invalid RSS feed format');
    console.error('Available keys:', Object.keys(feedData));
    process.exit(1);
  }
  
  // Handle items - could be array or single object
  let items = [];
  if (channel.item) {
    items = Array.isArray(channel.item) ? channel.item : [channel.item];
  } else if (channel['rss:item']) {
    items = Array.isArray(channel['rss:item']) ? channel['rss:item'] : [channel['rss:item']];
  }
  console.log(`Found ${items.length} episodes in feed\n`);
  
  // Debug: log structure to understand namespace handling
  if (items.length > 0) {
    const firstItem = Array.isArray(channel.item) ? channel.item[0] : channel.item;
    console.log('Sample item keys:', Object.keys(firstItem || {}));
    if (firstItem) {
      console.log('Looking for podcast:chapters/transcript in:', 
        Object.keys(firstItem).filter(k => k.includes('podcast') || k.includes('chapter') || k.includes('transcript')));
    }
  }
  
  // Extract URLs from raw XML as fallback (more reliable for namespaces)
  const itemXmlMatches = feedXml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const itemUrls = new Map(); // episode number -> { chaptersUrl, transcriptUrls: [] }
  
  console.log(`Extracting URLs from ${itemXmlMatches.length} items in raw XML...`);
  let chaptersFound = 0;
  let transcriptsFound = 0;
  
  for (let i = 0; i < Math.min(items.length, itemXmlMatches.length); i++) {
    const itemXml = itemXmlMatches[i];
    
    // Extract title from XML directly (more reliable)
    const titleMatch = itemXml.match(/<title>([^<]+)<\/title>/i) || itemXml.match(/<itunes:title>([^<]+)<\/itunes:title>/i);
    const title = titleMatch ? titleMatch[1] : (items[i]?.title || items[i]?.['itunes:title'] || '');
    
    // Extract podcast:chapters URL from XML - try both 'url' and 'href' attributes
    const chaptersMatch = itemXml.match(/<podcast:chapters[^>]*(?:url|href)=['"]([^'"]+)['"]/i) ||
                         itemXml.match(/<psc:chapters[^>]*(?:url|href)=['"]([^'"]+)['"]/i);
    const chaptersUrl = chaptersMatch ? chaptersMatch[1] : null;
    
    // Extract podcast:transcript URLs from XML - try both 'url' and 'href' attributes
    const transcriptMatches = itemXml.match(/<podcast:transcript[^>]*(?:url|href)=['"]([^'"]+)['"]/gi) || [];
    const transcriptUrls = transcriptMatches.map(m => {
      const urlMatch = m.match(/(?:url|href)=['"]([^'"]+)['"]/i);
      return urlMatch ? urlMatch[1] : null;
    }).filter(Boolean);
    
    // Extract episode number - try from title first, then from URLs as fallback
    let episodeNumber = extractEpisodeNumber(title);
    
    // Fallback: extract episode number from chapter/transcript URLs if title extraction failed
    if (!episodeNumber) {
      if (chaptersUrl) {
        const urlMatch = chaptersUrl.match(/\/(\d+)-/);
        if (urlMatch) {
          episodeNumber = parseInt(urlMatch[1], 10);
        }
      }
      if (!episodeNumber && transcriptUrls.length > 0) {
        for (const url of transcriptUrls) {
          const urlMatch = url.match(/\/(\d+)-/);
          if (urlMatch) {
            episodeNumber = parseInt(urlMatch[1], 10);
            break;
          }
        }
      }
    }
    
    // Only process if we have URLs and can extract episode number
    if (chaptersUrl || transcriptUrls.length > 0) {
      if (episodeNumber) {
        const existing = itemUrls.get(episodeNumber) || { chaptersUrl: null, transcriptUrls: [] };
        if (chaptersUrl) {
          existing.chaptersUrl = chaptersUrl;
          chaptersFound++;
          console.log(`  Found chapters for episode ${episodeNumber}: ${chaptersUrl}`);
        }
        if (transcriptUrls.length > 0) {
          existing.transcriptUrls = transcriptUrls;
          transcriptsFound++;
        }
        itemUrls.set(episodeNumber, existing);
      } else {
        // Log but don't skip - might be useful for debugging
        if (chaptersUrl) {
          console.log(`  ⚠ Found chapters but couldn't extract episode number from title or URL: ${title.substring(0, 50)}`);
        }
      }
    }
  }
  
  console.log(`Found ${chaptersFound} items with chapters, ${transcriptsFound} items with transcripts\n`);
  
  let savedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  // Process each episode
  for (const item of items) {
    try {
      const title = item.title || item['itunes:title'] || '';
      const episodeNumber = extractEpisodeNumber(title);
      
      if (!episodeNumber) {
        console.log(`Skipping episode with unparseable number: ${title}`);
        skippedCount++;
        continue;
      }
      
      // Filter by episode number if specified
      if (EPISODE_FILTER !== null && episodeNumber !== EPISODE_FILTER) {
        continue;
      }
      
      console.log(`Processing episode ${episodeNumber}: ${title}`);
      
      // Check if episode already exists
      const episodeFile = path.join(EPISODES_DIR, `${episodeNumber}.json`);
      const chaptersFile = path.join(EPISODES_DIR, `${episodeNumber}-chapters.json`);
      let episodeExists = false;
      
      if (!FORCE) {
        try {
          await fs.access(episodeFile);
          episodeExists = true;
          // Check if chapters file also exists
          try {
            await fs.access(chaptersFile);
            console.log(`  ⊘ Episode ${episodeNumber} already exists with chapters, skipping (use --force to overwrite)`);
            skippedCount++;
            continue;
          } catch {
            // Episode exists but chapters file doesn't - we'll still process to create chapters file
            console.log(`  ⚠ Episode ${episodeNumber} exists but chapters file missing, will create chapters file`);
          }
        } catch {
          // File doesn't exist, continue
        }
      }
      
      // Extract episode data
      const pubDate = item.pubDate || item['dc:date'];
      const link = item.link || item.guid?.['#text'] || item.guid;
      const description = item.description || item['itunes:summary'] || '';
      const contentEncoded = item['content:encoded'] || item['content'] || '';
      const durationText = item['itunes:duration'] || item.duration;
      const duration = parseDuration(durationText);
      const date = parseDate(pubDate);
      
      // Extract podcast:chapters and transcript URLs
      // First try from parsed XML, then fallback to raw XML extraction
      let chaptersUrl = null;
      let transcriptUrls = [];
      
      // Try from parsed XML first
      const possibleChapterKeys = ['podcast:chapters', '@_podcast:chapters', 'chapters', 'psc:chapters'];
      for (const key of possibleChapterKeys) {
        const chaptersEl = item[key];
        if (chaptersEl) {
          if (typeof chaptersEl === 'string' && chaptersEl.startsWith('http')) {
            chaptersUrl = chaptersEl;
            break;
          } else if (typeof chaptersEl === 'object') {
            // Try both 'url' and 'href' attributes (Podigee uses 'href')
            chaptersUrl = chaptersEl['@_url'] || chaptersEl['@_href'] || chaptersEl.url || chaptersEl.href || chaptersEl['#text'] || null;
            if (chaptersUrl) break;
          }
        }
      }
      
      const possibleTranscriptKeys = ['podcast:transcript', '@_podcast:transcript', 'transcript', 'transcripts'];
      for (const key of possibleTranscriptKeys) {
        const transcriptEl = item[key];
        if (transcriptEl) {
          const transcripts = Array.isArray(transcriptEl) ? transcriptEl : [transcriptEl];
          transcripts.forEach(t => {
            if (typeof t === 'string' && t.startsWith('http')) {
              transcriptUrls.push(t);
            } else if (typeof t === 'object' && t) {
              // Try both 'url' and 'href' attributes
              const url = t['@_url'] || t['@_href'] || t.url || t.href || t['#text'];
              if (url && url.startsWith('http')) transcriptUrls.push(url);
            }
          });
        }
      }
      
      // Fallback to raw XML extraction (more reliable for namespaces)
      const urlsFromXml = itemUrls.get(episodeNumber);
      if (urlsFromXml) {
        if (!chaptersUrl && urlsFromXml.chaptersUrl) {
          chaptersUrl = urlsFromXml.chaptersUrl;
          console.log(`  Found chapters URL from raw XML: ${chaptersUrl}`);
        }
        if (transcriptUrls.length === 0 && urlsFromXml.transcriptUrls.length > 0) {
          transcriptUrls = urlsFromXml.transcriptUrls;
          console.log(`  Found ${transcriptUrls.length} transcript URL(s) from raw XML`);
        }
      }
      
      // Debug output
      if (chaptersUrl) {
        console.log(`  ✓ Chapters URL: ${chaptersUrl}`);
      } else {
        console.log(`  - No chapters URL found for episode ${episodeNumber}`);
      }
      if (transcriptUrls.length > 0) {
        console.log(`  ✓ Found ${transcriptUrls.length} transcript URL(s)`);
      }
      
      // Create episode JSON
      const episodeData = {
        title: title,
        number: episodeNumber,
        date: date || '',
        url: link || '',
        duration: duration,
        description: description.replace(/<[^>]*>/g, '').trim(), // Strip HTML tags
        speakers: [], // Will be extracted from transcript if available
        chapters: [] // Will be populated from chapters file
      };
      
      await fs.writeFile(episodeFile, JSON.stringify(episodeData, null, 2), 'utf-8');
      console.log(`  ✓ Saved episode ${episodeNumber}.json`);
      
      // Extract chapters - first try from URL, then from content:encoded HTML
      let chapters = [];
      
      if (chaptersUrl) {
        console.log(`  Downloading chapters from ${chaptersUrl}...`);
        const chaptersData = await fetchUrl(chaptersUrl);
        
        if (chaptersData) {
          // Try parsing as PSCC (XML)
          if (chaptersData.trim().startsWith('<')) {
            chapters = parsePSCC(chaptersData);
          } else {
            // Try parsing as JSON
            try {
              const json = JSON.parse(chaptersData);
              
              // Format 1: { chapters: [{ number, title, durationSec, positionSec }] }
              if (json.chapters && Array.isArray(json.chapters)) {
                chapters = json.chapters.map((ch, idx) => ({
                  number: ch.number !== undefined ? ch.number : (idx + 1),
                  title: ch.title || ch.name || '',
                  durationSec: ch.durationSec !== undefined ? ch.durationSec : (ch.duration || 0),
                  positionSec: ch.positionSec !== undefined ? ch.positionSec : (ch.start || ch.startSec || 0)
                }));
              }
              // Format 2: Array directly [{ title, start, ... }]
              else if (Array.isArray(json)) {
                let positionSec = 0;
                chapters = json.map((ch, idx) => {
                  const startSec = parseDurationToSeconds(ch.start || ch.startTime || ch.startSec || 0);
                  const durationSec = parseDurationToSeconds(ch.duration || ch.durationSec || 0);
                  const chapter = {
                    number: idx + 1,
                    title: ch.title || ch.name || '',
                    durationSec: Math.max(0, Math.floor(durationSec)),
                    positionSec: Math.floor(startSec || positionSec)
                  };
                  positionSec = chapter.positionSec + chapter.durationSec;
                  return chapter;
                });
              }
              // Format 3: Object with numeric keys (like Podigee transcripts)
              else {
                const numericKeys = Object.keys(json).filter(k => /^\d+$/.test(k));
                if (numericKeys.length > 0) {
                  let positionSec = 0;
                  chapters = numericKeys
                    .map(k => parseInt(k, 10))
                    .sort((a, b) => a - b)
                    .map((k, idx) => {
                      const ch = json[String(k)];
                      const startSec = parseDurationToSeconds(ch.start || ch.startTime || ch.startSec || 0);
                      const durationSec = parseDurationToSeconds(ch.duration || ch.durationSec || 0);
                      const chapter = {
                        number: idx + 1,
                        title: ch.title || ch.name || '',
                        durationSec: Math.max(0, Math.floor(durationSec)),
                        positionSec: Math.floor(startSec || positionSec)
                      };
                      positionSec = chapter.positionSec + chapter.durationSec;
                      return chapter;
                    });
                }
              }
            } catch (e) {
              console.warn(`  ⚠ Could not parse chapters as JSON:`, e.message);
              console.log(`  Chapters data preview:`, chaptersData.substring(0, 200));
            }
          }
        } else {
          console.log(`  ⚠ Failed to download chapters data`);
        }
      }
      
      // Fallback: Extract chapters from content:encoded HTML if no URL was found
      if (chapters.length === 0) {
        const contentEncoded = item['content:encoded'] || item['content'] || item.description || '';
        if (contentEncoded) {
          // Look for chapter patterns like "00:00:00 Intro" or "00:02:02 Lokalpolitik Essen"
          const chapterPattern = /(\d{2}:\d{2}:\d{2})\s+([^<\n]+)/g;
          const foundChapters = [];
          let match;
          
          while ((match = chapterPattern.exec(contentEncoded)) !== null) {
            const timeStr = match[1];
            const title = match[2].trim().replace(/<[^>]*>/g, ''); // Strip HTML tags
            if (title) {
              foundChapters.push({
                time: timeStr,
                title: title
              });
            }
          }
          
          if (foundChapters.length > 0) {
            // Convert to chapter format with positionSec and durationSec
            chapters = foundChapters.map((ch, idx) => {
              const timeParts = ch.time.split(':').map(p => parseInt(p, 10));
              const positionSec = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
              const nextChapter = foundChapters[idx + 1];
              const nextPositionSec = nextChapter 
                ? (() => {
                    const nextParts = nextChapter.time.split(':').map(p => parseInt(p, 10));
                    return nextParts[0] * 3600 + nextParts[1] * 60 + nextParts[2];
                  })()
                : null;
              const durationSec = nextPositionSec !== null 
                ? nextPositionSec - positionSec 
                : 0;
              
              return {
                number: idx + 1,
                title: ch.title,
                durationSec: Math.max(0, durationSec),
                positionSec: positionSec
              };
            });
            
            console.log(`  ✓ Extracted ${chapters.length} chapters from content:encoded HTML`);
          }
        }
      }
      
      // Save chapters if we found any
      if (chapters.length > 0) {
        const chaptersFile = path.join(EPISODES_DIR, `${episodeNumber}-chapters.json`);
        await fs.writeFile(chaptersFile, JSON.stringify({ chapters }, null, 2), 'utf-8');
        console.log(`  ✓ Saved chapters (${chapters.length} chapters)`);
        
        // Update episode JSON with chapter titles
        episodeData.chapters = chapters.map(ch => ch.title).filter(t => t);
        await fs.writeFile(episodeFile, JSON.stringify(episodeData, null, 2), 'utf-8');
        console.log(`  ✓ Updated episode JSON with ${episodeData.chapters.length} chapter titles`);
      } else {
        console.log(`  - No chapters found`);
      }
      
      // Download and process transcripts
      // Prefer VTT files over JSON files (VTT has speaker information)
      if (transcriptUrls.length > 0) {
        // Sort URLs to prefer VTT files
        const sortedUrls = [...transcriptUrls].sort((a, b) => {
          const aIsVTT = a.endsWith('.vtt') || a.includes('.vtt');
          const bIsVTT = b.endsWith('.vtt') || b.includes('.vtt');
          if (aIsVTT && !bIsVTT) return -1;
          if (!aIsVTT && bIsVTT) return 1;
          return 0;
        });
        
        for (const transcriptUrl of sortedUrls) {
          const isVTT = transcriptUrl.endsWith('.vtt') || transcriptUrl.includes('.vtt');
          console.log(`  Downloading transcript from ${transcriptUrl}${isVTT ? ' (VTT)' : ''}...`);
          const transcriptData = await fetchUrl(transcriptUrl);
          
          if (transcriptData) {
            let transcript = [];
            let totalDuration = 0;
            
            if (isVTT) {
              // Parse VTT format
              transcript = parseVTT(transcriptData);
              if (transcript.length > 0) {
                // Calculate total duration from last entry
                const lastEntry = transcript[transcript.length - 1];
                const lastTimeSec = parseDurationToSeconds(lastEntry.time);
                const lastDuration = lastEntry.duration || 0;
                totalDuration = lastTimeSec + lastDuration;
              }
            } else {
              // Try parsing as JSON
              transcript = parseTranscript(transcriptData);
              if (transcript.length > 0) {
                // Add duration field to entries that don't have it
                transcript = transcript.map((entry, idx) => {
                  if (!entry.duration) {
                    const timeSec = parseDurationToSeconds(entry.time);
                    const nextEntry = transcript[idx + 1];
                    if (nextEntry) {
                      const nextTimeSec = parseDurationToSeconds(nextEntry.time);
                      entry.duration = Math.max(0, nextTimeSec - timeSec);
                    } else {
                      // Last entry: use average duration of previous entries
                      const durations = transcript.slice(0, -1).map(t => t.duration || 0).filter(d => d > 0);
                      entry.duration = durations.length > 0 
                        ? durations.reduce((a, b) => a + b, 0) / durations.length 
                        : 5;
                    }
                  }
                  return entry;
                });
                
                // Calculate total duration
                const lastEntry = transcript[transcript.length - 1];
                const lastTimeSec = parseDurationToSeconds(lastEntry.time);
                totalDuration = lastTimeSec + (lastEntry.duration || 0);
              }
            }
            
            if (transcript.length > 0) {
              const transcriptFile = path.join(EPISODES_DIR, `${episodeNumber}-ts.json`);
              const transcriptOutput = {
                transcript: transcript,
                duration: Math.round(totalDuration) // Total duration in seconds
              };
              await fs.writeFile(transcriptFile, JSON.stringify(transcriptOutput, null, 2), 'utf-8');
              console.log(`  ✓ Saved transcript (${transcript.length} entries, duration: ${Math.round(totalDuration)}s)`);
              
              // Extract unique speakers from transcript (only if they have speaker info)
              const speakers = [...new Set(transcript.map(t => t.speaker).filter(s => s && s.trim()))];
              if (speakers.length > 0) {
                episodeData.speakers = speakers;
                await fs.writeFile(episodeFile, JSON.stringify(episodeData, null, 2), 'utf-8');
                console.log(`  ✓ Updated speakers: ${speakers.join(', ')}`);
              } else {
                console.log(`  ⚠ No speaker information found in transcript`);
              }
              break; // Use first successful transcript
            } else {
              console.log(`  ⚠ Could not parse transcript data`);
            }
          }
        }
      } else {
        console.log(`  - No transcript URLs found in feed`);
      }
      
      // Create -text.html file with content:encoded HTML
      const textFile = path.join(EPISODES_DIR, `${episodeNumber}-text.html`);
      let textContent = '';
      
      // Use content:encoded if available, otherwise fall back to description
      if (contentEncoded) {
        // Remove CDATA wrapper if present
        textContent = contentEncoded.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
      } else if (description) {
        // Use description, converting newlines to <br>
        textContent = description.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
      }
      
      if (textContent) {
        await fs.writeFile(textFile, textContent, 'utf-8');
        console.log(`  ✓ Saved text content to ${episodeNumber}-text.html`);
      } else {
        console.log(`  - No text content available for ${episodeNumber}-text.html`);
      }
      
      savedCount++;
    } catch (error) {
      console.error(`  ✗ Error processing episode:`, error.message);
      errorCount++;
    }
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`✓ Successfully processed: ${savedCount} episodes`);
  console.log(`⊘ Skipped: ${skippedCount} episodes`);
  console.log(`✗ Errors: ${errorCount} episodes`);
}

// Run the generator
generateFromFeed().catch(error => {
  console.error('Error running generator:', error);
  process.exit(1);
});

