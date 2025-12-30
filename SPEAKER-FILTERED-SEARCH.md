# Speaker-Filtered Search Update

## Neue Funktionalität

Wenn ein Speaker im Frontend ausgewählt wird, werden die Suchergebnisse jetzt **nach diesem Speaker gefiltert**. Das bedeutet:

1. **Mehr Ergebnisse abfragen**: Das System holt 3x so viele Embedding-Treffer (z.B. 18 statt 6)
2. **Nach Speaker filtern**: Aus den Transkript-Excerpts werden nur Äußerungen des gewählten Speakers extrahiert
3. **Leere Excerpts überspringen**: Wenn ein Zeitfenster keine Äußerungen des Speakers enthält, wird es übersprungen
4. **Top-K einhalten**: Es werden genau so viele Quellen zurückgegeben wie angefordert (standard: 6)

## Beispiel

### Ohne Speaker-Auswahl (Neutral)
```
Query: "Was wurde über KI diskutiert?"
Results: Alle Sprecher aus relevanten Episoden-Segmenten
```

**Excerpt:**
```
[1:23:45] Tim Pritlove: Also KI ist ja gerade mega spannend.
[1:23:52] roddi: Ja, besonders GPT-4 finde ich interessant.
[1:24:03] Tim Pritlove: Genau, die Code-Generierung ist echt geil.
```

### Mit Speaker-Auswahl (z.B. "Tim Pritlove")
```
Query: "Was wurde über KI diskutiert?"
Results: Nur Tim Pritlove's Äußerungen
```

**Excerpt:**
```
[1:23:45] Tim Pritlove: Also KI ist ja gerade mega spannend.
[1:24:03] Tim Pritlove: Genau, die Code-Generierung ist echt geil.
[1:24:38] Tim Pritlove: Ich hab das letzte Woche ausprobiert und war begeistert.
```

## Vorteile

1. **Konsistentere Antworten**: Die LLM-Antwort basiert nur auf Aussagen des gewählten Speakers
2. **Authentischerer Stil**: Der Speaker kann sich auf seine eigenen Aussagen beziehen
3. **Besserer Kontext**: Keine Vermischung verschiedener Perspektiven
4. **Relevantere Quellen**: Nur das wird zitiert, was der Speaker tatsächlich gesagt hat

## Technische Details

### Backend-Änderungen (`src/rag_backend.rs`)

#### 1. Speaker-Name aus Slug ermitteln
```rust
fn get_speaker_name_from_slug(speakers_dir: &Path, slug: &str) -> Result<String>
```
Liest die `speakers/index.json` und findet den vollständigen Namen zum Slug.

#### 2. Erweiterte Suche
```rust
let search_k = if speaker_name.is_some() { top_k * 3 } else { top_k };
```
Holt 3x mehr Ergebnisse, damit nach Filterung genug übrig bleiben.

#### 3. Gefilterte Excerpt-Extraktion
```rust
fn excerpt_for_window(
    transcript: &[TranscriptEntry],
    start_sec: f64,
    end_sec: f64,
    max_chars: usize,
    speaker_filter: Option<&str>,
) -> String
```
Filtert Transkript-Einträge nach Speaker (case-insensitive Vergleich).

#### 4. Leere Excerpts überspringen
```rust
if speaker_name.is_some() && excerpt.contains("[no transcript entries found") {
    continue;
}
```
Wenn ein Zeitfenster keine Äußerungen des Speakers hat, wird es übersprungen.

#### 5. Top-K einhalten
```rust
if sources.len() >= top_k {
    break;
}
```
Stoppt, sobald genug gefilterte Quellen gefunden wurden.

## Anwendungsfälle

### Use Case 1: "Was sagt Tim über ein Thema?"
**Query**: "Was denkt Tim über Starlink?"
**Speaker**: Tim Pritlove
**Ergebnis**: Nur Tims Meinungen und Aussagen zu Starlink

### Use Case 2: Konsistente Persona
**Query**: "Erkläre mir Quantencomputer"
**Speaker**: Ralf Stockmann
**Ergebnis**: 
- Quellen: Nur Ralfs Erklärungen aus Episoden
- Antwort: Im Stil von Ralf, basierend auf seinen eigenen Aussagen

### Use Case 3: Speaker-Vergleich
Man kann dieselbe Frage mit verschiedenen Speakern stellen:
- "Was sagt Tim über KI?" → Tim Pritlove
- "Was sagt roddi über KI?" → roddi
- Vergleiche die unterschiedlichen Perspektiven!

## Einschränkungen

1. **Weniger Quellen bei seltenen Speakern**: Sprecher mit wenig Redezeit haben weniger Treffer
2. **Mögliche False Negatives**: Wenn der Speaker-Name im Transkript anders geschrieben ist
3. **Performance**: Lädt mehr Ergebnisse und filtert sie (aber minimal spürbar)

## Testen

1. **Backend neu starten** (mit den neuen Änderungen)
2. **Frontend öffnen** → Search Tab
3. **Speaker auswählen** (z.B. Tim Pritlove)
4. **Frage stellen**: "Was wurde über Starlink diskutiert?"
5. **Quellen prüfen**: Sollten nur Äußerungen des gewählten Speakers enthalten

## Debug-Logs

Bei leeren Excerpts siehst du:
```
[no transcript entries found in window 1:23:45 - 1:24:15 (filtered by speaker: Tim Pritlove)]
```

Diese werden automatisch übersprungen, sodass nur relevante Quellen zurückgegeben werden.

---

**Note**: Diese Funktion arbeitet auf Transkript-Ebene, nicht auf Embedding-Ebene. Die semantische Suche findet erst die relevanten Zeitfenster, dann werden die Äußerungen des Speakers daraus extrahiert.

