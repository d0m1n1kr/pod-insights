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

// Settings laden
const settings = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'settings.json'), 'utf-8'));

/**
 * Wartet für eine bestimmte Zeit
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Konvertiert HH:MM oder MM:SS Format zu Sekunden
 */
function parseHmsToSec(timeStr) {
  if (typeof timeStr !== 'string') return null;
  const s = timeStr.trim();
  if (!s) return null;

  const parts = s.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;

  const nums = parts.map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : null;
  });
  if (nums.some((n) => n === null)) return null;

  if (nums.length === 3) {
    const [h, m, sec] = nums;
    return h * 3600 + m * 60 + sec;
  }
  if (nums.length === 2) {
    const [m, sec] = nums;
    return m * 60 + sec;
  }
  return nums[0];
}

/**
 * Ruft das LLM auf, um Kapitel mit Timestamps zu generieren (mit Retry bei Rate Limits)
 */
async function callLLM(messages, retryCount = 0) {
  const { provider, model, apiKey, baseURL, temperature, maxTokens } = settings.llm;
  const { maxRetries, retryDelayMs } = settings.topicExtraction;
  
  const requestBody = {
    model: model,
    messages,
    temperature: temperature || 0.3,
    max_tokens: maxTokens || 4000
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
      // Rate limit erreicht
      if (retryCount < maxRetries) {
        const waitTime = retryDelayMs * Math.pow(2, retryCount); // Exponentielles Backoff
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
 * Berechnet die tatsächliche Dauer des Transcripts
 */
function calculateTranscriptDuration(transcript) {
  let maxTimeSec = 0;
  let lastTimeSec = 0;

  for (const item of transcript) {
    let timeSec = parseHmsToSec(item.time);
    
    // Falls time nicht verfügbar, versuche duration zu verwenden
    if (timeSec === null && item.duration !== undefined) {
      timeSec = lastTimeSec + (Number.isFinite(item.duration) ? item.duration : 0);
    }
    
    if (timeSec !== null) {
      // Berechne Endzeit (time + duration falls verfügbar)
      const duration = Number.isFinite(item.duration) ? item.duration : 0;
      const endSec = timeSec + duration;
      maxTimeSec = Math.max(maxTimeSec, endSec);
      lastTimeSec = timeSec;
    }
  }

  return Math.ceil(maxTimeSec);
}

/**
 * Erstellt eine strukturierte Übersicht des Transcripts für das LLM
 */
function createTranscriptOverview(transcript, maxItems = 100) {
  // Teile Transcript in Segmente auf (z.B. alle 60 Sekunden)
  const segments = [];
  let currentSegment = { startSec: 0, texts: [] };
  let currentTime = 0;
  let lastTimeSec = 0;

  for (const item of transcript) {
    let timeSec = parseHmsToSec(item.time);
    
    // Falls time nicht verfügbar, versuche duration zu verwenden
    if (timeSec === null && item.duration !== undefined) {
      timeSec = lastTimeSec + (Number.isFinite(item.duration) ? item.duration : 0);
    }
    
    if (timeSec === null) continue;

    // Wenn mehr als 60 Sekunden vergangen sind, starte neues Segment
    if (timeSec - currentTime > 60 && currentSegment.texts.length > 0) {
      segments.push({
        startSec: currentSegment.startSec,
        endSec: currentTime,
        text: currentSegment.texts.join(' ').substring(0, 500)
      });
      currentSegment = { startSec: timeSec, texts: [] };
    }

    if (item.text && item.text.trim()) {
      currentSegment.texts.push(item.text.trim());
    }
    currentTime = timeSec;
    lastTimeSec = timeSec;
  }

  // Füge letztes Segment hinzu
  if (currentSegment.texts.length > 0) {
    segments.push({
      startSec: currentSegment.startSec,
      endSec: currentTime,
      text: currentSegment.texts.join(' ').substring(0, 500)
    });
  }

  // Begrenze auf maxItems
  return segments.slice(0, maxItems);
}

/**
 * Erstellt LLM-Messages zur Generierung von Kapiteln mit Timestamps
 */
function createChapterGenerationMessages(episodeTitle, episodeDescription, topics, extendedTopics, transcriptOverview, episodeDurationSec) {
  const topicsList = topics.map(t => ({
    topic: t.topic,
    subject: t.subject,
    positionSec: t.positionSec || null,
    durationSec: t.durationSec || null
  }));

  const extendedTopicsList = extendedTopics ? extendedTopics.map(t => ({
    topic: t.topic,
    summary: t.summary || null,
    positionSec: t.positionSec || null,
    durationSec: t.durationSec || null
  })) : [];

  // Erstelle Transcript-Zusammenfassung
  const transcriptSummary = transcriptOverview.map(seg => 
    `[${Math.floor(seg.startSec / 60)}:${String(Math.floor(seg.startSec % 60)).padStart(2, '0')}] ${seg.text.substring(0, 200)}`
  ).join('\n');

  // Formatiere Episode-Dauer für bessere Lesbarkeit
  const durationStr = episodeDurationSec !== null 
    ? `${Math.floor(episodeDurationSec / 60)} Minuten und ${episodeDurationSec % 60} Sekunden (${episodeDurationSec} Sekunden total)`
    : 'unbekannt';

  return [
    {
      role: "system",
      content:
        "Du analysierst Podcast-Transkripte und generierst Kapitel mit präzisen Timestamps. " +
        "Du bekommst eine Liste von Topics/Themen, die in der Episode besprochen werden, sowie eine Übersicht des Transcripts. " +
        "Deine Aufgabe ist es, für jedes Topic das genaue Timestamp zu finden, an dem das Thema beginnt. " +
        "\n" +
        "WICHTIGE REGELN: " +
        "1. Die Episode dauert genau " + (episodeDurationSec !== null ? `${episodeDurationSec} Sekunden` : 'so lange wie im Transcript angegeben') + ". " +
        "2. Analysiere den Transcript-Text, um den genauen Startpunkt jedes Themas zu finden " +
        "3. Verwende die Topics als Kapitel-Titel (kannst du leicht anpassen, wenn nötig) " +
        "4. Füge ein 'Intro'-Kapitel am Anfang hinzu (positionSec: 0) " +
        "5. Füge ein 'Outro'-Kapitel am Ende hinzu - es MUSS bei positionSec: " + (episodeDurationSec !== null ? episodeDurationSec : 'der letzten Transcript-Zeit') + " beginnen " +
        "6. Berechne durationSec für jedes Kapitel (nächstes Kapitel positionSec - aktuelles positionSec) " +
        "7. Die Kapitel sollten in chronologischer Reihenfolge sein und ALLE Timestamps müssen zwischen 0 und " + (episodeDurationSec !== null ? episodeDurationSec : 'der Episode-Dauer') + " liegen " +
        "8. Das letzte Kapitel (Outro) sollte von seinem positionSec bis zum Ende der Episode gehen " +
        "\n" +
        "Antworte ausschließlich mit einem JSON-Array von Kapitel-Objekten: " +
        "[{\"number\": 1, \"title\": \"Intro\", \"positionSec\": 0, \"durationSec\": 120}, ...] " +
        "Jedes Kapitel muss number, title, positionSec und durationSec haben."
    },
    {
      role: "user",
      content:
        `Episode: ${episodeTitle}\n` +
        `Episode-Dauer: ${durationStr}\n` +
        (episodeDescription ? `Beschreibung: ${episodeDescription.substring(0, 500)}\n\n` : '') +
        `Topics:\n${JSON.stringify(topicsList, null, 2)}\n\n` +
        (extendedTopicsList.length > 0 ? `Extended Topics (mit Summaries):\n${JSON.stringify(extendedTopicsList.slice(0, 10), null, 2)}\n\n` : '') +
        `Transcript-Übersicht (Zeitstempel in Sekunden):\n${transcriptSummary.substring(0, 8000)}`
    }
  ];
}

/**
 * Parst die LLM-Antwort und extrahiert die Kapitel
 */
function parseChapters(llmResponse, episodeDurationSec) {
  try {
    // Versuche, JSON aus der Antwort zu extrahieren
    const text = String(llmResponse || '').trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const jsonText = jsonMatch ? jsonMatch[0] : text;
    const parsed = JSON.parse(jsonText);
    
    if (!Array.isArray(parsed)) {
      throw new Error('LLM-Antwort ist kein JSON-Array');
    }
    
    // Validiere und normalisiere Kapitel
    let chapters = parsed
      .filter(ch => ch && typeof ch === 'object')
      .map((ch, idx) => ({
        number: Number.isFinite(ch.number) ? ch.number : (idx + 1),
        title: String(ch.title || '').trim(),
        positionSec: Number.isFinite(ch.positionSec) ? Math.max(0, Math.floor(ch.positionSec)) : 0,
        durationSec: Number.isFinite(ch.durationSec) ? Math.max(0, Math.floor(ch.durationSec)) : 0
      }))
      .filter(ch => ch.title.length > 0)
      .sort((a, b) => a.positionSec - b.positionSec);

    // Berechne durationSec für Kapitel, die keine haben
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].durationSec === 0 && i < chapters.length - 1) {
        chapters[i].durationSec = chapters[i + 1].positionSec - chapters[i].positionSec;
      }
    }

    // Validiere und korrigiere Timestamps basierend auf Episode-Dauer
    if (episodeDurationSec !== null && episodeDurationSec > 0) {
      // Stelle sicher, dass alle positionSec innerhalb der Episode-Dauer liegen
      chapters = chapters.map(ch => ({
        ...ch,
        positionSec: Math.min(ch.positionSec, episodeDurationSec)
      }));

      // Korrigiere das letzte Kapitel (Outro), damit es bis zum Ende geht
      const lastChapter = chapters[chapters.length - 1];
      if (lastChapter && lastChapter.title.toLowerCase().includes('outro')) {
        lastChapter.positionSec = Math.min(lastChapter.positionSec, episodeDurationSec);
        lastChapter.durationSec = Math.max(0, episodeDurationSec - lastChapter.positionSec);
      } else {
        // Wenn kein Outro vorhanden, füge eines hinzu oder korrigiere das letzte Kapitel
        if (lastChapter) {
          const lastEndSec = lastChapter.positionSec + lastChapter.durationSec;
          if (lastEndSec < episodeDurationSec) {
            // Erweitere letztes Kapitel oder füge Outro hinzu
            lastChapter.durationSec = episodeDurationSec - lastChapter.positionSec;
          }
        }
      }

      // Stelle sicher, dass keine Kapitel über die Episode-Dauer hinausgehen
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const chEndSec = ch.positionSec + ch.durationSec;
        if (chEndSec > episodeDurationSec) {
          ch.durationSec = Math.max(0, episodeDurationSec - ch.positionSec);
        }
      }
    }

    return chapters;
  } catch (error) {
    console.error(`  ⚠️  Fehler beim Parsen der LLM-Antwort: ${error.message}`);
    console.error(`  Antwort war: ${llmResponse.substring(0, 500)}...`);
    return null;
  }
}

