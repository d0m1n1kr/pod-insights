# Speaker Personas Feature

## Overview

The RAG search system now supports **speaker personas** - the ability to have answers delivered in the voice, style, and personality of different podcast speakers. This feature uses the detailed speaker profiles generated from podcast transcripts to roleplay as fictional characters based on real speaking patterns.

## Features

### 1. Neutral Mode (Default)
- Standard RAG assistant behavior
- Objective, factual answers
- No personality overlay
- This is the original behavior

### 2. Speaker Persona Mode
- Answer in the voice of a specific speaker
- Uses vocabulary, phrases, and speech patterns from speaker profile
- Matches humor style and attitude
- Still factual and citation-based, but delivered in character

## How It Works

### Backend (`src/rag_backend.rs`)

#### New Endpoint: `/api/speakers`
Returns a list of all available speaker profiles:

```json
{
  "speakers": [
    {
      "speaker": "Tim Pritlove",
      "slug": "tim-pritlove",
      "episodesCount": 86,
      "utterancesCount": 33797,
      "totalWords": 395236
    },
    ...
  ]
}
```

#### Extended Chat Request
The `/api/chat` endpoint now accepts an optional `speakerSlug` parameter:

```json
{
  "query": "Was wurde über KI diskutiert?",
  "speakerSlug": "tim-pritlove"
}
```

#### Speaker Profile Loading
- Profiles are loaded from `speakers/{slug}.md`
- Full markdown content is passed to the LLM
- Includes vocabulary, style patterns, humor examples, etc.

#### Modified LLM Prompt
When a speaker is selected:

**System Prompt:**
```
You are roleplaying as a fictional person described in the following speaker profile.
Answer the user's question using ONLY the provided SOURCES (transcript excerpts),
but deliver the answer in the voice, style, and personality described in the profile below.

SPEAKER PROFILE:
[Full markdown profile content]

IMPORTANT:
- Stay in character throughout your response
- Use the vocabulary, phrases, and speech patterns from the profile
- Match the humor style and attitude described
- If the sources don't contain enough information, say so in character
- Include citations inline like: (Episode 281, 12:38-17:19)
- Answer in German unless the user asks otherwise
```

**User Prompt:**
```
QUESTION:
[User's question]

SOURCES:
[Retrieved transcript excerpts]

Remember: Answer this question as the person from the speaker profile,
using their typical vocabulary, style, and humor. Use only information from the sources.
```

### Frontend (`frontend/src/views/SearchView.vue`)

#### Speaker Dropdown
Added to the search interface header:
- **Default**: "Neutral (Standard)" - original behavior
- **Speaker options**: List all available speakers with episode/word counts
- Shows context when a speaker is selected
- Disabled during searches or when speakers are loading

#### Implementation Details
- Fetches speakers list on component mount
- Stores selected speaker in reactive ref
- Passes `speakerSlug` to chat API when selected
- Gracefully handles missing speaker profiles

## Usage

### For Users

1. **Navigate to Search Tab**
2. **Select Answer Style:**
   - Choose "Neutral (Standard)" for objective answers
   - Choose a speaker persona for answers in their voice
3. **Enter your question** (via URL parameter `?q=your+question`)
4. **Receive answer** in the selected style

### Example Queries

**Neutral Mode:**
> **Q:** Was wurde über Starlink diskutiert?
> 
> **A:** In Episode 280 wird Starlink als Satelliten-Internet-Dienst von SpaceX erwähnt. Es wurde über die Verfügbarkeit und Leistung diskutiert... (Episode 280, 45:12-47:38)

**Tim Pritlove Persona:**
> **Q:** Was wurde über Starlink diskutiert?
> 
> **A:** Also, Starlink ist ja schon ziemlich geil, muss ich sagen. In der Sendung haben wir das durchgekaut - so um Minute 45 rum (Episode 280, 45:12-47:38). Das ist halt dieses Satelliten-Internet von SpaceX, und ich mein, die Coverage ist einfach mega...

## Configuration

### Environment Variables

```bash
# Optional: Custom speakers directory (default: ./speakers)
export SPEAKERS_DIR="./speakers"
```

### Speaker Profile Requirements

For a speaker to appear in the dropdown:
1. Must be listed in `speakers/index.json`
2. Must have a corresponding `speakers/{slug}.md` profile file
3. Profile should include detailed style information

### Regenerating Profiles

To ensure high-quality personas:

```bash
# Regenerate all profiles with improved prompts
node generate-speaker-profiles.js --force

# Or regenerate specific speaker
node generate-speaker-profiles.js --speaker "Tim Pritlove" --force
```

