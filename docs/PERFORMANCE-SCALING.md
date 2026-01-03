# Performance & Skalierung

Dieses Dokument beschreibt potenzielle Performance-Probleme bei hoher Nutzerlast und wie man ihnen begegnet.

## Identifizierte Performance-Probleme

### 1. Blocking I/O in Async Context ✅ BEHOBEN

**Problem:**
- `std::fs::read()` wird in async Funktionen verwendet (z.B. in `cache.rs`, `transcript.rs`)
- Blockiert den Tokio Runtime Thread, reduziert Concurrency
- Bei vielen gleichzeitigen Requests kann dies zu Thread Pool Exhaustion führen

**Betroffene Stellen:**
- `src/cache.rs`: `load_rag_index_cached()`, `load_episode_metadata_cached()`, etc.
- `src/transcript.rs`: `load_transcript_entries()`
- `src/rag/retrieval.rs`: `RagIndex::load()`

**Lösung:** ✅ **IMPLEMENTIERT**
- Alle `std::fs::read()` → `tokio::fs::read().await` ersetzt
- Alle `std::fs::read_to_string()` → `tokio::fs::read_to_string().await` ersetzt
- Alle `std::fs::read_dir()` → `tokio::fs::read_dir().await` ersetzt
- JSON Parsing in `tokio::task::spawn_blocking()` gewrappt

```rust
// Implementiert:
let bytes = tokio::fs::read(&path).await?;
let db: RagDb = tokio::task::spawn_blocking(move || {
    serde_json::from_slice(&bytes)
}).await??;
```

### 2. Große JSON-Dateien im Speicher ✅ TEILWEISE BEHOBEN

**Problem:**
- RAG-Embeddings-Dateien können sehr groß sein (mehrere hundert MB)
- Werden komplett in den Speicher geladen
- Bei mehreren Podcasts gleichzeitig kann der Speicher schnell voll werden
- JSON-Parsing ist synchron und blockierend

**Betroffene Stellen:**
- `src/rag/retrieval.rs`: `RagIndex::load()` lädt komplette Datei
- `src/cache.rs`: `load_rag_index_cached()` cached komplette Struktur
- `src/transcript.rs`: Transcript-Dateien werden komplett geladen

**Lösung:** ✅ **STREAMING PARSER IMPLEMENTIERT**
- **Streaming JSON Parser**: `serde_json::Deserializer::from_reader()` für alle großen Dateien
- Dateien werden direkt als Reader geöffnet statt komplett in Speicher zu laden
- Reduziert Peak-Memory-Verbrauch bei großen Dateien
- Implementiert für: RagDb, TranscriptFile, EpisodeMetadata, SpeakerMeta, SpeakerInfo

**Implementierung:**
```rust
// Statt komplett in Speicher laden:
let bytes = tokio::fs::read(&path).await?;
let db: RagDb = serde_json::from_slice(&bytes)?;

// Jetzt mit Streaming:
use serde_json::Deserializer;
use std::fs::File;
use std::io::BufReader;

let file = File::open(&path)?;
let reader = BufReader::new(file);
let mut deserializer = Deserializer::from_reader(reader);
let db: RagDb = serde::Deserialize::deserialize(&mut deserializer)?;
```

**Hinweis:** Die Datenstruktur wird immer noch komplett im Speicher gehalten (für Zugriff), aber der Parsing-Prozess ist jetzt streaming-fähig und reduziert Peak-Memory während des Ladens.

**Zukünftige Optimierungen:**
- **Memory-Mapped Files**: Für read-only Zugriff `memmap2` crate verwenden
- **Lazy Loading**: Nur benötigte Teile laden (z.B. nur Embeddings, nicht alle Metadaten)
- **Compression**: JSON-Dateien mit gzip komprimieren und beim Laden dekomprimieren

### 3. Unbegrenzte Cache-Größe ✅ BEHOBEN

**Problem:**
- Alle Caches (`rag_cache`, `episode_metadata_cache`, etc.) wachsen unbegrenzt
- Bei vielen Episodes/Podcasts kann der Speicher überlaufen
- Keine LRU/LFU Eviction Policy

**Betroffene Stellen:**
- `src/config.rs`: Alle `Arc<RwLock<HashMap<...>>>` Caches

