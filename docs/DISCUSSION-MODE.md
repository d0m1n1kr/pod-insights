# Diskussionsmodus (Discussion Mode)

## Übersicht

Der Diskussionsmodus ist ein Feature der RAG-Suche, das es ermöglicht, Antworten als Dialog/Streitgespräch zwischen zwei Sprechern zu erhalten. Anstatt eine Antwort aus der Perspektive einer einzelnen Person zu bekommen, führen zwei ausgewählte Sprecher eine natürliche Diskussion über das Thema.

## Features

- **Zwei-Sprecher-Dialog**: Wähle zwei Sprecher aus, die das Thema diskutieren
- **Charaktertreue**: Jeder Sprecher behält seine einzigartige Persönlichkeit und Sprechweise
- **Verschiedene Perspektiven**: Die Sprecher präsentieren unterschiedliche Blickwinkel, fordern sich gegenseitig heraus oder bauen aufeinander auf
- **Natürliche Konversation**: Unterbrechungen, Zustimmungen, Meinungsverschiedenheiten und Humor
- **Quellenbasiert**: Alle Aussagen basieren ausschließlich auf den bereitgestellten Transkript-Quellen
- **Zitationen**: Inline-Zitate mit Episode-Nummer und Zeitfenster

## Verwendung

### Frontend (Web-UI)

1. Navigiere zur **Suche**-Seite
2. Wähle einen **ersten Sprecher** aus dem Dropdown (z.B. Tim Pritlove)
3. Ein zweites Dropdown erscheint - wähle einen **zweiten Sprecher** (z.B. Roddi)
4. Gib deine Frage ein
5. Die Antwort wird als Dialog zwischen den beiden Sprechern formatiert

**Hinweis**: Beide Sprecher sollten idealerweise ein vollständiges Profil haben (✓ im Dropdown), um beste Ergebnisse zu erzielen.

### Beispiel-Dialog

**Frage**: "Wie funktioniert Bitcoin Mining?"

**Antwort im Diskussionsmodus (Tim vs. Roddi)**:

```
Tim: Also, Bitcoin Mining ist im Grunde ein riesiger Rechenvorrat... (Episode 281, 12:38-17:19)

Roddi: Moment, moment! Das ist ja sehr vereinfacht. Es geht ja auch um die Sicherheit des gesamten Netzwerks... (Episode 281, 17:20-19:45)

Tim: Ja gut, aber für den Normalsterblichen ist es doch erstmal wichtig zu verstehen, dass...

Roddi: Nee, das sehe ich anders! Wenn man nicht das Grundprinzip versteht...
```

## Backend-API

### Request

```json
{
  "query": "Wie funktioniert Bitcoin Mining?",
  "speakerSlug": "tim-pritlove",
  "speakerSlug2": "roddi",
  "topK": 6
}
```

### Parameter

- `query` (string, required): Die Frage/Anfrage
- `speakerSlug` (string, optional): Slug des ersten Sprechers
- `speakerSlug2` (string, optional): Slug des zweiten Sprechers (aktiviert Diskussionsmodus)
- `topK` (number, optional): Anzahl der Quellen (Standard: 6)

### Modi

1. **Neutral Mode**: Keine Sprecher ausgewählt → sachliche RAG-Antwort
2. **Persona Mode**: Ein Sprecher ausgewählt → Antwort im Stil dieser Person
3. **Discussion Mode**: Zwei Sprecher ausgewählt → Dialog/Diskussion zwischen beiden

## LLM-Prompt (Diskussionsmodus)

Der Diskussionsmodus verwendet einen speziellen System-Prompt:

```
You are orchestrating a DISCUSSION/DEBATE between two people with the following profiles.
Answer the user's question by creating a natural dialogue between these two speakers,
where they discuss, debate, or even argue about the topic based ONLY on the provided SOURCES.

SPEAKER 1 (Tim Pritlove):
[Profil von Tim...]

SPEAKER 2 (Roddi):
[Profil von Roddi...]

IMPORTANT:
- Create a natural back-and-forth discussion or debate between the two speakers
- Each speaker should stay in character with their unique personality, vocabulary, and style
- They should present different perspectives, challenge each other, or build on each other's points
- Format the response as a dialogue with clear speaker labels
- Use only information from the SOURCES provided
- Include citations inline like: (Episode 281, 12:38-17:19)
- Make it feel like a real conversation with interruptions, agreements, disagreements, humor, etc.
```

## Technische Details

### Frontend-Änderungen

- **SearchView.vue**: 
  - Neuer `selectedSpeaker2` ref
  - Zweites Dropdown für Sprecher-Auswahl
  - Bedingte Anzeige (nur wenn `selectedSpeaker` gesetzt)
  - Visuelle Indikatoren für aktiven Diskussionsmodus (💬 Emoji + beide Avatare)

### Backend-Änderungen

- **rag_backend.rs**:
  - `ChatRequest`: Neues `speaker_slug2` Feld
  - `chat_impl`: Laden beider Speaker-Profile
  - `llm_answer`: Erweiterter Prompt mit drei Modi (neutral, persona, discussion)

### i18n-Übersetzungen

Neue Translation-Keys in `de.json`, `en.json`, `fr.json`:

```json
"discussionMode": {
  "none": "Kein Diskussionsmodus (Einzelperson)",
  "selectSecond": "Zweiter Diskussionspartner",
  "active": "💬 Diskussionsmodus aktiv: {speaker1} vs {speaker2}",
  "discussion": "Diskussion"
}
```

## Voraussetzungen

1. **RAG Backend**: Muss laufen (`cargo run --release --bin rag-backend`)
2. **Speaker-Profile**: Beide Sprecher sollten Profile haben
   - Profile generieren: `node generate-speaker-profiles.js --speaker "Tim Pritlove"`
   - Profile-Dateien: `speakers/<slug>.md` und `speakers/<slug>-meta.json`

## Best Practices

- **Kontrastreiche Persönlichkeiten**: Wähle Sprecher mit unterschiedlichen Perspektiven für interessantere Diskussionen
- **Vollständige Profile**: Verwende Sprecher mit vollständigen Profilen (✓) für authentischere Dialoge
- **Spezifische Fragen**: Präzise Fragen führen zu fokussierteren Diskussionen
- **Genug Quellen**: Stelle sicher, dass ausreichend Transkript-Material zu deinem Thema existiert

## Limitierungen

- Funktioniert nur, wenn beide Sprecher Profile haben
- LLM kann manchmal die Charaktere vermischen (abhängig von Profil-Qualität)
- Lange Dialoge können kontext-limitiert sein
- Nicht alle Sprecher haben gleich viel Material in den Transkripten

## Siehe auch

- [SPEAKER-PERSONAS.md](./SPEAKER-PERSONAS.md) - Allgemeine Informationen zu Speaker-Personas
- [SPEAKER-PROFILES.md](./SPEAKER-PROFILES.md) - Wie man Speaker-Profile generiert
- [SPEAKER-METADATA-SCRAPER.md](./SPEAKER-METADATA-SCRAPER.md) - Metadata-Verwaltung

