# Speaker Personas - Quick Start

## What's New?

The search feature now supports **speaker personas** - answers can be delivered in the voice and style of different podcast speakers!

## How to Use

1. **Start the backend:**
   ```bash
   cargo run --release --bin rag_backend
   ```

2. **Open the frontend** and go to the Search tab

3. **Select a speaker** from the "Answer Style" dropdown:
   - **Neutral (Standard)**: Objective, factual answers (default)
   - **Tim Pritlove**: Answers in Tim's casual, enthusiastic style
   - **roddi**: Answers in roddi's style
   - **Ralf Stockmann**: Answers in Ralf's style
   - *(Other speakers as available)*

4. **Ask your question** and get an answer in the selected style!

## Example

### Question
> "Was wurde über Starlink diskutiert?"

### Neutral Answer
> In Episode 280 wird Starlink als Satelliten-Internet-Dienst von SpaceX erwähnt...

### Tim Pritlove Persona Answer
> Also, Starlink ist ja schon ziemlich geil, muss ich sagen. Das haben wir so um Minute 45 durchgekaut (Episode 280, 45:12-47:38)...

## Requirements

- ✅ Speaker profiles must exist in `speakers/` directory
- ✅ Backend must be running
- ✅ LLM API must be configured in `settings.json`

## Regenerate Profiles

For better speaker personas, regenerate profiles with improved prompts:

```bash
node scripts/generate-speaker-profiles.js --force
```

This will create detailed profiles capturing each speaker's:
- Vocabulary and phrases
- Speech patterns and rhythm  
- Humor style
- Attitude and personality
- Characteristic expressions

## Technical Changes

### Backend (Rust)
- ✅ New `/api/speakers` endpoint listing available profiles
- ✅ Extended `/api/chat` to accept `speakerSlug` parameter
- ✅ Profile loading from `speakers/{slug}.md`
- ✅ Modified LLM prompts to include speaker profile

### Frontend (Vue)
- ✅ Speaker dropdown in search interface
- ✅ Fetches speakers list on mount
- ✅ Passes selected speaker to API
- ✅ Shows context when speaker selected

## Files Changed

- `src/rag_backend.rs` - Backend implementation
- `frontend/src/views/SearchView.vue` - Frontend UI
- `SPEAKER-PERSONAS.md` - Detailed documentation
- `SPEAKER-PROFILES.md` - Profile generation docs

## Testing

1. Test neutral mode (no speaker selected)
2. Test with different speakers
3. Verify answers maintain factual accuracy while adopting style
4. Check citations are still included

## Troubleshooting

**Speakers not loading?**
- Ensure `speakers/index.json` exists
- Check backend is running
- Look at browser console for errors

**Responses not in character?**
- Regenerate profiles with `--force`
- Check profile quality (needs >50k words)
- Try main speakers first (Tim, roddi, Ralf)

## Documentation

- Full docs: `SPEAKER-PERSONAS.md`
- Profile generation: `SPEAKER-PROFILES.md`
- Profile regeneration: `REGENERATE-PROFILES.md`

---

Enjoy conversing with your favorite podcast speakers! 🎙️