**Lösung:** ✅ **IMPLEMENTIERT**
- Alle Caches auf `moka::future::Cache` migriert
- LRU Eviction mit Größenlimits implementiert
- TTL-basierte Eviction für alle Caches
- Automatische Invalidierung bei Dateiänderungen

**Implementierte Cache-Limits:**
- Transcript Cache: 1000 Einträge, 1h TTL, 30min idle
- RAG Cache: 20 Podcasts, 1h TTL, 30min idle
- Episode Metadata: 5000 Episoden, 1h TTL, 30min idle
- Episode List: 20 Podcasts, 30min TTL, 15min idle
- Speaker Profile: 500 Profile, 1h TTL, 30min idle
- Speakers Index: 20 Podcasts, 30min TTL, 15min idle
- Speaker Meta: 500 Einträge, 1h TTL, 30min idle
- Episode Topics Map: 20 Podcasts, 1h TTL, 30min idle

**Implementierung:**
```rust
use moka::future::Cache;

let rag_cache = Cache::builder()
    .max_capacity(20) // Max 20 Podcasts
    .time_to_live(Duration::from_secs(3600)) // 1 Stunde
    .time_to_idle(Duration::from_secs(1800)) // 30 Minuten idle
    .build();
```

### 4. Externe API Calls (LLM/Embeddings)

**Problem:**
- Jeder Chat-Request macht 2 API Calls (Embedding + Chat Completion)
- Langsame Response-Zeiten (500ms - 5s pro Request)
- Keine Request-Batching oder Caching von Embeddings
- Keine Retry-Logik bei Fehlern

**Betroffene Stellen:**
- `src/rag/embeddings.rs`: `embed_query()`, `llm_answer()`

**Lösungen:**
- **Embedding Cache**: Häufige Queries cachen (z.B. mit `moka`)
- **Request Timeout**: Bereits vorhanden (30s), aber könnte kürzer sein
- **Retry Logic**: Exponential Backoff bei transienten Fehlern
- **Connection Pooling**: Bereits vorhanden, aber Limits prüfen
- **Rate Limiting**: Client-seitige Rate Limits für API Calls

### 5. Parallele Requests ohne Limits

**Problem:**
- Keine Begrenzung gleichzeitiger Requests
- Bei Traffic-Spitzen kann der Server überlastet werden
- Keine Priorisierung von Requests

**Lösungen:**
- **Request Queue**: `tower::limit::ConcurrencyLimit` Middleware
- **Rate Limiting**: `tower-http::limit::RateLimitLayer`
- **Circuit Breaker**: Bei zu vielen Fehlern temporär stoppen
- **Graceful Degradation**: Bei Überlastung einfachere Antworten liefern

**Beispiel:**
```rust
use tower::limit::ConcurrencyLimitLayer;

let app = Router::new()
    .route("/api/chat", post(chat))
    .layer(ConcurrencyLimitLayer::new(10)) // Max 10 gleichzeitige Requests
    .layer(RateLimitLayer::new(100, Duration::from_secs(60))) // 100/min
```

### 6. Synchrones JSON Parsing ✅ BEHOBEN

**Problem:**
- Große JSON-Dateien werden synchron geparst
- Blockiert den Thread während des Parsings

**Lösung:** ✅ **IMPLEMENTIERT**
- Alle JSON-Parsing-Operationen in `tokio::task::spawn_blocking()` gewrappt
- Verhindert Blocking des async Runtime Threads
- CPU-intensive Tasks laufen auf separaten Threads
- **Zusätzlich:** Streaming-Parser implementiert (siehe Problem 2)

**Implementierung:**
```rust
// Streaming-Parser mit Reader:
let file = File::open(&path)?;
let reader = BufReader::new(file);
let mut deserializer = Deserializer::from_reader(reader);
let db: RagDb = tokio::task::spawn_blocking(move || {
    serde::Deserialize::deserialize(&mut deserializer)
}).await??;
```

**Vorteile:**
- Reduziert Peak-Memory während des Parsings
- Dateien werden incrementally gelesen statt komplett geladen
- Bessere Performance bei großen Dateien

### 7. Fehlende Connection Pool Limits