/**
 * Generiert Kapitel für eine Episode aus extended-topics.json
 */
async function generateChaptersForEpisode(episodeNumber, forceOverwrite = false) {
  const episodesDir = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
  const chaptersFile = path.join(episodesDir, `${episodeNumber}-chapters.json`);
  const transcriptFile = path.join(episodesDir, `${episodeNumber}-ts.json`);
  const extendedTopicsFile = path.join(episodesDir, `${episodeNumber}-extended-topics.json`);
  const episodeFile = path.join(episodesDir, `${episodeNumber}.json`);

  // Prüfe, ob Kapitel-Datei bereits existiert
  if (fs.existsSync(chaptersFile) && !forceOverwrite) {
    console.log(`  ⚠️  Kapitel-Datei existiert bereits, überspringe...`);
    return false;
  }
  
  if (fs.existsSync(chaptersFile) && forceOverwrite) {
    console.log(`  🔄 Kapitel-Datei existiert bereits, wird überschrieben (--force)...`);
  }

  // Prüfe, ob Extended Topics existiert
  if (!fs.existsSync(extendedTopicsFile)) {
    console.log(`  ⚠️  Extended Topics-Datei nicht gefunden, überspringe...`);
    return false;
  }

  // Lade Extended Topics
  const extendedTopicsData = JSON.parse(fs.readFileSync(extendedTopicsFile, 'utf-8'));
  const extendedTopics = extendedTopicsData.topics || [];

  if (!Array.isArray(extendedTopics) || extendedTopics.length === 0) {
    console.log(`  ⚠️  Keine Extended Topics gefunden`);
    return false;
  }

  // Lade Episode-Metadaten für Dauer
  let episodeDuration = null;
  if (fs.existsSync(episodeFile)) {
    const episodeData = JSON.parse(fs.readFileSync(episodeFile, 'utf-8'));
    if (Array.isArray(episodeData.duration) && episodeData.duration.length === 3) {
      episodeDuration = episodeData.duration[0] * 3600 + episodeData.duration[1] * 60 + episodeData.duration[2];
    }
  }

  // Berechne Episode-Dauer aus Transcript falls nicht verfügbar
  let actualDuration = episodeDuration;
  if (actualDuration === null && fs.existsSync(transcriptFile)) {
    const transcriptData = JSON.parse(fs.readFileSync(transcriptFile, 'utf-8'));
    const transcript = transcriptData.transcript || [];
    if (Array.isArray(transcript) && transcript.length > 0) {
      actualDuration = calculateTranscriptDuration(transcript);
    }
  }

  if (actualDuration === null || actualDuration === 0) {
    console.log(`  ⚠️  Konnte Episode-Dauer nicht bestimmen, überspringe...`);
    return false;
  }

  console.log(`  📊 Episode-Dauer: ${Math.floor(actualDuration / 60)}:${String(actualDuration % 60).padStart(2, '0')} (${actualDuration} Sekunden)`);

  // Extrahiere Topics mit gültigen startSec Timestamps
  const topicsWithTimestamps = extendedTopics
    .map(t => {
      const startSec = Number.isFinite(t?.summaryMeta?.startSec) ? Math.floor(t.summaryMeta.startSec) : null;
      const endSec = Number.isFinite(t?.summaryMeta?.endSec) ? Math.floor(t.summaryMeta.endSec) : null;
      
      // Validiere: startSec muss vorhanden und >= 0 sein, endSec sollte >= startSec sein
      if (startSec === null || startSec < 0) return null;
      if (endSec !== null && endSec < startSec) return null;
      
      return {
        topic: t.topic || '',
        startSec: startSec,
        endSec: endSec
      };
    })
    .filter(t => t !== null && t.topic.length > 0)
    .sort((a, b) => a.startSec - b.startSec); // Sortiere nach startSec

  if (topicsWithTimestamps.length === 0) {
    console.log(`  ⚠️  Keine Topics mit gültigen Timestamps gefunden`);
    return false;
  }

  console.log(`  📋 Gefunden: ${topicsWithTimestamps.length} Topics mit Timestamps`);

  // Erstelle Kapitel aus Topics
  const chapters = [];
  let chapterNumber = 1;

  // Intro-Kapitel am Anfang (wenn das erste Topic nicht bei 0 startet)
  const firstTopicStart = topicsWithTimestamps[0].startSec;
  if (firstTopicStart > 0) {
    chapters.push({
      number: chapterNumber++,
      title: 'Intro',
      positionSec: 0,
      durationSec: firstTopicStart
    });
  }

  // Erstelle Kapitel für jedes Topic
  for (let i = 0; i < topicsWithTimestamps.length; i++) {
    const topic = topicsWithTimestamps[i];
    const nextTopic = i < topicsWithTimestamps.length - 1 ? topicsWithTimestamps[i + 1] : null;
    
    // Berechne durationSec: bis zum nächsten Topic oder bis zum Ende
    let durationSec;
    if (nextTopic) {
      durationSec = nextTopic.startSec - topic.startSec;
    } else {
      // Letztes Topic: bis zum Ende der Episode
      durationSec = actualDuration - topic.startSec;
    }

    // Stelle sicher, dass durationSec nicht negativ ist
    if (durationSec < 0) {
      console.log(`  ⚠️  Warnung: Topic "${topic.topic}" hat negative Dauer, überspringe...`);
      continue;
    }

    chapters.push({
      number: chapterNumber++,
      title: topic.topic,
      positionSec: topic.startSec,
      durationSec: durationSec
    });
  }

  // Outro-Kapitel am Ende (falls das letzte Kapitel nicht bis zum Ende geht)
  const lastChapter = chapters[chapters.length - 1];
  if (lastChapter) {
    const lastChapterEnd = lastChapter.positionSec + lastChapter.durationSec;
    if (lastChapterEnd < actualDuration - 5) {
      // Füge Outro hinzu, wenn mehr als 5 Sekunden fehlen
      chapters.push({
        number: chapterNumber++,
        title: 'Outro',
        positionSec: lastChapterEnd,
        durationSec: actualDuration - lastChapterEnd
      });
    } else {
      // Erweitere letztes Kapitel bis zum Ende
      lastChapter.durationSec = actualDuration - lastChapter.positionSec;
    }
  } else {
    // Falls keine Kapitel vorhanden, füge Intro und Outro hinzu
    chapters.push({
      number: 1,
      title: 'Intro',
      positionSec: 0,
      durationSec: actualDuration
    });
  }

  if (chapters.length === 0) {
    console.log(`  ❌ Konnte keine Kapitel generieren`);
    return false;
  }

  // Speichere Kapitel-Datei
  fs.writeFileSync(chaptersFile, JSON.stringify({ chapters }, null, 2), 'utf-8');
  console.log(`  ✓ Kapitel-Datei gespeichert (${chapters.length} Kapitel)`);

  // Aktualisiere Episode JSON-Datei
  if (fs.existsSync(episodeFile)) {
    const episodeData = JSON.parse(fs.readFileSync(episodeFile, 'utf-8'));
    episodeData.chapters = chapters.map(ch => ch.title);
    fs.writeFileSync(episodeFile, JSON.stringify(episodeData, null, 2), 'utf-8');
    console.log(`  ✓ Episode JSON-Datei aktualisiert`);
  } else {
    console.log(`  ⚠️  Episode JSON-Datei nicht gefunden: ${episodeFile}`);
  }

  return true;
}