See `SPEAKER-PROFILES.md` and `REGENERATE-PROFILES.md` for details.

## Technical Details

### Profile Loading Strategy
- Profiles loaded on-demand (per request)
- No caching (allows hot-reload during development)
- Fails gracefully if profile missing

### Character Safety
- Profiles describe "fictional characters inspired by speaking patterns"
- No direct impersonation claims
- Focused on linguistic style, not biographical facts
- LLM explicitly instructed this is roleplay

### Performance Considerations
- Speaker list cached in browser (`force-cache`)
- Profile markdown ~5-20KB per speaker
- Minimal impact on response time
- Most overhead is in LLM generation (same as neutral mode)

### Limitations
1. **Quality depends on profile detail**
   - Better profiles = more authentic voice
   - Requires substantial training data (>50k words recommended)

2. **LLM must stay factual**
   - Cannot invent information not in sources
   - Must cite sources even when in character
   - Style overlay doesn't reduce accuracy requirements

3. **Works best with longer profiles**
   - Speakers with <10k words may have generic profiles
   - Main speakers (Tim, roddi, Ralf, etc.) have best results

## Future Enhancements

Potential improvements:

- [ ] **Profile preview**: Show speaker profile excerpt in UI
- [ ] **Style strength slider**: Control how strongly to apply persona
- [ ] **Multi-speaker conversations**: Simulate dialogue between speakers
- [ ] **Profile A/B testing**: Compare responses with/without persona
- [ ] **Custom personas**: Allow users to create custom style profiles
- [ ] **Voice sample links**: Link to actual episode clips showing speaker style

## Troubleshooting

### Speakers list not loading
- Check backend is running and accessible
- Verify `speakers/index.json` exists and is valid JSON
- Check browser console for CORS errors

### Selected speaker not affecting output
- Ensure profile file exists: `speakers/{slug}.md`
- Check backend logs for profile loading errors
- Verify LLM is receiving the profile (add debug logging)

### Responses not "in character" enough
- Regenerate profile with improved prompts
- Increase chunk count: `--max-chunks 12`
- Ensure sufficient training data (check word count)
- Try different LLM model (some better at roleplay)

### Performance issues
- Speaker list should be cached automatically
- Profile loading is per-request (consider caching in AppState)
- If slow, check profile file size (should be <50KB)

## API Reference

### GET `/api/speakers`

Returns list of available speaker profiles.

**Response:**
```typescript
{
  speakers: Array<{
    speaker: string;      // Display name
    slug: string;         // URL-safe identifier
    episodesCount: number;
    utterancesCount: number;
    totalWords: number;
  }>
}
```

### POST `/api/chat`

Submit a query with optional speaker persona.

**Request:**
```typescript
{
  query: string;          // User's question
  topK?: number;          // Number of sources (default: 6)
  speakerSlug?: string;   // Speaker persona (default: null = neutral)
}
```

**Response:**
```typescript
{
  answer: string;         // LLM's answer (in selected style)
  sources: Array<{
    episodeNumber: number;
    episodeTitle?: string;
    startSec: number;
    endSec: number;
    startHms?: string;
    endHms?: string;
    score: number;
    topic?: string;
    subjectCoarse?: string;
    subjectFine?: string;
    excerpt: string;
  }>
}
```

## Examples

### Neutral Answer
```
System: Standard RAG assistant
Answer: In Episode 280 wird über verschiedene KI-Modelle diskutiert,
insbesondere GPT-4 und Claude. Die Gesprächspartner vergleichen die
Leistung bei Code-Generierung (Episode 280, 1:23:45-1:25:12).
```

### Tim Pritlove Persona
```
System: Roleplaying as Tim Pritlove
Answer: Also, KI-Modelle, da haben wir ja ausführlich drüber gequatscht.
GPT-4 und Claude, und ich muss sagen, bei Code ist Claude echt stark
geworden. Das war so um Episode 280, Minute 83 rum (Episode 280, 1:23:45-1:25:12).
Mega interessant, wie sich das entwickelt hat.
```

### Ralf Stockmann Persona
```
System: Roleplaying as Ralf Stockmann
Answer: Wir haben da verschiedene KI-Systeme verglichen. GPT-4 natürlich,
und Claude hat sich da sehr gut gemacht, gerade beim Code-Schreiben.
Das war in Episode 280, etwa bei Minute 83 (Episode 280, 1:23:45-1:25:12).
```

---

**Note:** This feature is experimental and depends heavily on the quality of generated speaker profiles. For best results, ensure profiles are detailed and based on substantial transcript data.