**Problem:**
- HTTP Client hat zwar Connection Pooling, aber keine expliziten Limits
- Bei vielen gleichzeitigen Requests könnten zu viele Connections geöffnet werden

**Lösung:**
```rust
let http = Client::builder()
    .timeout(Duration::from_secs(30))
    .pool_max_idle_per_host(10)
    .pool_idle_timeout(Duration::from_secs(90))
    .max_idle_per_host(20) // Max connections per host
    .build()?;
```

### 8. Keine Request Timeouts pro Endpoint

**Problem:**
- Nur globaler Timeout (30s)
- Manche Endpoints könnten kürzere Timeouts benötigen

**Lösung:**
- Endpoint-spezifische Timeouts mit `tower::timeout::TimeoutLayer`

### 9. Ineffiziente Datenstrukturen

**Problem:**
- `HashMap` für Episodes könnte bei vielen Einträgen langsam werden
- Keine Indizierung für häufige Queries

**Lösungen:**
- **BTreeMap**: Für sortierte Zugriffe
- **Indices**: Separate Indices für häufige Queries (z.B. nach Datum, Speaker)

### 10. Frontend-Performance

**Problem:**
- Große JSON-Responses werden komplett übertragen
- Keine Pagination für große Listen
- Keine Response Compression

**Lösungen:**
- **Response Compression**: `tower-http::compression::CompressionLayer`
- **Pagination**: Bereits teilweise implementiert, aber konsistent verwenden
- **Streaming Responses**: Für sehr große Datenmengen

## Priorisierte Verbesserungen

### Phase 1: Kritische Fixes (Sofort) ✅ TEILWEISE ABGESCHLOSSEN

1. ✅ **Blocking I/O → Async I/O** - **ABGESCHLOSSEN**
   - Alle `std::fs::read()` → `tokio::fs::read()` ersetzt
   - JSON Parsing in `spawn_blocking()` gewrappt
   - Alle I/O-Operationen sind jetzt async

2. ✅ **Cache Limits** - **ABGESCHLOSSEN**
   - LRU Cache mit Größenlimits implementiert
   - TTL-basierte Eviction aktiv
   - Verhindert Memory Leaks

3. ⏳ **Request Limits** - **AUSSTEHEND**
   - Concurrency Limits noch nicht implementiert
   - Rate Limiting noch nicht implementiert
   - **Nächster Schritt:** Tower Middleware hinzufügen

### Phase 2: Performance Optimierungen (Kurzfristig)

4. **Embedding Cache**
   - Häufige Queries cachen
   - Reduziert API Calls

5. **Response Compression**
   - Gzip Compression für große Responses
   - Reduziert Bandbreite

6. **Connection Pool Tuning**
   - Optimale Pool-Größen
   - Bessere Resource-Nutzung

### Phase 3: Skalierungs-Optimierungen (Mittelfristig) ✅ TEILWEISE ABGESCHLOSSEN

7. ✅ **Streaming JSON** - **ABGESCHLOSSEN**
   - Streaming-Parser für alle großen JSON-Dateien implementiert
   - Reduziert Peak-Memory während des Parsings
   - Dateien werden incrementally gelesen

8. ⏳ **Memory-Mapped Files** - **AUSSTEHEND**
   - Für read-only Daten
   - Bessere Memory-Effizienz
   - Würde weitere Memory-Optimierung bringen

9. ⏳ **Distributed Caching** - **AUSSTEHEND**
   - Redis für Shared State
   - Bei Multi-Instance Deployment

## Monitoring & Metriken

Um Performance-Probleme frühzeitig zu erkennen:

1. **Request Latency**: P50, P95, P99
2. **Memory Usage**: Heap Size, Cache Size
3. **Concurrency**: Aktive Requests, Thread Pool Usage
4. **API Calls**: Rate, Success Rate, Latency
5. **Cache Hit Rate**: Für alle Caches

**Empfohlene Tools:**
- `tracing` + `tracing-subscriber` (bereits vorhanden)
- `prometheus` + `grafana` für Metriken
- `tokio-console` für async Runtime Monitoring

## Beispiel-Implementierung: LRU Cache

