# Quick Guide: Regenerating Speaker Profiles

## The speaker profiles have been improved!

The profile generation system now creates much more detailed and accurate profiles that capture:

- **Specific words and phrases** each speaker actually uses
- **Concrete speech patterns** with examples
- **Detailed humor style** with real examples from transcripts
- **Personality traits** visible in how they speak
- **Characteristic expressions** and recurring formulations

## How to Regenerate

### Regenerate ALL profiles with improved prompts

```bash
cd /Users/dominik/Projects/freakshow
node generate-speaker-profiles.js --force
```

This will:
- Clear the cache and regenerate all profiles
- Use the new, improved prompts
- Take longer but produce much better results
- Create detailed, specific profiles for each speaker

### Regenerate a single speaker (testing)

```bash
# Test with one speaker first
node generate-speaker-profiles.js --speaker "Tim Pritlove" --force
```

### Check what would be generated (dry run)

```bash
node generate-speaker-profiles.js --dry-run
```

## What Changed?

### Before (Generic):
```
### High-frequency words/phrases
- ja
- also
- genau
```

### After (Specific):
```
### High-frequency words/phrases
- "ja nee" (Satzanfang, ca. 20% der Antworten)
- "also ich mein" (zur Einleitung von Erklärungen)
- "das ist halt" (zur Rechtfertigung/Erklärung)
- "mega geil" (Begeisterung, ca. 5x pro Episode)
- "quasi" (als Approximations-Marker)
```

### Before (Vague):
```
## Humor & rhetorical devices
- ironisch und selbstironisch
- sarkastisch
```

### After (Concrete):
```
## Humor & rhetorical devices
- Übertreibung zur Betonung: "Das ist ja mal SO geil!"
- Selbstironie über eigene Technik-Obsession
- Trockene Kommentare mit ernster Stimme
- Wortspiele mit technischen Begriffen
- Beispiel: "Das ist jetzt nicht so prickelnd" (Understatement)
```

## Profile Quality Indicators

### Good Profile:
✅ Lists actual phrases the speaker uses
✅ Gives frequency/context info
✅ Includes verbatim examples
✅ Describes specific patterns
✅ Shows personality through speech

### Generic Profile:
❌ Just says "uses fillers"
❌ No concrete examples
❌ Vague descriptions
❌ Could apply to anyone

## Recommended Process

1. **Test first**: Regenerate one profile to see improvement
   ```bash
   node generate-speaker-profiles.js --speaker "Tim Pritlove" --force
   ```

2. **Review**: Check `speakers/tim-pritlove.md` - is it more specific?

3. **Regenerate all**: If satisfied, regenerate everything
   ```bash
   node generate-speaker-profiles.js --force
   ```

4. **Wait**: This will take a while (API calls for each chunk + final synthesis)
   - Rate limiting: 3 seconds between requests by default
   - Can adjust with `--delay-ms 1000` (faster, but might hit limits)

## Advanced Options

### More detail (larger chunks, more chunks):
```bash
node generate-speaker-profiles.js \
  --chunk-chars 20000 \
  --max-chunks 12 \
  --force
```

### Faster (but less detailed):
```bash
node generate-speaker-profiles.js \
  --chunk-chars 12000 \
  --max-chunks 4 \
  --delay-ms 1000 \
  --force
```

### Only main speakers:
```bash
node generate-speaker-profiles.js \
  --limit-speakers 5 \
  --force
```

## Expected Results

With the improved prompts, you should get profiles that:

1. List 20-30 specific high-frequency phrases
2. Describe concrete sentence patterns with examples
3. Detail humor style with real examples from transcripts
4. Show personality traits evident in speech
5. Include 10-15 characteristic verbatim quotes
6. Provide actionable imitation prompts

## Time Estimate

For each speaker:
- **Chunk analysis**: ~8 chunks × 3 seconds = ~24 seconds
- **Final synthesis**: 1 call × 3 seconds = ~3 seconds
- **Total per speaker**: ~30 seconds

For all speakers (assuming 10 speakers):
- **Total time**: ~5 minutes

(Actual time may vary based on API response times)

---

**Need help?** See `SPEAKER-PROFILES.md` for detailed documentation.