/**
 * Hauptfunktion
 */
async function main() {
  const episodesDir = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
  
  if (!fs.existsSync(episodesDir)) {
    console.error(`❌ Episoden-Verzeichnis nicht gefunden: ${episodesDir}`);
    process.exit(1);
  }

  // Finde alle Episode-Nummern
  const files = fs.readdirSync(episodesDir);
  const episodeNumbers = files
    .filter(file => file.match(/^\d+\.json$/))
    .map(file => parseInt(file.replace('.json', ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  if (episodeNumbers.length === 0) {
    console.error(`❌ Keine Episoden gefunden in ${episodesDir}`);
    process.exit(1);
  }

  // Parse Argumente
  let forceOverwrite = false;
  const remainingArgs = args.filter((arg, idx) => {
    if (arg === '--podcast') return false;
    if (idx > 0 && args[idx - 1] === '--podcast') return false;
    if (arg === '--force' || arg === '-f') {
      forceOverwrite = true;
      return false;
    }
    return true;
  });

  // Filtere Episoden ohne Kapitel-Dateien (außer wenn --force aktiviert ist)
  const episodesWithoutChapters = episodeNumbers.filter(epNum => {
    const chaptersFile = path.join(episodesDir, `${epNum}-chapters.json`);
    return !fs.existsSync(chaptersFile);
  });

  if (forceOverwrite) {
    console.log('🔄 Force-Modus aktiviert: Bestehende Kapitel-Dateien werden überschrieben\n');
  } else if (episodesWithoutChapters.length === 0) {
    console.log(`✓ Alle Episoden haben bereits Kapitel-Dateien`);
    console.log(`💡 Tipp: Verwende --force um bestehende Kapitel zu regenerieren\n`);
    process.exit(0);
  }

  let episodesToProcess = [];
  if (remainingArgs.length === 0) {
    // Keine Argumente - nur erste Episode ohne Kapitel als Test (oder erste Episode wenn --force)
    const targetEpisodes = forceOverwrite ? episodeNumbers : episodesWithoutChapters;
    episodesToProcess = [targetEpisodes[0]];
    console.log(`Keine Argumente angegeben, verarbeite nur Episode ${episodesToProcess[0]} als Test.\n`);
    console.log(`Verwendung:`);
    console.log(`  node scripts/generate-chapters.js --podcast <podcast-id> <episode-nummer>          # Einzelne Episode`);
    console.log(`  node scripts/generate-chapters.js --podcast <podcast-id> 1 2 3                     # Mehrere Episoden`);
    console.log(`  node scripts/generate-chapters.js --podcast <podcast-id> --all                     # Alle Episoden ohne Kapitel`);
    console.log(`  node scripts/generate-chapters.js --podcast <podcast-id> --force <episode>         # Überschreibe bestehende Kapitel\n`);
  } else if (remainingArgs[0] === '--all') {
    // Alle Episoden verarbeiten (mit oder ohne Kapitel, je nach --force)
    episodesToProcess = forceOverwrite ? episodeNumbers : episodesWithoutChapters;
    console.log(`Verarbeite ALLE Episoden${forceOverwrite ? '' : ' ohne Kapitel'} (${episodesToProcess.length})...\n`);
  } else {
    // Einzelne Episode(n)
    const requested = remainingArgs.map(arg => parseInt(arg, 10)).filter(n => !isNaN(n));
    if (forceOverwrite) {
      // Mit --force: verarbeite alle angeforderten Episoden
      episodesToProcess = requested.filter(epNum => episodeNumbers.includes(epNum));
    } else {
      // Ohne --force: nur die ohne Kapitel
      episodesToProcess = requested.filter(epNum => episodesWithoutChapters.includes(epNum));
    }
    if (episodesToProcess.length === 0) {
      if (forceOverwrite) {
        console.log(`⚠️  Keine der angeforderten Episoden gefunden`);
      } else {
        console.log(`⚠️  Keine der angeforderten Episoden benötigt Kapitel-Generierung`);
        console.log(`💡 Tipp: Verwende --force um bestehende Kapitel zu regenerieren`);
      }
      process.exit(0);
    }
    console.log(`Verarbeite ${episodesToProcess.length} spezifische Episode(n)${forceOverwrite ? ' (--force aktiviert)' : ' ohne Kapitel'}...\n`);
  }

  if (episodesToProcess.length === 0) {
    console.error(`❌ Keine Episoden zum Verarbeiten gefunden`);
    process.exit(1);
  }

  // Verarbeite Episoden
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  console.log(`Podcast: ${PODCAST_ID}\n`);

  for (const episodeNumber of episodesToProcess) {
    try {
      console.log(`\n📝 Episode ${episodeNumber}:`);
      const success = await generateChaptersForEpisode(episodeNumber, forceOverwrite);
      processed++;
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`  ❌ Fehler bei Episode ${episodeNumber}: ${error.message}`);
      failed++;
      processed++;
    }
  }

  console.log(`\n✅ Verarbeitung abgeschlossen:`);
  console.log(`   Verarbeitet: ${processed}`);
  console.log(`   Erfolgreich: ${succeeded}`);
  console.log(`   Fehlgeschlagen: ${failed}`);
}

main().catch(error => {
  console.error('❌ Unerwarteter Fehler:', error);
  process.exit(1);
});

