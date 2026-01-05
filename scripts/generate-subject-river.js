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

const COARSE_SUBJECTS_FILE = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'coarse-subjects.json');
const EPISODES_DIR = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts', PODCAST_ID);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'subject-river-data.json');

/**
 * Normalisiert Subject-ID (für URL-safe IDs)
 */
function normalizeSubjectId(subject) {
  return subject
    .toLowerCase()
    .replace(/[äöü]/g, match => {
      const map = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue' };
      return map[match] || match;
    })
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Lädt Episode-Metadaten (Datum)
 */
function loadEpisodeMetadata(episodeNumber) {
  const filePath = path.join(EPISODES_DIR, `${episodeNumber}.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      number: episodeNumber,
      date: data.date,
      title: data.title
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extrahiert das Jahr aus einem Datum
 */
function getYear(dateString) {
  if (!dateString) return null;
  const year = new Date(dateString).getFullYear();
  return isNaN(year) ? null : year;
}

/**
 * Aggregiert Subjects nach Jahren
 */
function aggregateSubjectsByYear(coarseSubjectsData) {
  console.log('Aggregiere Subjects nach Jahren...');
  
  // Struktur: { subjectId: { year: { count, episodes: [] } } }
  const subjectYearData = {};
  
  // Alle Jahre sammeln
  const allYears = new Set();
  
  // Erstelle Map für schnellen Zugriff auf reverseIndex
  const reverseIndex = coarseSubjectsData.reverseIndex || {};
  
  // Für jede Episode
  for (const episode of coarseSubjectsData.episodes) {
    const metadata = loadEpisodeMetadata(episode.episodeNumber);
    
    if (!metadata || !metadata.date) {
      continue;
    }
    
    const year = getYear(metadata.date);
    if (!year) {
      continue;
    }
    
    allYears.add(year);
    
    // Sammle alle unique Subjects für diese Episode (um Duplikate zu vermeiden)
    const uniqueSubjects = new Set(episode.coarseSubjects.filter(s => s && s.length > 0));
    
    // Für jedes Subject in dieser Episode (nur einmal pro Subject)
    for (const subject of uniqueSubjects) {
      const subjectId = normalizeSubjectId(subject);
      
      if (!subjectYearData[subjectId]) {
        subjectYearData[subjectId] = {
          name: subject,
          yearData: {}
        };
      }
      
      if (!subjectYearData[subjectId].yearData[year]) {
        subjectYearData[subjectId].yearData[year] = {
          count: 0,
          episodes: new Map() // Verwende Map statt Array, um Duplikate zu vermeiden
        };
      }
      
      const yearData = subjectYearData[subjectId].yearData[year];
      const episodeKey = episode.episodeNumber;
      
      // Initialisiere Episode-Eintrag falls noch nicht vorhanden
      if (!yearData.episodes.has(episodeKey)) {
        yearData.episodes.set(episodeKey, {
          number: episode.episodeNumber,
          date: metadata.date,
          title: metadata.title || episode.title,
          relevanceSec: 0,
          occurrences: []
        });
        // Erhöhe Count nur einmal pro Episode
        yearData.count++;
      }
      
      const episodeEntry = yearData.episodes.get(episodeKey);
      
      // Sammle ALLE Occurrences für diese Episode und dieses Subject aus dem reverseIndex
      // Verwende ein Set, um bereits verarbeitete Topics zu tracken (vermeide Duplikate)
      if (!episodeEntry.processedTopics) {
        episodeEntry.processedTopics = new Set();
      }
      
      if (reverseIndex[subject]) {
        const subjectTopics = reverseIndex[subject];
        for (const topicEntry of subjectTopics) {
          if (topicEntry.episodeNumber === episode.episodeNumber) {
            // Erstelle einen eindeutigen Key für dieses Topic (vermeide Duplikate)
            const topicKey = `${topicEntry.topic || ''}_${topicEntry.positionSec || 0}_${topicEntry.durationSec || 0}`;
            
            // Überspringe wenn bereits verarbeitet
            if (episodeEntry.processedTopics.has(topicKey)) {
              continue;
            }
            
            episodeEntry.processedTopics.add(topicKey);
            
            // Sammle alle Occurrences für diese Episode
            if (topicEntry.occurrences && Array.isArray(topicEntry.occurrences)) {
              for (const occ of topicEntry.occurrences) {
                if (occ.episodeNumber === episode.episodeNumber) {
                  episodeEntry.occurrences.push({
                    topic: topicEntry.topic || null,
                    positionSec: occ.positionSec || 0,
                    durationSec: occ.durationSec || null
                  });
                  if (occ.durationSec && Number.isFinite(occ.durationSec)) {
                    episodeEntry.relevanceSec += occ.durationSec;
                  }
                }
              }
            } else if (topicEntry.positionSec !== undefined || topicEntry.durationSec !== undefined) {
              // Fallback: verwende direkte positionSec/durationSec
              episodeEntry.occurrences.push({
                topic: topicEntry.topic || null,
                positionSec: topicEntry.positionSec || 0,
                durationSec: topicEntry.durationSec || null
              });
              if (topicEntry.durationSec && Number.isFinite(topicEntry.durationSec)) {
                episodeEntry.relevanceSec += topicEntry.durationSec;
              }
            }
          }
        }
      }
    }
  }
  
  // Konvertiere in Array-Format für bessere Visualisierung
  const years = Array.from(allYears).sort();
  const result = {};
  
  for (const [subjectId, subjectData] of Object.entries(subjectYearData)) {
    const yearDataArray = [];
    let totalEpisodes = 0;
    let totalRelevanceSec = 0;
    let totalOccurrences = 0;
    
    for (const year of years) {
      const yearData = subjectData.yearData[year];
      
      if (yearData) {
        totalEpisodes += yearData.count;
        
        // Berechne Gesamtzeit und Occurrences für dieses Jahr
        let yearRelevanceSec = 0;
        let yearOccurrences = 0;
        
        // Konvertiere Map zu Array
        const episodesArray = Array.from(yearData.episodes.values());
        
        for (const ep of episodesArray) {
          if (ep.relevanceSec && Number.isFinite(ep.relevanceSec)) {
            yearRelevanceSec += ep.relevanceSec;
          }
          if (ep.occurrences && Array.isArray(ep.occurrences)) {
            yearOccurrences += ep.occurrences.length;
          }
        }
        
        totalRelevanceSec += yearRelevanceSec;
        totalOccurrences += yearOccurrences;
        
        // Bereinige Episode-Einträge für JSON-Output (entferne processedTopics)
        const cleanedEpisodes = episodesArray.map(ep => {
          const cleaned = {
            number: ep.number,
            date: ep.date,
            title: ep.title,
            relevanceSec: ep.relevanceSec > 0 ? ep.relevanceSec : undefined,
            occurrences: ep.occurrences.length > 0 ? ep.occurrences : undefined
          };
          return cleaned;
        });
        
        yearDataArray.push({
          year: parseInt(year),
          count: yearData.count,
          totalRelevanceSec: yearRelevanceSec > 0 ? yearRelevanceSec : undefined,
          totalOccurrences: yearOccurrences > 0 ? yearOccurrences : undefined,
          episodes: cleanedEpisodes
        });
      } else {
        yearDataArray.push({
          year: parseInt(year),
          count: 0,
          episodes: []
        });
      }
    }
    
    result[subjectId] = {
      id: subjectId,
      name: subjectData.name,
      totalEpisodes: totalEpisodes,
      totalRelevanceSec: totalRelevanceSec > 0 ? totalRelevanceSec : undefined,
      totalOccurrences: totalOccurrences > 0 ? totalOccurrences : undefined,
      yearData: yearDataArray
    };
  }
  
  return { result, years };
}

/**
 * Berechnet Statistiken
 */
function calculateStatistics(subjectRiverData, years) {
  const subjects = Object.values(subjectRiverData);
  
  const yearRange = {
    start: years[0],
    end: years[years.length - 1]
  };
  
  // Top 10 Subjects nach Episode-Count
  const subjectsByEpisodeCount = subjects
    .map(s => ({ id: s.id, name: s.name, count: s.totalEpisodes }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  return {
    totalSubjects: subjects.length,
    yearRange: yearRange,
    years: years,
    subjectsByEpisodeCount: subjectsByEpisodeCount
  };
}

/**
 * Hauptfunktion
 */
function main() {
  console.log('=== Subject River Daten-Generator ===\n');
  console.log(`Podcast: ${PODCAST_ID}\n`);
  
  try {
    // 1. Lade Coarse Subjects Daten
    if (!fs.existsSync(COARSE_SUBJECTS_FILE)) {
      throw new Error(`Coarse subjects file not found: ${COARSE_SUBJECTS_FILE}`);
    }
    
    console.log(`Lade Coarse Subjects: ${COARSE_SUBJECTS_FILE}...`);
    const coarseSubjectsData = JSON.parse(fs.readFileSync(COARSE_SUBJECTS_FILE, 'utf-8'));
    console.log(`${coarseSubjectsData.totalEpisodes} Episoden gefunden\n`);
    
    // 2. Aggregiere nach Jahren
    const { result: subjectRiverData, years } = aggregateSubjectsByYear(coarseSubjectsData);
    
    // 3. Berechne Statistiken
    const statistics = calculateStatistics(subjectRiverData, years);
    
    // 4. Erstelle Output-Struktur
    const output = {
      generatedAt: new Date().toISOString(),
      description: `Subject River Daten für ${PODCAST_ID} Podcast - Coarse Subjects aggregiert nach Jahren`,
      statistics: statistics,
      subjects: subjectRiverData
    };
    
    // 5. Speichere JSON
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
    
    console.log(`\n✓ Daten erfolgreich gespeichert in: ${OUTPUT_FILE}`);
    console.log(`\nStatistiken:`);
    console.log(`- Subjects: ${statistics.totalSubjects}`);
    console.log(`- Zeitraum: ${statistics.yearRange.start} - ${statistics.yearRange.end}`);
    console.log(`- Jahre: ${statistics.years.join(', ')}`);
    console.log(`\nTop 10 Subjects nach Episodenanzahl:`);
    statistics.subjectsByEpisodeCount.forEach((subject, index) => {
      console.log(`  ${index + 1}. ${subject.name}: ${subject.count} Episoden`);
    });
    
  } catch (error) {
    console.error('Fehler:', error);
    process.exit(1);
  }
}

main();

