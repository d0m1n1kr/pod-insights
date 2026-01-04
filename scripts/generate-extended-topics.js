import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments for podcast
const argsForPodcast = process.argv.slice(2);
const podcastIndex = argsForPodcast.indexOf('--podcast');
const PODCAST_ID = podcastIndex !== -1 && argsForPodcast[podcastIndex + 1] ? argsForPodcast[podcastIndex + 1] : 'freakshow';
const PROJECT_ROOT = path.join(__dirname, '..');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    all: false,
    episode: null,
    from: null,
    to: null,
    concurrency: 2,
    maxExcerptChars: 12000,
    timeMarginSec: 20,
    overwrite: false,
    backfillTimes: false,
    dryRun: false,
    useLLMTimestamps: false, // Deprecated: LLM is now the default when no timestamps in topics.json
  };

  // Remove `--podcast <id>` from argv so order doesn't matter (caller always passes it).
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--podcast') {
      i++; // skip value
      continue;
    }
    rest.push(a);
  }
  while (rest.length) {
    const a = rest.shift();
    if (a === '--all') args.all = true;
    else if (a === '--overwrite') args.overwrite = true;
    else if (a === '--backfill-times') args.backfillTimes = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--use-llm-timestamps') args.useLLMTimestamps = true;
    else if (a === '--episode') args.episode = parseInt(rest.shift(), 10);
    else if (a === '--from') args.from = parseInt(rest.shift(), 10);
    else if (a === '--to') args.to = parseInt(rest.shift(), 10);
    else if (a === '--concurrency') args.concurrency = Math.max(1, parseInt(rest.shift(), 10));
    else if (a === '--max-excerpt-chars') args.maxExcerptChars = Math.max(1000, parseInt(rest.shift(), 10));
    else if (a === '--time-margin-sec') args.timeMarginSec = Math.max(0, parseInt(rest.shift(), 10));
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

function usage() {
  return (
    'Usage:\n' +
    '  node scripts/generate-extended-topics.js --episode <n> [--overwrite] [--dry-run]\n' +
    '  node scripts/generate-extended-topics.js --all [--from <n>] [--to <n>] [--concurrency <n>]\n' +
    '\n' +
    'Options:\n' +
    '  --max-excerpt-chars <n>   Max transcript excerpt size sent to LLM (default: 12000)\n' +
    '  --time-margin-sec <n>     Padding around time-window topics (default: 20)\n' +
    '  --overwrite              Re-generate even if output exists\n' +
    '  --backfill-times         Only fill missing summaryMeta.startSec/endSec in existing *-extended-topics.json (no LLM calls)\n' +
    '  --use-llm-timestamps     (Deprecated: LLM is now default when no timestamps in topics.json)\n' +
    '  --dry-run                Don\'t call the LLM; write empty summaries (useful to test IO)\n'
  );
}

function tryReadJson(p) {
  try {
    if (!fs.existsSync(p)) return { ok: false, value: null, error: null };
    return { ok: true, value: JSON.parse(fs.readFileSync(p, 'utf-8')), error: null };
  } catch (e) {
    return { ok: false, value: null, error: e };
  }
}

function loadSettings({ allowMissing } = { allowMissing: false }) {
  // Prefer settings.json, but in some environments it may be blocked (ignored/secret file).
  const settingsPath = path.join(__dirname, '..', 'settings.json');
  const fromSettings = tryReadJson(settingsPath);

  if (fromSettings.ok) return { settings: fromSettings.value, source: 'settings.json' };

  // If settings.json is missing or unreadable, allow env-based config (and optionally fall back to settings.example.json)
  const examplePath = path.join(__dirname, '..', 'settings.example.json');
  const fromExample = tryReadJson(examplePath);

  const envLLM = {
    provider: process.env.LLM_PROVIDER,
    model: process.env.LLM_MODEL,
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    temperature: process.env.LLM_TEMPERATURE != null ? parseFloat(process.env.LLM_TEMPERATURE) : undefined,
    maxTokens: process.env.LLM_MAX_TOKENS != null ? parseInt(process.env.LLM_MAX_TOKENS, 10) : undefined,
  };

  const envTopic = {
    language: process.env.TOPIC_LANGUAGE,
    requestDelayMs: process.env.TOPIC_REQUEST_DELAY_MS != null ? parseInt(process.env.TOPIC_REQUEST_DELAY_MS, 10) : undefined,
    maxRetries: process.env.TOPIC_MAX_RETRIES != null ? parseInt(process.env.TOPIC_MAX_RETRIES, 10) : undefined,
    retryDelayMs: process.env.TOPIC_RETRY_DELAY_MS != null ? parseInt(process.env.TOPIC_RETRY_DELAY_MS, 10) : undefined,
  };

  const base = fromExample.ok ? fromExample.value : { llm: {}, topicExtraction: {} };

  const merged = {
    ...base,
    llm: {
      ...(base.llm || {}),
      ...Object.fromEntries(Object.entries(envLLM).filter(([, v]) => v !== undefined && v !== '')),
    },
    topicExtraction: {
      ...(base.topicExtraction || {}),
      ...Object.fromEntries(Object.entries(envTopic).filter(([, v]) => v !== undefined && v !== '')),
    },
  };

  const hasUsableSettings =
    typeof merged?.llm?.baseURL === 'string' &&
    merged.llm.baseURL.trim() &&
    typeof merged?.llm?.model === 'string' &&
    merged.llm.model.trim() &&
    typeof merged?.llm?.apiKey === 'string' &&
    merged.llm.apiKey.trim() &&
    merged.llm.apiKey !== 'YOUR_API_KEY_HERE';

  if (!allowMissing && !hasUsableSettings) {
    const reason = fromSettings.error ? `\n(Reason: ${String(fromSettings.error?.message || fromSettings.error)})\n` : '\n';
    throw new Error(
      'LLM config not found.\n' +
        reason +
        'Provide one of:\n' +
        '- settings.json (copy settings.example.json → settings.json)\n' +
        '- or env vars: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL (optional: LLM_PROVIDER, LLM_TEMPERATURE, LLM_MAX_TOKENS)\n'
    );
  }

  return { settings: merged, source: fromExample.ok ? 'settings.example.json+env' : 'env' };
}

function findTopicsFiles() {
  const episodesDir = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes');
  const files = fs.readdirSync(episodesDir);
  return files
    .filter(f => /^\d+-topics\.json$/.test(f))
    .map(f => ({
      file: f,
      episodeNumber: parseInt(f.match(/^(\d+)/)[1], 10),
      path: path.join(episodesDir, f),
    }))
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function parseHmsToSeconds(hms) {
  // Accepts "H:MM:SS" or "MM:SS"
  const s = String(hms || '').trim();
  if (!s) return null;
  const parts = s.split(':').map(x => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(p => parseInt(p, 10));
  if (nums.some(n => Number.isNaN(n))) return null;
  if (nums.length === 2) {
    const [m, sec] = nums;
    return m * 60 + sec;
  }
  const [h, m, sec] = nums;
  return h * 3600 + m * 60 + sec;
}

function normalizeTopicLikeString(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function topicTokens(topic) {
  const t = normalizeTopicLikeString(topic);
  const raw = t.split(' ').filter(Boolean);
  const stop = new Set([
    'und',
    'oder',
    'der',
    'die',
    'das',
    'ein',
    'eine',
    'mit',
    'für',
    'von',
    'im',
    'in',
    'am',
    'an',
    'zu',
    'auf',
    'bei',
    'über',
    'zwischen',
    'the',
    'a',
    'an',
    'of',
    'to',
    'in',
    'on',
    'and',
    'or',
  ]);
  // Prefer longer tokens (better signal)
  return raw.filter(w => w.length >= 3 && !stop.has(w));
}

function formatTranscriptLines(entries) {
  return entries
    .map(e => {
      const t = typeof e.time === 'string' ? e.time : '';
      const sp = typeof e.speaker === 'string' ? e.speaker : '';
      const tx = typeof e.text === 'string' ? e.text : '';
      return `[${t}] ${sp}: ${tx}`.trim();
    })
    .filter(Boolean)
    .join('\n');
}

function excerptByTimeWindow(transcript, startSec, endSec, maxChars) {
  const picked = transcript.filter(e => {
    const sec = e._sec;
    if (!Number.isFinite(sec)) return false;
    return sec >= startSec && sec <= endSec;
  });

  const text = formatTranscriptLines(picked);
  if (text.length <= maxChars) return { text, pickedCount: picked.length };
  return { text: text.slice(0, maxChars), pickedCount: picked.length };
}

function excerptByKeywordWindow(transcript, topic, maxChars) {
  const toks = topicTokens(topic);
  if (toks.length === 0) return { text: '', method: 'keyword-window', pickedCount: 0, startSec: null, endSec: null };

  // Score each line by token hits.
  const scored = [];
  for (let i = 0; i < transcript.length; i++) {
    const tx = normalizeTopicLikeString(transcript[i]?.text);
    if (!tx) continue;
    let score = 0;
    for (const t of toks) {
      if (tx.includes(t)) score++;
    }
    if (score > 0) scored.push({ i, score });
  }

  if (scored.length === 0) return { text: '', method: 'keyword-window', pickedCount: 0, startSec: null, endSec: null };

  scored.sort((a, b) => b.score - a.score);
  const centers = scored.slice(0, Math.min(10, scored.length)).map(s => s.i);
  centers.sort((a, b) => a - b);

  const spans = [];
  for (const c of centers) {
    spans.push([Math.max(0, c - 8), Math.min(transcript.length - 1, c + 8)]);
  }
  // Merge overlapping spans.
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    if (!merged.length) merged.push(s);
    else {
      const last = merged[merged.length - 1];
      if (s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
      else merged.push(s);
    }
  }

  // Collect until maxChars.
  const picked = [];
  for (const [a, b] of merged) {
    for (let i = a; i <= b; i++) picked.push(transcript[i]);
    const txt = formatTranscriptLines(picked);
    if (txt.length >= maxChars) {
      const secs = picked.map(e => e?._sec).filter(v => Number.isFinite(v));
      const minSec = secs.length ? Math.min(...secs) : null;
      const maxSec = secs.length ? Math.max(...secs) : null;
      return {
        text: txt.slice(0, maxChars),
        method: 'keyword-window',
        pickedCount: picked.length,
        startSec: Number.isFinite(minSec) ? minSec : null,
        endSec: Number.isFinite(maxSec) ? maxSec : null,
      };
    }
  }

  const secs = picked.map(e => e?._sec).filter(v => Number.isFinite(v));
  const minSec = secs.length ? Math.min(...secs) : null;
  const maxSec = secs.length ? Math.max(...secs) : null;
  return {
    text: formatTranscriptLines(picked),
    method: 'keyword-window',
    pickedCount: picked.length,
    startSec: Number.isFinite(minSec) ? minSec : null,
    endSec: Number.isFinite(maxSec) ? maxSec : null,
  };
}

/**
 * Uses LLM to find precise start and end timestamps for all topics in the transcript
 * Topics must be ordered and non-overlapping
 */
function batchTimestampDetectionMessages({ episodeNumber, episodeTitle, topics, transcriptSample, languageHint }) {
  const topicsList = topics.map((t, idx) => {
    const subjectLine = t.subject && (t.subject.coarse || t.subject.fine)
      ? ` (${t.subject.coarse || ''}${t.subject.coarse && t.subject.fine ? ' / ' : ''}${t.subject.fine || ''})`
      : '';
    return `${idx + 1}. ${t.topic}${subjectLine}`;
  }).join('\n');

  return [
    {
      role: 'system',
      content:
        'Du analysierst ein Podcast-Transkript und findest die genauen Zeitstempel (in Sekunden) ' +
        'für alle gegebenen Themen.\n' +
        '\n' +
        'KRITISCH WICHTIG:\n' +
        '- Die Themen müssen in der richtigen chronologischen Reihenfolge sein (wie sie im Podcast besprochen werden).\n' +
        '- Die Themen dürfen sich NICHT überlappen.\n' +
        '- Das Ende eines Themas ist der Start des nächsten Themas (endSec von Thema N = startSec von Thema N+1).\n' +
        '- Analysiere das gesamte Transkript, um die korrekte Reihenfolge zu bestimmen.\n' +
        '- Finde für jedes Thema den genauen Startpunkt (wann beginnt die Diskussion) und Endpunkt (wann endet die Diskussion).\n' +
        '- Wenn ein Thema nicht im Transkript vorkommt, setze startSec und endSec auf null.\n' +
        '- Die Zeitstempel müssen aus dem Transkript extrahiert werden (siehe [MM:SS] Format und Sekunden in Klammern).\n' +
        '- Verwende die Sekundenwerte aus den Klammern im Transkript für maximale Genauigkeit.\n' +
        '- Antworte AUSSCHLIESSLICH mit einem JSON-Array, KEIN zusätzlicher Text davor oder danach.\n' +
        '- Format: [{"topic": string, "startSec": number|null, "endSec": number|null}, ...]\n' +
        '- startSec und endSec müssen in Sekunden angegeben werden (z.B. 120 für 2 Minuten).\n' +
        '- Das Array muss die gleiche Reihenfolge wie die gegebenen Themen haben.\n' +
        '- KEINE Erklärungen, KEINE Markdown-Code-Blöcke, NUR das JSON-Array.',
    },
    {
      role: 'user',
      content:
        `Episode: ${episodeNumber} - ${episodeTitle || ''}\n\n` +
        `THEMEN (in gegebener Reihenfolge):\n${topicsList}\n\n` +
        `VOLLSTÄNDIGES TRANSKRIPT (mit Zeitstempeln):\n${transcriptSample}`,
    },
  ];
}

/**
 * Formats the full transcript for LLM analysis
 */
function formatFullTranscript(transcript, maxChars = 100000) {
  if (!transcript || transcript.length === 0) {
    return '';
  }

  let transcriptSample = '';
  let charCount = 0;
  
  for (const e of transcript) {
    const time = e?.time || '';
    const speaker = e?.speaker || '';
    const text = e?.text || '';
    const sec = e?._sec;
    
    // Format: [MM:SS] (XXXs) Speaker: text
    const timeDisplay = Number.isFinite(sec) 
      ? `[${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}] (${Math.floor(sec)}s)`
      : `[${time}]`;
    
    const line = `${timeDisplay} ${speaker}: ${text}\n`;
    
    if (charCount + line.length > maxChars) {
      break;
    }
    
    transcriptSample += line;
    charCount += line.length;
  }

  return transcriptSample;
}

/**
 * Uses LLM to detect precise timestamps for all topics at once
 * Ensures topics are ordered and non-overlapping
 */
async function detectBatchTimestampsWithLLM(llmCfg, retryCfg, { episodeNumber, episodeTitle, topics, transcript, languageHint }) {
  if (!transcript || transcript.length === 0 || !topics || topics.length === 0) {
    return topics.map(() => ({ startSec: null, endSec: null }));
  }

  // Format full transcript (use larger limit for batch processing)
  const transcriptSample = formatFullTranscript(transcript, 100000);

  if (!transcriptSample.trim()) {
    return topics.map(() => ({ startSec: null, endSec: null }));
  }

  const messages = batchTimestampDetectionMessages({
    episodeNumber,
    episodeTitle,
    topics,
    transcriptSample,
    languageHint,
  });

  try {
    const raw = await callChatCompletionsOpenAICompatible(llmCfg, messages, retryCfg);
    
    // Clean up the response - remove markdown code blocks if present
    let cleaned = String(raw || '').trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.trim();
    
    let parsed;
    try {
      parsed = extractFirstJsonObject(cleaned);
    } catch (parseError) {
      console.error(`  ⚠️  JSON parsing failed. Raw response (first 500 chars): ${cleaned.substring(0, 500)}`);
      throw parseError;
    }
    
    // Handle both array and object responses
    let results = Array.isArray(parsed) ? parsed : (parsed.topics || parsed.results || parsed.timestamps || []);
    
    // Ensure we have the right number of results
    if (results.length !== topics.length) {
      console.error(`  ⚠️  LLM returned ${results.length} timestamps but expected ${topics.length}`);
      console.error(`  Response: ${JSON.stringify(parsed, null, 2).substring(0, 500)}`);
      return topics.map(() => ({ startSec: null, endSec: null }));
    }

    // Extract and validate timestamps
    const timestamps = results.map((r, idx) => {
      // Handle both object format {topic, startSec, endSec} and {startSec, endSec}
      const topicData = r.topic ? r : (topics[idx] ? { topic: topics[idx].topic, ...r } : r);
      const startSec = Number.isFinite(topicData?.startSec) ? Math.max(0, Math.floor(topicData.startSec)) : null;
      const endSec = Number.isFinite(topicData?.endSec) ? Math.max(0, Math.floor(topicData.endSec)) : null;
      
      // Validate: endSec should be >= startSec
      if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec >= startSec) {
        return { startSec, endSec };
      }
      
      return { startSec: null, endSec: null };
    });

    // Ensure non-overlapping and ordered: endSec of topic N = startSec of topic N+1
    for (let i = 0; i < timestamps.length - 1; i++) {
      const current = timestamps[i];
      const next = timestamps[i + 1];
      
      if (Number.isFinite(current.endSec) && Number.isFinite(next.startSec)) {
        // Adjust next start to match current end if they don't match
        if (next.startSec !== current.endSec) {
          next.startSec = current.endSec;
        }
      } else if (Number.isFinite(current.endSec) && !Number.isFinite(next.startSec)) {
        // If next has no start, set it to current end
        next.startSec = current.endSec;
      }
    }

    return timestamps;
  } catch (error) {
    console.error(`  ⚠️  LLM batch timestamp detection failed: ${error.message}`);
    if (error.stack) {
      console.error(`  Stack: ${error.stack}`);
    }
    return topics.map(() => ({ startSec: null, endSec: null }));
  }
}

function extractFirstJsonObject(text) {
  const s = String(text || '').trim();
  
  // Try to find JSON array first (for batch timestamp detection)
  const arrayMatch = s.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch (e) {
      // Fall through to object parsing
    }
  }
  
  // Try to find JSON object
  const objectMatch = s.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (e) {
      // Fall through to full text parsing
    }
  }
  
  // Last resort: try parsing the entire string
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}. Text: ${s.substring(0, 200)}...`);
  }
}

async function callChatCompletionsOpenAICompatible(llmCfg, messages, retryCfg) {
  const { baseURL, apiKey, model, temperature, maxTokens } = llmCfg;
  const { maxRetries, retryDelayMs } = retryCfg;

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 && attempt < maxRetries) {
        const waitMs = retryDelayMs * Math.pow(2, attempt);
        console.log(`  ⏳ Rate limit, warte ${Math.round(waitMs / 1000)}s... (${attempt + 1}/${maxRetries})`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`LLM API Fehler: ${res.status} - ${t}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('LLM-Antwort leer/unerwartetes Format');
      return content;
    } catch (e) {
      const msg = String(e?.message || e);
      const isNetwork = msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT');
      if (isNetwork && attempt < maxRetries) {
        const waitMs = retryDelayMs * Math.pow(2, attempt);
        console.log(`  ⏳ Netzwerkfehler, warte ${Math.round(waitMs / 1000)}s... (${attempt + 1}/${maxRetries})`);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
  }

  throw new Error('Unreachable: retry loop ended unexpectedly');
}

