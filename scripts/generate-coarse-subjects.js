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
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'coarse-subjects.json');

// Settings laden
let settings = null;
try {
  const settingsPath = path.join(PROJECT_ROOT, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }
} catch (error) {
  console.warn('⚠️  Konnte settings.json nicht laden:', error.message);
}

// Konfigurierbare Anzahl Top Subjects (Standard: 12)
const TOP_SUBJECTS_COUNT = settings?.coarseSubjects?.topSubjects || 12;

/**
 * Finde alle verfügbaren Topics-Dateien (sowohl regular als auch extended)
 */
function findTopicsFiles() {
  if (!fs.existsSync(EPISODES_DIR)) {
    console.error(`❌ Episodes directory not found: ${EPISODES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(EPISODES_DIR);
  
  // Sammle alle Topics-Dateien (sowohl extended als auch regular)
  const allTopicsFiles = new Map();
  
  // Sammle extended-topics Dateien
  files
    .filter(f => f.match(/^\d+-extended-topics\.json$/))
    .forEach(f => {
      const match = f.match(/^(\d+)-extended-topics\.json$/);
      if (match) {
        const episodeNumber = parseInt(match[1], 10);
        if (!allTopicsFiles.has(episodeNumber)) {
          allTopicsFiles.set(episodeNumber, { episodeNumber, extendedFilename: f });
        } else {
          allTopicsFiles.get(episodeNumber).extendedFilename = f;
        }
      }
    });
  
  // Sammle regular topics Dateien
  files
    .filter(f => f.match(/^\d+-topics\.json$/) && !f.includes('-extended-topics'))
    .forEach(f => {
      const match = f.match(/^(\d+)-topics\.json$/);
      if (match) {
        const episodeNumber = parseInt(match[1], 10);
        if (!allTopicsFiles.has(episodeNumber)) {
          allTopicsFiles.set(episodeNumber, { episodeNumber, topicsFilename: f });
        } else {
          allTopicsFiles.get(episodeNumber).topicsFilename = f;
        }
      }
    });

  return Array.from(allTopicsFiles.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * Lade Topics-Datei
 */
function loadTopicsFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Normalisiere coarse subject: wenn es "Name / Subname" Format hat, nimm nur "Name"
 */
function normalizeCoarseSubject(coarse) {
  if (!coarse || typeof coarse !== 'string') return coarse;
  const trimmed = coarse.trim();
  const parts = trimmed.split(' / ');
  return parts[0].trim();
}

/**
 * Wartet für eine bestimmte Zeit
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ruft das LLM auf, um Subjects zuzuordnen (mit Retry bei Rate Limits)
 */
async function callLLM(messages, retryCount = 0) {
  if (!settings || !settings.llm) {
    throw new Error('LLM-Konfiguration nicht gefunden in settings.json');
  }

  const { provider, model, apiKey, baseURL, temperature, maxTokens } = settings.llm;
  const maxRetries = settings.topicExtraction?.maxRetries || 3;
  const retryDelayMs = settings.topicExtraction?.retryDelayMs || 5000;
  
  const requestBody = {
    model: model,
    messages,
    temperature: temperature || 0.3,
    max_tokens: maxTokens || 2000
  };

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (response.status === 429) {
      if (retryCount < maxRetries) {
        const waitTime = retryDelayMs * Math.pow(2, retryCount);
        console.log(`  ⏳ Rate limit erreicht, warte ${waitTime / 1000} Sekunden... (Versuch ${retryCount + 1}/${maxRetries})`);
        await sleep(waitTime);
        return callLLM(messages, retryCount + 1);
      } else {
        throw new Error('Rate limit erreicht - maximale Anzahl an Wiederholungen überschritten');
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API Fehler: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      if (retryCount < maxRetries) {
        const waitTime = retryDelayMs * Math.pow(2, retryCount);
        console.log(`  ⏳ Netzwerkfehler, warte ${waitTime / 1000} Sekunden... (Versuch ${retryCount + 1}/${maxRetries})`);
        await sleep(waitTime);
        return callLLM(messages, retryCount + 1);
      }
    }
    throw error;
  }
}

/**
 * Parst JSON-Objekt aus LLM-Antwort
 */
function parseJsonFromLLM(responseText) {
  const text = String(responseText || '').trim();
  // Versuche JSON-Objekt zu extrahieren
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : text;
  const parsed = JSON.parse(jsonText);
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM-Antwort ist kein JSON-Objekt');
  }
  
  // Konvertiere String "null" zu tatsächlichem null
  const cleaned = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === 'null' || value === null || value === undefined) {
      cleaned[key] = null;
    } else {
      cleaned[key] = value;
    }
  }
  
  return cleaned;
}

/**
 * Ordnet Subjects den Top N Subjects zu mit Hilfe eines LLMs
 */
async function mapSubjectsToTopSubjects(otherSubjects, topSubjects) {
  if (otherSubjects.length === 0) {
    return {};
  }

  console.log(`\n🤖 Ordne ${otherSubjects.length} Subjects den Top ${topSubjects.length} zu...`);

  const systemPrompt = `Du ordnest Podcast-Subjects (Bereiche) den wichtigsten Subjects zu. 
Du bekommst eine Liste von Top Subjects und eine Liste von anderen Subjects.
Deine Aufgabe: Ordne jedes andere Subject dem passendsten Top Subject zu.
Wenn ein Subject zu keinem Top Subject passt, verwende "null".

Antworte ausschließlich mit einem JSON-Objekt: { "SubjectName": "TopSubjectName" | null, ... }`;

  const userPrompt = `Top Subjects (${topSubjects.length}):
${topSubjects.map((s, i) => `${i + 1}. ${s.name} (${s.episodeCount} Episoden)`).join('\n')}

Andere Subjects (${otherSubjects.length}):
${otherSubjects.map(s => `- ${s.name} (${s.episodeCount} Episoden)`).join('\n')}

Ordne jedes andere Subject einem Top Subject zu (oder null wenn es nicht passt):`;

  try {
    const response = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    const mapping = parseJsonFromLLM(response);
    
    // Validierung: Stelle sicher, dass alle Subjects zugeordnet wurden
    const mappedSubjects = Object.keys(mapping);
    const missingSubjects = otherSubjects.filter(s => !mappedSubjects.includes(s.name));
    
    if (missingSubjects.length > 0) {
      console.warn(`  ⚠️  ${missingSubjects.length} Subjects wurden nicht zugeordnet, verwende null`);
      missingSubjects.forEach(s => {
        mapping[s.name] = null;
      });
    }

    return mapping;
  } catch (error) {
    console.error(`  ❌ Fehler bei LLM-Zuordnung:`, error.message);
    // Fallback: Alle Subjects bleiben unverändert
    const fallbackMapping = {};
    otherSubjects.forEach(s => {
      fallbackMapping[s.name] = null;
    });
    return fallbackMapping;
  }
}

/**
 * Extrahiere coarse subjects, merge data von topics.json und extended-topics.json
 * Bevorzuge positionSec von topics.json
 */
function extractCoarseSubjects(episodeNumber, topicsFilename, extendedFilename) {
  const topicsFilePath = topicsFilename ? path.join(EPISODES_DIR, topicsFilename) : null;
  const extendedFilePath = extendedFilename ? path.join(EPISODES_DIR, extendedFilename) : null;

  // Lade beide Dateien wenn vorhanden
  const topicsData = topicsFilePath ? loadTopicsFile(topicsFilePath) : null;
  const extendedData = extendedFilePath ? loadTopicsFile(extendedFilePath) : null;

  // Verwende extended-topics als Basis (hat mehr Informationen wie summary)
  const baseData = extendedData || topicsData;
  
  if (!baseData || !baseData.topics || !Array.isArray(baseData.topics)) {
    return {
      episodeNumber: baseData?.episodeNumber || episodeNumber || null,
      title: baseData?.title || null,
      coarseSubjects: [],
      topics: []
    };
  }

  // Erstelle Map von topics.json für positionSec Lookup (keyed by topic text)
  const topicsPositionMap = new Map();
  if (topicsData && topicsData.topics) {
    for (const topic of topicsData.topics) {
      if (topic.topic) {
        topicsPositionMap.set(topic.topic, {
          positionSec: topic.positionSec !== undefined ? topic.positionSec : null,
          durationSec: topic.durationSec !== undefined ? topic.durationSec : null
        });
      }
    }
  }

  // Sammle alle unique coarse subjects und behalte Topics-Informationen
  const coarseSubjectsSet = new Set();
  const topics = [];

  for (const topic of baseData.topics) {
    if (topic.subject && topic.subject.coarse) {
      const coarseRaw = String(topic.subject.coarse).trim();
      if (coarseRaw.length > 0) {
        // Normalisiere coarse subject: nimm nur den Teil vor " / "
        const coarse = normalizeCoarseSubject(coarseRaw);
        coarseSubjectsSet.add(coarse);
        
        // Bevorzuge positionSec von topics.json, sonst verwende extended-topics
        const topicsTiming = topicsPositionMap.get(topic.topic);
        let positionSec = topicsTiming?.positionSec !== undefined 
          ? topicsTiming.positionSec 
          : (topic.positionSec !== undefined ? topic.positionSec : null);
        let durationSec = topicsTiming?.durationSec !== undefined 
          ? topicsTiming.durationSec 
          : (topic.durationSec !== undefined ? topic.durationSec : null);
        
        // Fallback: Verwende summaryMeta.startSec/endSec aus extended-topics wenn verfügbar
        if ((positionSec === null || positionSec === undefined) && topic.summaryMeta) {
          const startSec = topic.summaryMeta.startSec;
          const endSec = topic.summaryMeta.endSec;
          
          // startSec kann 0 sein, daher prüfe explizit auf null/undefined
          if (startSec !== null && startSec !== undefined && Number.isFinite(startSec)) {
            positionSec = startSec;
          }
          
          // Berechne durationSec wenn beide Werte vorhanden sind
          if (startSec !== null && startSec !== undefined && endSec !== null && endSec !== undefined && 
              Number.isFinite(startSec) && Number.isFinite(endSec) && endSec >= startSec) {
            durationSec = endSec - startSec;
          }
        }
        
        // Debug: Zeige wenn wir summaryMeta verwenden
        if (topic.summaryMeta && (positionSec !== null || durationSec !== null)) {
          // Timing wurde aus summaryMeta extrahiert
        }
        
        topics.push({
          topic: topic.topic || '',
          coarse: coarse,
          fine: topic.subject.fine || '',
          durationSec: durationSec,
          positionSec: positionSec
        });
      }
    }
  }

  return {
    episodeNumber: baseData.episodeNumber || episodeNumber || null,
    title: baseData.title || null,
    coarseSubjects: Array.from(coarseSubjectsSet).sort(),
    topics: topics
  };
}

/**
 * Hauptfunktion
 */
async function main() {
  console.log(`🚀 Extrahiere coarse subjects für ${PODCAST_ID}\n`);

  // Finde alle Topics-Dateien
  const topicsFiles = findTopicsFiles();
  console.log(`Gefundene Topics-Dateien: ${topicsFiles.length}\n`);

  if (topicsFiles.length === 0) {
    console.error(`❌ Keine Topics-Dateien gefunden in ${EPISODES_DIR}`);
    process.exit(1);
  }

  // Verarbeite alle Episoden
  const episodes = [];
  const reverseIndex = new Map(); // coarse -> [{episodeNumber, title, topic, fine, ...}]
  let processed = 0;
  let errors = 0;

  for (const { episodeNumber, topicsFilename, extendedFilename } of topicsFiles) {
    const result = extractCoarseSubjects(episodeNumber, topicsFilename, extendedFilename);

    if (result) {
      episodes.push({
        episodeNumber: result.episodeNumber,
        title: result.title,
        coarseSubjects: result.coarseSubjects
      });

      // Baue Reverse Index auf
      for (const topic of result.topics) {
        const coarse = topic.coarse;
        if (!reverseIndex.has(coarse)) {
          reverseIndex.set(coarse, []);
        }
        
        // Erstelle Eintrag mit Occurrence-Informationen
        const entry = {
          episodeNumber: result.episodeNumber,
          title: result.title,
          topic: topic.topic,
          fine: topic.fine
        };
        
        // Füge Occurrences hinzu wenn Timing-Informationen vorhanden sind
        // Prüfe auf Number (inkl. 0) oder explizit null/undefined
        const hasDuration = typeof topic.durationSec === 'number';
        const hasPosition = typeof topic.positionSec === 'number';
        
        if (hasDuration || hasPosition) {
          entry.occurrences = [{
            episodeNumber: result.episodeNumber,
            durationSec: hasDuration ? topic.durationSec : null,
            positionSec: hasPosition ? topic.positionSec : null
          }];
        }
        
        // Für Rückwärtskompatibilität: auch direkt durationSec/positionSec setzen
        if (hasDuration) entry.durationSec = topic.durationSec;
        if (hasPosition) entry.positionSec = topic.positionSec;
        
        reverseIndex.get(coarse).push(entry);
      }

      processed++;
      const sources = [];
      if (topicsFilename) sources.push('topics');
      if (extendedFilename) sources.push('extended');
      const sourceType = sources.join('+') || 'none';
      console.log(`  ✅ Episode ${episodeNumber} (${sourceType}): ${result.coarseSubjects.length} coarse subjects`);
    } else {
      errors++;
      console.error(`  ❌ Episode ${episodeNumber}: Fehler beim Verarbeiten`);
    }
  }

  // Identifiziere Top N Subjects (nach Episode-Anzahl)
  const subjectStats = [];
  for (const [subject, entries] of reverseIndex.entries()) {
    const episodeSet = new Set();
    entries.forEach(e => episodeSet.add(e.episodeNumber));
    subjectStats.push({
      name: subject,
      episodeCount: episodeSet.size,
      topicCount: entries.length
    });
  }

  // Sortiere nach Episode-Anzahl (absteigend)
  subjectStats.sort((a, b) => b.episodeCount - a.episodeCount);

  const topSubjects = subjectStats.slice(0, TOP_SUBJECTS_COUNT);
  const otherSubjects = subjectStats.slice(TOP_SUBJECTS_COUNT);

  console.log(`\n📊 Subjects-Analyse:`);
  console.log(`   - Top ${TOP_SUBJECTS_COUNT} Subjects:`);
  topSubjects.forEach((s, i) => {
    console.log(`      ${i + 1}. ${s.name}: ${s.episodeCount} Episoden, ${s.topicCount} Topics`);
  });
  console.log(`   - Weitere Subjects: ${otherSubjects.length}`);

  // Ordne andere Subjects den Top Subjects zu (mit LLM)
  let subjectMapping = {};
  if (otherSubjects.length > 0 && settings && settings.llm) {
    try {
      subjectMapping = await mapSubjectsToTopSubjects(otherSubjects, topSubjects);
      
      // Zeige Zuordnungen
      console.log(`\n📋 Zuordnungen:`);
      let sonstigeCount = 0;
      for (const [subjectName, topSubjectName] of Object.entries(subjectMapping)) {
        if (topSubjectName && typeof topSubjectName === 'string' && topSubjectName !== 'null') {
          console.log(`   ${subjectName} → ${topSubjectName}`);
        } else {
          console.log(`   ${subjectName} → Sonstige`);
          sonstigeCount++;
        }
      }
      if (sonstigeCount > 0) {
        console.log(`\n   📦 ${sonstigeCount} Subjects werden zu "Sonstige" zusammengefasst`);
      }
    } catch (error) {
      console.error(`\n❌ Fehler bei Subject-Zuordnung:`, error.message);
      console.log(`   ⚠️  Verwende alle Subjects ohne Zuordnung`);
    }
  } else if (otherSubjects.length > 0) {
    console.log(`\n⚠️  Keine LLM-Konfiguration gefunden, verwende alle Subjects ohne Zuordnung`);
  }

  // Erstelle finalen Reverse Index mit Zuordnungen
  const finalReverseIndex = new Map();
  
  // Initialisiere Top Subjects
  for (const topSubject of topSubjects) {
    finalReverseIndex.set(topSubject.name, []);
  }
  
  // Initialisiere "Sonstige" für nicht zugeordnete Subjects
  const SONSTIGE_NAME = 'Sonstige';
  finalReverseIndex.set(SONSTIGE_NAME, []);

  // Füge Einträge hinzu (entweder direkt zu Top Subject oder zugeordnet)
  for (const [originalSubject, entries] of reverseIndex.entries()) {
    // Prüfe ob es ein Top Subject ist
    const isTopSubject = topSubjects.some(s => s.name === originalSubject);
    
    if (isTopSubject) {
      // Direkt zu Top Subject hinzufügen
      const existing = finalReverseIndex.get(originalSubject) || [];
      finalReverseIndex.set(originalSubject, [...existing, ...entries]);
    } else {
      // Prüfe Zuordnung
      const mappedTo = subjectMapping[originalSubject];
      // mappedTo muss ein String sein (nicht null, nicht "null" als String)
      if (mappedTo && typeof mappedTo === 'string' && mappedTo !== 'null' && finalReverseIndex.has(mappedTo)) {
        // Zu Top Subject hinzufügen
        const existing = finalReverseIndex.get(mappedTo) || [];
        finalReverseIndex.set(mappedTo, [...existing, ...entries]);
      } else {
        // Keine Zuordnung (null oder "null") - füge zu "Sonstige" hinzu
        const existing = finalReverseIndex.get(SONSTIGE_NAME) || [];
        finalReverseIndex.set(SONSTIGE_NAME, [...existing, ...entries]);
      }
    }
  }

  // Konvertiere Reverse Index zu Objekt (sortiert nach Subject)
  // "Sonstige" ans Ende sortieren
  const reverseIndexObj = {};
  const allSubjects = Array.from(finalReverseIndex.keys())
    .filter(subject => subject !== 'null' && subject !== null);
  
  // Sortiere: Top Subjects zuerst, dann "Sonstige" am Ende
  const sortedFinalSubjects = allSubjects.sort((a, b) => {
    if (a === SONSTIGE_NAME) return 1; // "Sonstige" ans Ende
    if (b === SONSTIGE_NAME) return -1;
    return a.localeCompare(b);
  });
  
  for (const subject of sortedFinalSubjects) {
    reverseIndexObj[subject] = finalReverseIndex.get(subject);
  }

  // Aktualisiere Episodes mit zugeordneten Subjects
  const updatedEpisodes = episodes.map(ep => {
    const updatedSubjects = new Set();
    
    for (const originalSubject of ep.coarseSubjects) {
      const isTopSubject = topSubjects.some(s => s.name === originalSubject);
      
      if (isTopSubject) {
        updatedSubjects.add(originalSubject);
      } else {
        const mappedTo = subjectMapping[originalSubject];
        // mappedTo muss ein String sein (nicht null, nicht "null" als String)
        if (mappedTo && typeof mappedTo === 'string' && mappedTo !== 'null') {
          updatedSubjects.add(mappedTo);
        } else {
          // Keine Zuordnung (null oder "null") - füge zu "Sonstige" hinzu
          updatedSubjects.add(SONSTIGE_NAME);
        }
      }
    }
    
    return {
      ...ep,
      coarseSubjects: Array.from(updatedSubjects).sort()
    };
  });

  // Erstelle Ergebnis-Objekt
  const output = {
    generatedAt: new Date().toISOString(),
    podcastId: PODCAST_ID,
    totalEpisodes: episodes.length,
    topSubjectsCount: TOP_SUBJECTS_COUNT,
    topSubjects: topSubjects.map(s => s.name),
    subjectMapping: subjectMapping,
    episodes: updatedEpisodes,
    reverseIndex: reverseIndexObj
  };

  // Speichere Ergebnis
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ Fertig! ${processed} Episoden verarbeitet, ${errors} Fehler`);
  console.log(`📄 Ergebnis gespeichert: ${OUTPUT_FILE}`);

  // Zeige Statistiken
  const allCoarseSubjects = new Set();
  updatedEpisodes.forEach(ep => {
    ep.coarseSubjects.forEach(subject => allCoarseSubjects.add(subject));
  });
  
  // Zähle Topics pro Subject im finalen Index
  const topicsPerSubject = {};
  for (const subject of sortedFinalSubjects) {
    topicsPerSubject[subject] = finalReverseIndex.get(subject).length;
  }
  
  console.log(`\n📊 Finale Statistiken:`);
  console.log(`   - Eindeutige coarse subjects nach Zuordnung: ${allCoarseSubjects.size}`);
  console.log(`   - Topics insgesamt: ${Object.values(topicsPerSubject).reduce((a, b) => a + b, 0)}`);
  console.log(`   - Top ${Math.min(10, topSubjects.length)} Subjects nach Topic-Anzahl:`);
  const finalTopSubjects = Object.entries(topicsPerSubject)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(10, topSubjects.length));
  finalTopSubjects.forEach(([subject, count]) => {
    const isTop = topSubjects.some(s => s.name === subject);
    console.log(`      ${subject}: ${count} Topics${isTop ? ' (Top Subject)' : ''}`);
  });
}

// Starte das Skript
main().catch(error => {
  console.error('❌ Kritischer Fehler:', error);
  process.exit(1);
});

