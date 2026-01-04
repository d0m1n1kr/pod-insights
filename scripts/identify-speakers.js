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
 * Ruft das LLM auf, um Sprecher-Namen zu identifizieren (mit Retry bei Rate Limits)
 */
async function callLLM(messages, retryCount = 0) {
  const { provider, model, apiKey, baseURL, temperature, maxTokens } = settings.llm;
  const { maxRetries, retryDelayMs } = settings.topicExtraction;
  
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
 * Prüft, ob ein Sprecher-Name generisch ist (z.B. "Speaker 0", "Speaker 1")
 */
function isGenericSpeakerName(name) {
  if (!name || typeof name !== 'string') return false;
  const normalized = name.trim();
  return /^Speaker\s+\d+$/i.test(normalized);
}

/**
 * Extrahiert nur den Vornamen aus einem vollständigen Namen
 */
function extractFirstName(fullName) {
  if (!fullName || typeof fullName !== 'string') return fullName;
  const trimmed = fullName.trim();
  // Teile den Namen an Leerzeichen und nimm den ersten Teil
  const parts = trimmed.split(/\s+/);
  return parts[0] || trimmed;
}

/**
 * Sammelt alle Textpassagen eines Sprechers aus dem Transcript
 */
function collectSpeakerTexts(transcript, speakerName) {
  return transcript
    .filter(item => item.speaker === speakerName && item.text && item.text.trim())
    .map(item => item.text.trim())
    .join(' ');
}

/**
 * Erstellt LLM-Messages zur Identifikation von Sprecher-Namen
 */
function createSpeakerIdentificationMessages(episodeTitle, episodeDescription, speakerTexts) {
  const speakers = Object.keys(speakerTexts);
  const speakerSamples = speakers.map((speaker, idx) => {
    const text = speakerTexts[speaker];
    // Kürze auf maximal 2000 Zeichen pro Sprecher für den Prompt
    const sampleText = text.length > 2000 ? text.substring(0, 2000) + '...' : text;
    return `Sprecher "${speaker}":\n${sampleText}`;
  }).join('\n\n');

  return [
    {
      role: "system",
      content:
        "Du analysierst Podcast-Transkripte, um die echten Namen der Sprecher zu identifizieren. " +
        "Die Sprecher sind aktuell nur als 'Speaker 0', 'Speaker 1', etc. bezeichnet. " +
        "Analysiere die Textpassagen jedes Sprechers und identifiziere deren Namen anhand von: " +
        "- Selbstvorstellungen ('Ich bin...', 'Mein Name ist...') " +
        "- Ansprache durch andere ('Hallo [Name]', 'Danke [Name]') " +
        "- Kontext (z.B. wenn jemand über sich selbst spricht) " +
        "- Wiederkehrende Muster in der Sprache " +
        "\n" +
        "Antworte ausschließlich mit einem JSON-Objekt, das für jeden generischen Sprecher-Namen den identifizierten echten Namen enthält. " +
        "Format: {\"Speaker 0\": \"Echter Name\", \"Speaker 1\": \"Echter Name\", ...} " +
        "Wenn du einen Namen nicht sicher identifizieren kannst, verwende den generischen Namen als Fallback. " +
        "Wenn mehrere mögliche Namen gefunden werden, wähle den wahrscheinlichsten aus."
    },
    {
      role: "user",
      content:
        `Episode: ${episodeTitle}\n` +
        (episodeDescription ? `Beschreibung: ${episodeDescription.substring(0, 500)}\n\n` : '') +
        `Textpassagen der Sprecher:\n\n${speakerSamples}`
    }
  ];
}

/**
 * Parst die LLM-Antwort und extrahiert die Sprecher-Zuordnung
 */
function parseSpeakerMapping(llmResponse) {
  try {
    // Versuche, JSON aus der Antwort zu extrahieren
    const text = String(llmResponse || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : text;
    const parsed = JSON.parse(jsonText);
    
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('LLM-Antwort ist kein JSON-Objekt');
    }
    
    return parsed;
  } catch (error) {
    console.error(`  ⚠️  Fehler beim Parsen der LLM-Antwort: ${error.message}`);
    console.error(`  Antwort war: ${llmResponse.substring(0, 200)}...`);
    return null;
  }
}

/**
 * Identifiziert Sprecher für eine Episode
 */
async function identifySpeakersForEpisode(episodeNumber) {
  const episodesDir = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
  const transcriptFile = path.join(episodesDir, `${episodeNumber}-ts.json`);
  const episodeFile = path.join(episodesDir, `${episodeNumber}.json`);

  // Prüfe, ob Transcript-Datei existiert
  if (!fs.existsSync(transcriptFile)) {
    console.log(`  ⚠️  Transcript-Datei nicht gefunden: ${transcriptFile}`);
    return false;
  }

  // Lade Transcript
  const transcriptData = JSON.parse(fs.readFileSync(transcriptFile, 'utf-8'));
  const transcript = transcriptData.transcript || [];
  
  if (!Array.isArray(transcript) || transcript.length === 0) {
    console.log(`  ⚠️  Kein Transcript gefunden in Episode ${episodeNumber}`);
    return false;
  }

  // Finde alle generischen Sprecher-Namen
  const genericSpeakers = new Set();
  transcript.forEach(item => {
    if (item.speaker && isGenericSpeakerName(item.speaker)) {
      genericSpeakers.add(item.speaker);
    }
  });

  if (genericSpeakers.size === 0) {
    console.log(`  ✓ Keine generischen Sprecher-Namen gefunden`);
    return true;
  }

  console.log(`  🔍 Gefundene generische Sprecher: ${Array.from(genericSpeakers).join(', ')}`);

  // Sammle Textpassagen für jeden generischen Sprecher
  const speakerTexts = {};
  genericSpeakers.forEach(speaker => {
    speakerTexts[speaker] = collectSpeakerTexts(transcript, speaker);
  });

  // Prüfe, ob genug Text vorhanden ist
  const hasEnoughText = Object.values(speakerTexts).some(text => text.length > 50);
  if (!hasEnoughText) {
    console.log(`  ⚠️  Nicht genug Text für Sprecher-Identifikation (mindestens 50 Zeichen pro Sprecher)`);
    return false;
  }

  // Lade Episode-Metadaten für Kontext
  let episodeTitle = `Episode ${episodeNumber}`;
  let episodeDescription = '';
  if (fs.existsSync(episodeFile)) {
    const episodeData = JSON.parse(fs.readFileSync(episodeFile, 'utf-8'));
    episodeTitle = episodeData.title || episodeTitle;
    episodeDescription = episodeData.description || '';
  }

  // Rufe LLM auf
  console.log(`  🤖 Frage LLM nach Sprecher-Namen...`);
  const messages = createSpeakerIdentificationMessages(episodeTitle, episodeDescription, speakerTexts);
  const llmResponse = await callLLM(messages);
  const speakerMapping = parseSpeakerMapping(llmResponse);

  if (!speakerMapping || Object.keys(speakerMapping).length === 0) {
    console.log(`  ❌ Konnte Sprecher-Namen nicht identifizieren`);
    return false;
  }

  // Validiere Mapping: Alle generischen Sprecher sollten zugeordnet sein
  const allMapped = Array.from(genericSpeakers).every(speaker => speakerMapping.hasOwnProperty(speaker));
  if (!allMapped) {
    console.log(`  ⚠️  Nicht alle Sprecher konnten identifiziert werden`);
  }

  // Erstelle Mapping: generischer Name -> echter Name (nur Vorname)
  const nameMapping = {};
  Array.from(genericSpeakers).forEach(genericName => {
    const realName = speakerMapping[genericName];
    if (realName && typeof realName === 'string' && realName.trim() && !isGenericSpeakerName(realName)) {
      const firstName = extractFirstName(realName.trim());
      nameMapping[genericName] = firstName;
      console.log(`  ✓ ${genericName} → ${firstName}${firstName !== realName.trim() ? ` (aus "${realName.trim()}")` : ''}`);
    } else {
      console.log(`  ⚠️  ${genericName} konnte nicht identifiziert werden (behalten als Fallback)`);
    }
  });

  if (Object.keys(nameMapping).length === 0) {
    console.log(`  ⚠️  Keine Sprecher-Namen konnten identifiziert werden`);
    return false;
  }

  // Aktualisiere Transcript-Datei
  let transcriptUpdated = false;
  transcript.forEach(item => {
    if (item.speaker && nameMapping[item.speaker]) {
      item.speaker = nameMapping[item.speaker];
      transcriptUpdated = true;
    }
  });

  if (transcriptUpdated) {
    fs.writeFileSync(transcriptFile, JSON.stringify(transcriptData, null, 2), 'utf-8');
    console.log(`  ✓ Transcript-Datei aktualisiert`);
  }

  // Aktualisiere Episode JSON-Datei
  if (fs.existsSync(episodeFile)) {
    const episodeData = JSON.parse(fs.readFileSync(episodeFile, 'utf-8'));
    let speakersUpdated = false;

    // Sammle alle eindeutigen Sprecher aus dem aktualisierten Transcript
    const uniqueSpeakers = new Set();
    transcript.forEach(item => {
      if (item.speaker) {
        uniqueSpeakers.add(item.speaker);
      }
    });
    const updatedSpeakersList = Array.from(uniqueSpeakers).sort();

    // Prüfe, ob sich die Sprecher-Liste geändert hat
    const currentSpeakers = Array.isArray(episodeData.speakers) ? episodeData.speakers : [];
    const speakersChanged = 
      currentSpeakers.length !== updatedSpeakersList.length ||
      currentSpeakers.some((speaker, idx) => speaker !== updatedSpeakersList[idx]);

    if (speakersChanged) {
      episodeData.speakers = updatedSpeakersList;
      speakersUpdated = true;
    }

    if (speakersUpdated) {
      fs.writeFileSync(episodeFile, JSON.stringify(episodeData, null, 2), 'utf-8');
      console.log(`  ✓ Episode JSON-Datei aktualisiert`);
    } else {
      console.log(`  ℹ️  Episode JSON-Datei bereits aktuell`);
    }
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
  const remainingArgs = args.filter((arg, idx) => {
    if (arg === '--podcast') return false;
    if (idx > 0 && args[idx - 1] === '--podcast') return false;
    return true;
  });

  let episodesToProcess = [];
  if (remainingArgs.length === 0) {
    // Keine Argumente - nur erste Episode als Test
    episodesToProcess = [episodeNumbers[0]];
    console.log(`Keine Argumente angegeben, verarbeite nur Episode ${episodesToProcess[0]} als Test.\n`);
    console.log(`Verwendung:`);
    console.log(`  node scripts/identify-speakers.js --podcast <podcast-id> <episode-nummer>          # Einzelne Episode`);
    console.log(`  node scripts/identify-speakers.js --podcast <podcast-id> 1 2 3                     # Mehrere Episoden`);
    console.log(`  node scripts/identify-speakers.js --podcast <podcast-id> --all                     # Alle Episoden\n`);
  } else if (remainingArgs[0] === '--all') {
    // Alle Episoden verarbeiten
    episodesToProcess = episodeNumbers;
    console.log(`Verarbeite ALLE Episoden (${episodesToProcess.length})...\n`);
  } else {
    // Einzelne Episode(n)
    episodesToProcess = remainingArgs.map(arg => parseInt(arg, 10)).filter(n => !isNaN(n));
    console.log(`Verarbeite ${episodesToProcess.length} spezifische Episode(n)...\n`);
  }

  if (episodesToProcess.length === 0) {
    console.error(`❌ Keine Episoden zum Verarbeiten gefunden`);
    process.exit(1);
  }

  // Verarbeite Episoden
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const delayMs = settings.topicExtraction?.requestDelayMs || 3000;
  
  console.log(`⏱️  Pause zwischen Anfragen: ${delayMs / 1000} Sekunden\n`);
  console.log(`Podcast: ${PODCAST_ID}\n`);

  for (const episodeNumber of episodesToProcess) {
    try {
      console.log(`\n📝 Episode ${episodeNumber}:`);
      const success = await identifySpeakersForEpisode(episodeNumber);
      processed++;
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
      
      // Pause zwischen Anfragen, um Rate Limits zu vermeiden
      if (episodesToProcess.length > 1 && processed < episodesToProcess.length) {
        console.log(`  ⏸️  Warte ${delayMs / 1000} Sekunden vor nächster Episode...`);
        await sleep(delayMs);
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