```rust
use moka::future::Cache;
use std::time::Duration;

// In AppState:
pub struct AppState {
    pub cfg: AppConfig,
    pub http: Client,
    pub rag_cache: Cache<String, Arc<RagIndex>>,
    // ...
}

// Initialisierung:
let rag_cache = Cache::builder()
    .max_capacity(20) // Max 20 Podcasts
    .time_to_live(Duration::from_secs(3600)) // 1 Stunde
    .time_to_idle(Duration::from_secs(1800)) // 30 Minuten idle
    .build();

// Verwendung:
pub async fn load_rag_index_cached(
    st: &AppState,
    podcast_id: &str,
) -> Result<Arc<RagIndex>> {
    if let Some(cached) = st.rag_cache.get(podcast_id).await {
        return Ok(cached);
    }
    
    let rag = Arc::new(RagIndex::load(&rag_db_path)?);
    st.rag_cache.insert(podcast_id.to_string(), rag.clone()).await;
    Ok(rag)
}
```

## Beispiel-Implementierung: Async I/O

```rust
// Statt:
let bytes = std::fs::read(&path)?;
let db: RagDb = serde_json::from_slice(&bytes)?;

// Verwenden:
let bytes = tokio::fs::read(&path).await?;
let db: RagDb = tokio::task::spawn_blocking(move || {
    serde_json::from_slice(&bytes)
}).await??;
```

## Beispiel-Implementierung: Rate Limiting

```rust
use tower::limit::RateLimitLayer;
use tower::limit::ConcurrencyLimitLayer;

let app = Router::new()
    .route("/api/chat", post(chat))
    .route("/api/episodes/search", post(episodes_search))
    .layer(ConcurrencyLimitLayer::new(50)) // Max 50 gleichzeitige Requests
    .layer(RateLimitLayer::new(200, Duration::from_secs(60))) // 200/min
    .layer(cors)
    .with_state(app_state);
```

## Zusammenfassung

### ✅ Implementierte Verbesserungen

1. ✅ **Async I/O** statt blocking I/O
   - Alle Dateioperationen verwenden jetzt `tokio::fs`
   - JSON Parsing läuft in `spawn_blocking()` Threads
   - Keine Blocking-Operationen mehr im async Runtime

2. ✅ **Cache Limits** mit LRU Eviction
   - Alle Caches verwenden `moka::future::Cache`
   - Größenlimits für alle Cache-Typen konfiguriert
   - Automatische TTL-basierte Invalidierung
   - Verhindert unbegrenztes Speicherwachstum

3. ✅ **Synchrones JSON Parsing** → Async
   - Alle JSON-Parsing-Operationen in blocking Tasks
   - Keine Thread-Blockierung mehr

4. ✅ **Streaming JSON Parser**
   - Alle großen JSON-Dateien verwenden jetzt `Deserializer::from_reader()`
   - Dateien werden incrementally gelesen statt komplett geladen
   - Reduziert Peak-Memory-Verbrauch während des Parsings
   - Implementiert für: RagDb, TranscriptFile, EpisodeMetadata, SpeakerMeta, SpeakerInfo

### ⏳ Ausstehende Verbesserungen

4. ⏳ **Request Limits** (Concurrency + Rate)
   - Tower Middleware für Concurrency Limits
   - Rate Limiting pro Endpoint/IP

5. ⏳ **Embedding Cache** für häufige Queries
   - Reduziert externe API Calls
   - Verbessert Response-Zeiten

6. ⏳ **Response Compression** für große Payloads
   - Gzip Compression aktivieren
   - Reduziert Bandbreite

7. ⏳ **Monitoring** für frühzeitige Erkennung
   - Metriken für Cache Hit Rates
   - Request Latency Tracking
   - Memory Usage Monitoring

### Status

**Phase 1 zu ~66% abgeschlossen:**
- ✅ Blocking I/O behoben
- ✅ Cache Limits implementiert
- ⏳ Request Limits ausstehend

**Erwartete Verbesserungen:**
- Bessere Concurrency bei vielen gleichzeitigen Requests
- Kontrollierter Speicherverbrauch durch Cache-Limits
- Keine Thread-Pool-Exhaustion mehr durch blocking I/O

**Nächste Schritte:**
1. Request Limits implementieren (Concurrency + Rate)
2. Embedding Cache hinzufügen
3. Response Compression aktivieren
4. Monitoring einrichten