function summaryMessages({ episodeNumber, episodeTitle, topic, subject, excerptText, languageHint }) {
  const subjectLine =
    subject && (subject.coarse || subject.fine)
      ? `Subject: ${subject.coarse || ''}${subject.coarse && subject.fine ? ' / ' : ''}${subject.fine || ''}\n`
      : '';

  return [
    {
      role: 'system',
      content:
        'Du erstellst kurze, embedding-taugliche Topic-Summaries für RAG.\n' +
        'Wichtig:\n' +
        '- Nutze ausschließlich Informationen aus dem gegebenen Transkript-Ausschnitt.\n' +
        '- Wenn der Ausschnitt das Thema NICHT wirklich enthält, antworte mit {"summary": ""}.\n' +
        '- Keine Halluzinationen, keine Vermutungen, keine externen Fakten.\n' +
        '- Schreibe kompakt, aber informationsdicht (ca. 3-8 Sätze).\n' +
        '- Nenne relevante Begriffe/Produkte/Orte/Personen, wenn sie im Ausschnitt vorkommen.\n' +
        '- Sprache: ' +
        (languageHint ? languageHint : 'de') +
        '\n' +
        'Antworte ausschließlich mit einem JSON-Objekt: {"summary": string}.',
    },
    {
      role: 'user',
      content:
        `Episode: ${episodeNumber} - ${episodeTitle || ''}\n` +
        `Topic: ${topic}\n` +
        subjectLine +
        '\nTRANSKRIPT-AUSSCHNITT:\n' +
        excerptText,
    },
  ];
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= limit) return;
    const next = queue.shift();
    if (!next) return;
    active++;
    next()
      .catch(() => {})
      .finally(() => {
        active--;
        runNext();
      });
  };

  return fn =>
    new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      runNext();
    });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  // `--dry-run` and `--backfill-times` don't require LLM config / settings.json access.
  const { settings, source: settingsSource } = loadSettings({ allowMissing: args.dryRun || args.backfillTimes });
  const llmCfg = settings.llm || {};
  const retryCfg = {
    maxRetries: settings.topicExtraction?.maxRetries ?? 3,
    retryDelayMs: settings.topicExtraction?.retryDelayMs ?? 5000,
  };
  const requestDelayMs = settings.topicExtraction?.requestDelayMs ?? 0;

  const topicsFiles = findTopicsFiles();
  let selected = topicsFiles;

  if (Number.isFinite(args.episode)) {
    selected = topicsFiles.filter(t => t.episodeNumber === args.episode);
    if (selected.length === 0) throw new Error(`No topics file found for episode ${args.episode}`);
  } else if (args.all || Number.isFinite(args.from) || Number.isFinite(args.to)) {
    const from = Number.isFinite(args.from) ? args.from : -Infinity;
    const to = Number.isFinite(args.to) ? args.to : Infinity;
    selected = topicsFiles.filter(t => t.episodeNumber >= from && t.episodeNumber <= to);
  } else {
    throw new Error('Specify --episode <n> or --all (optionally --from/--to).\n\n' + usage());
  }

  console.log(`🧩 Extended topics generation`);
  console.log(`Episodes:     ${selected.length}`);
  console.log(`LLM:          ${args.dryRun ? 'disabled (--dry-run)' : `${llmCfg.provider || 'openai-compatible'} - ${llmCfg.model}`}`);
  console.log(`Settings:     ${settingsSource}`);
  console.log(`Concurrency:  ${args.concurrency}`);
  console.log(`\n`);

  const limiter = createLimiter(args.concurrency);

  for (const ep of selected) {
    const outPath = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes', `${ep.episodeNumber}-extended-topics.json`);
    const topicsData = JSON.parse(fs.readFileSync(ep.path, 'utf-8'));
    const transcriptPath = path.join(PROJECT_ROOT, 'podcasts', PODCAST_ID, 'episodes', `${ep.episodeNumber}-ts.json`);
    const transcriptFound = fs.existsSync(transcriptPath);

    let transcript = null;
    if (transcriptFound) {
      const t = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
      const arr = Array.isArray(t?.transcript) ? t.transcript : [];
      transcript = arr
        .map(e => ({
          speaker: e?.speaker ?? null,
          time: e?.time ?? null,
          text: e?.text ?? null,
          _sec: parseHmsToSeconds(e?.time),
        }))
        .filter(e => typeof e.text === 'string' && e.text.trim().length > 0);
    }

    // Backfill mode: only update timestamps in existing extended topics (no LLM calls, keep summaries)
    if (args.backfillTimes && fs.existsSync(outPath)) {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      const existingTopics = Array.isArray(existing?.topics) ? existing.topics : [];
      if (!transcriptFound || !Array.isArray(transcript) || transcript.length === 0) {
        console.log(`⏭️  ${ep.episodeNumber}: backfill skipped (no transcript)`);
        continue;
      }

      let changed = 0;
      const updatedTopics = existingTopics.map((t) => {
        const sm = t?.summaryMeta && typeof t.summaryMeta === 'object' ? t.summaryMeta : null;
        const hasStart = Number.isFinite(sm?.startSec);
        const hasEnd = Number.isFinite(sm?.endSec);
        // If already has a usable window, keep as-is.
        if (hasStart && hasEnd) return t;

        const pos = Number.isFinite(t?.positionSec) ? t.positionSec : null;
        const dur = Number.isFinite(t?.durationSec) ? t.durationSec : null;
        if (Number.isFinite(pos) && Number.isFinite(dur) && dur > 0) {
          const startSec = Math.max(0, pos - args.timeMarginSec);
          const endSec = pos + dur + args.timeMarginSec;
          changed++;
          return {
            ...t,
            summaryMeta: {
              ...(sm || {}),
              transcriptFound: true,
              transcriptFile: path.basename(transcriptPath),
              method: 'time-window',
              startSec,
              endSec,
              backfilledAt: new Date().toISOString(),
            }
          };
        }

        // In backfill mode, if no timestamps exist, we can't use LLM (would require --overwrite)
        // So we skip topics without timestamps in backfill mode
        // (They would need to be regenerated with LLM detection)

        return t;
      });

      if (changed > 0) {
        const out = {
          ...existing,
          extendedAt: existing?.extendedAt || new Date().toISOString(),
          transcriptFound,
          transcriptFile: path.basename(transcriptPath),
          topics: updatedTopics,
        };
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
        console.log(`🩹 ${ep.episodeNumber}: backfilled timestamps for ${changed} topics`);
      } else {
        console.log(`⏭️  ${ep.episodeNumber}: nothing to backfill`);
      }
      continue;
    }

    if (!args.overwrite && fs.existsSync(outPath)) {
      console.log(`⏭️  ${ep.episodeNumber}: output exists, skipping (use --overwrite)`);
      continue;
    }

    console.log(`▶️  ${ep.episodeNumber}: ${topicsData?.title || ''} (${topicsData?.topics?.length || 0} topics)`);

    // Check if any topics need LLM timestamp detection
    const topicsNeedingLLM = (topicsData.topics || []).filter(t => {
      const positionSec = Number.isFinite(t?.positionSec) ? t.positionSec : null;
      const durationSec = Number.isFinite(t?.durationSec) ? t.durationSec : null;
      return !(Number.isFinite(positionSec) && Number.isFinite(durationSec) && durationSec > 0);
    });

    // Batch detect timestamps for all topics that need it
    let batchTimestamps = null;
    if (topicsNeedingLLM.length > 0 && !args.dryRun && transcriptFound) {
      try {
        console.log(`  🔍 Detecting timestamps for ${topicsNeedingLLM.length} topics using LLM...`);
        batchTimestamps = await detectBatchTimestampsWithLLM(llmCfg, retryCfg, {
          episodeNumber: ep.episodeNumber,
          episodeTitle: topicsData?.title || '',
          topics: topicsNeedingLLM,
          transcript,
          languageHint: settings.topicExtraction?.language || 'de',
        });
        console.log(`  ✅ Timestamp detection complete`);
      } catch (error) {
        console.error(`  ⚠️  Batch timestamp detection failed: ${error.message}`);
        batchTimestamps = topicsNeedingLLM.map(() => ({ startSec: null, endSec: null }));
      }
    }

    // Create a map of topic -> timestamp for quick lookup
    const timestampMap = new Map();
    if (batchTimestamps) {
      topicsNeedingLLM.forEach((topic, idx) => {
        timestampMap.set(topic.topic, batchTimestamps[idx]);
      });
    }

    const extendedTopics = await Promise.all(
      (topicsData.topics || []).map((t, idx) =>
        limiter(async () => {
          const base = { ...t };
          const subject = base?.subject && typeof base.subject === 'object' ? base.subject : null;

          if (!transcriptFound) {
            return {
              ...base,
              summary: '',
              summaryMeta: {
                transcriptFound: false,
                transcriptFile: path.basename(transcriptPath),
              },
            };
          }

          const positionSec = Number.isFinite(base?.positionSec) ? base.positionSec : null;
          const durationSec = Number.isFinite(base?.durationSec) ? base.durationSec : null;

          let excerpt = '';
          let excerptMeta = { method: 'none', pickedCount: 0, startSec: null, endSec: null };

          if (Number.isFinite(positionSec) && Number.isFinite(durationSec) && durationSec > 0) {
            // Method 1: Use existing timestamps from topics file (highest priority)
            const startSec = Math.max(0, positionSec - args.timeMarginSec);
            const endSec = positionSec + durationSec + args.timeMarginSec;
            const r = excerptByTimeWindow(transcript, startSec, endSec, args.maxExcerptChars);
            excerpt = r.text;
            excerptMeta = { method: 'time-window', pickedCount: r.pickedCount, startSec, endSec };
          } else if (!args.dryRun && timestampMap.has(base.topic)) {
            // Method 2: Use LLM batch-detected timestamps
            const llmTimestamps = timestampMap.get(base.topic);
            
            if (Number.isFinite(llmTimestamps.startSec) && Number.isFinite(llmTimestamps.endSec)) {
              const startSec = Math.max(0, llmTimestamps.startSec - args.timeMarginSec);
              const endSec = llmTimestamps.endSec + args.timeMarginSec;
              const r = excerptByTimeWindow(transcript, startSec, endSec, args.maxExcerptChars);
              excerpt = r.text;
              excerptMeta = {
                method: 'llm-batch-timestamp-detection',
                pickedCount: r.pickedCount,
                startSec,
                endSec,
                llmDetectedStartSec: llmTimestamps.startSec,
                llmDetectedEndSec: llmTimestamps.endSec,
              };
            } else {
              // LLM didn't find timestamps - return empty excerpt
              excerpt = '';
              excerptMeta = {
                method: 'llm-batch-timestamp-detection',
                pickedCount: 0,
                startSec: null,
                endSec: null,
                llmDetectionFailed: true,
              };
            }
          } else {
            // Dry run mode or no LLM timestamps available
            excerpt = '';
            excerptMeta = { method: args.dryRun ? 'dry-run' : 'no-timestamps', pickedCount: 0, startSec: null, endSec: null };
          }

          if (!excerpt.trim()) {
            return {
              ...base,
              summary: '',
              summaryMeta: {
                transcriptFound: true,
                transcriptFile: path.basename(transcriptPath),
                ...excerptMeta,
                note: 'no-excerpt',
              },
            };
          }

          if (args.dryRun) {
            return {
              ...base,
              summary: '',
              summaryMeta: {
                transcriptFound: true,
                transcriptFile: path.basename(transcriptPath),
                ...excerptMeta,
                dryRun: true,
              },
            };
          }

          const messages = summaryMessages({
            episodeNumber: ep.episodeNumber,
            episodeTitle: topicsData?.title || '',
            topic: base.topic,
            subject,
            excerptText: excerpt,
            languageHint: settings.topicExtraction?.language || 'de',
          });

          const raw = await callChatCompletionsOpenAICompatible(llmCfg, messages, retryCfg);
          const parsed = extractFirstJsonObject(raw);
          const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';

          if (requestDelayMs > 0) await sleep(requestDelayMs);

          if ((idx + 1) % 5 === 0) {
            console.log(`  … topic ${idx + 1}/${topicsData.topics.length}`);
          }

          return {
            ...base,
            summary,
            summaryMeta: {
              transcriptFound: true,
              transcriptFile: path.basename(transcriptPath),
              ...excerptMeta,
              generatedAt: new Date().toISOString(),
              llm: {
                provider: llmCfg.provider || 'openai-compatible',
                model: llmCfg.model,
                temperature: llmCfg.temperature,
              },
            },
          };
        })
      )
    );

    const out = {
      ...topicsData,
      extendedAt: new Date().toISOString(),
      transcriptFound,
      transcriptFile: path.basename(transcriptPath),
      topics: extendedTopics,
    };

    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
    console.log(`✅ wrote ${path.relative(__dirname, outPath)}`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('\n❌', err?.stack || err?.message || err);
  process.exit(1);
});


