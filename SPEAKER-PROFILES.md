# Speaker Profile Generation - Documentation

## Overview

The `generate-speaker-profiles.js` script analyzes podcast transcripts to create detailed speaker profiles that capture how each person speaks - their unique voice, word choices, speech patterns, humor style, and personality.

## Recent Improvements

### Enhanced Analysis Focus

The profile generation now focuses on:

1. **Concrete Word Choices & Phrases**
   - Actual words and expressions the speaker uses
   - Not just "uses technical terms" but specific examples
   - Characteristic phrases and recurring formulations

2. **Specific Speech Patterns**
   - Sentence structure and rhythm (short? nested? interrupted?)
   - Typical sentence patterns and constructions
   - Concrete examples of how they build sentences

3. **Detailed Humor Style**
   - Specific types: irony, wordplay, overstatement, dry humor
   - Concrete examples from the transcripts
   - Characteristic humor patterns

4. **Personality in Speech**
   - Attitude and values as expressed through speaking
   - Interaction patterns (asks questions? tells stories? interrupts?)
   - What they do and don't do conversationally

5. **Characteristic Expressions**
   - Filler words and discourse markers with frequency
   - Speech tics and recurring patterns
   - Code-switching behavior (if any)

### Updated Prompts

**Chunk Analysis Prompt** (improved):
- Emphasizes CONCRETE examples over generic descriptions
- Requests specific frequency information ("how often?")
- Focuses on extracting verbatim phrases
- Explicitly ignores topic content

**Final Synthesis Prompt** (improved):
- Demands VERY specific descriptions
- Collects most frequent/characteristic words across all chunks
- Requires concrete humor examples and patterns
- Identifies personality traits visible in speech
- Selects 10-15 most characteristic example quotes

### Improved Default Parameters

- **maxChunkChars**: Increased from 12,000 to 16,000 (more context per chunk)
- **maxChunks**: Set to 8 by default (was unlimited)
  - Ensures diverse sampling across episodes
  - Balances between coverage and API costs
- **maxTokens**: Increased from 1,200 to 2,500 (allows for more detailed responses)

## Usage

### Basic Usage

Generate profiles for all speakers:

```bash
node generate-speaker-profiles.js
```

### Generate Profile for Specific Speaker

```bash
node generate-speaker-profiles.js --speaker "Tim Pritlove"
```

### Force Regeneration

Clear cache and regenerate all profiles:

```bash
node generate-speaker-profiles.js --force
```

### Custom Parameters

```bash
node generate-speaker-profiles.js \
  --chunk-chars 20000 \
  --max-chunks 10 \
  --speaker "Tim Pritlove" \
  --force
```

### Process Multiple Speakers

```bash
# Top 3 speakers by word count
node generate-speaker-profiles.js --limit-speakers 3

# All speakers matching pattern
node generate-speaker-profiles.js --speaker-regex "tim|roddi"
```

## Profile Structure

Generated profiles include:

### Data Coverage
- Number of episodes
- Utterance count
- Approximate word count
- Confidence level

### Essence
- One-line summary of speaking style

### Style Fingerprint
- Quick overview of key characteristics

### Language & Register
- Primary language
- Formal vs. informal register

### Vocabulary
- **High-frequency words/phrases**: Most commonly used
- **Idiosyncratic lexicon**: Signature words/phrases unique to this speaker
- **Avoids/taboo**: Words/patterns the speaker doesn't use

### Syntax & Rhythm
- Sentence structure patterns
- Typical constructions
- Speech rhythm characteristics

### Discourse Markers
- Connecting words and phrases
- Conversational markers

### Humor & Rhetorical Devices
- Types of humor used
- Rhetorical techniques
- Concrete examples

### Attitude & Values
- How personality shows in speech
- Value signals in conversation

### Interaction Playbook
- **Does**: Typical conversational behaviors
- **Does not**: Patterns they avoid

### Tics
- Repeated phrases or sounds
- Speech habits

### Swearing/Profanity
- Frequency and style if present

### Code-Switching
- Language mixing patterns

### Example Lines
- 10-15 verbatim quotes showcasing their style

### Prompting Recipe
- System prompt for LLM imitation
- User instructions for mimicking this speaker

## Tips for Best Results

1. **More Data = Better Profiles**
   - Profiles improve significantly with more utterances
   - Minimum 800 words recommended
   - Best results with 50,000+ words

2. **Use Force Flag Wisely**
   - Profiles are cached for efficiency
   - Use `--force` after improving prompts
   - Otherwise, cache is used when available

3. **Tune Chunk Parameters**
   - Larger chunks (20,000+) for speakers with formal, structured speech
   - More chunks (12+) for highly variable speakers
   - Fewer chunks (4-6) for very consistent speakers

4. **Review and Iterate**
   - Check generated profiles for specificity
   - If too generic, increase chunk size or count
   - If inconsistent, ensure enough source data

## Technical Details

### Processing Pipeline

1. **Data Collection**
   - Reads all `*-ts.json` transcript files
   - Extracts speaker utterances
   - Counts episodes, utterances, words

2. **Chunk Creation**
   - Splits utterances into manageable chunks
   - Samples evenly across all episodes (if maxChunks set)
   - Maintains episode/timestamp context

3. **Chunk Analysis (LLM)**
   - Each chunk analyzed independently
   - Extracts style features, examples, patterns
   - Results cached per chunk

4. **Final Synthesis (LLM)**
   - Combines all chunk analyses
   - Creates comprehensive profile
   - Generates imitation prompts

5. **Markdown Generation**
   - Formats profile as readable documentation
   - Includes all extracted features
   - Adds metadata and timestamps

### Caching Strategy

- Chunk analyses cached individually by content hash
- Final profiles cached with full transcript hash
- Regenerated only if source data changed (unless `--force`)
- Cache stored in `speakers/.cache/`

### LLM Configuration

Uses `settings.json` for LLM configuration:

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4",
    "apiKey": "your-api-key",
    "baseURL": "https://api.openai.com/v1",
    "temperature": 0.3,
    "maxTokens": 2500
  },
  "topicExtraction": {
    "language": "de",
    "requestDelayMs": 3000,
    "maxRetries": 3,
    "retryDelayMs": 5000
  }
}
```

## Future Improvements

Potential enhancements:

- **Statistical Analysis**: Word frequency, n-gram analysis
- **Comparative Profiles**: How speakers differ from each other
- **Evolution Tracking**: How speaking style changes over time/episodes
- **Voice Cloning Optimization**: Fine-tune parameters for TTS systems
- **Multi-language Support**: Better handling of code-switching
- **Audio Features**: Integration with prosody/intonation data (if available)

## Examples

### Good Profile Indicators

✅ Specific phrases: "verwendet oft 'ja nee', 'ich mein', 'quasi'"
✅ Concrete patterns: "beginnt 40% der Sätze mit 'Also'"
✅ Clear examples: "Humor durch Übertreibung: 'Das ist ja mal mega geil!'"
✅ Personality visible: "unterbricht sich selbst häufig mit neuen Gedanken"

### Generic Profile Indicators (to avoid)

❌ Vague: "verwendet Füllwörter"
❌ No examples: "ist humorvoll"
❌ Too broad: "spricht technisch"
❌ No specifics: "interagiert mit Gesprächspartner"

---

*Generated profiles are stored in `speakers/*.md` with an index at `speakers/index.json`*

