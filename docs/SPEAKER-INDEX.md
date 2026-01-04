# Speaker Index System

This document describes the speaker index system that reduces 404 requests and enables CDN support for speaker images.

## Overview

The speaker index system:
1. **Generates `index-meta.json` files** listing all available speaker meta files per podcast
2. **Downloads and caches speaker images** locally
3. **Updates meta.json files** to reference local images
4. **Reduces 404 requests** by checking the index before loading speaker metadata

**Note**: `index-meta.json` is separate from `index.json` which contains speaker statistics (episodesCount, utterancesCount, etc.) used by the backend.

## Script: `generate-speaker-index.js`

### Usage

```bash
# Generate index for a specific podcast
npm run speaker-index -- --podcast freakshow

# Generate index for all podcasts
npm run speaker-index -- --all
```

### What It Does

1. **Scans speaker meta files**: Reads all `*-meta.json` files in `frontend/public/podcasts/<podcast-id>/speakers/`

2. **Downloads images**: 
   - Downloads images from external URLs (e.g., `https://freakshow.fm/...`)
   - Saves them as `<slug>.jpg` (or appropriate extension) in the same directory
   - Handles redirects and various image formats

3. **Updates meta.json files**:
   - Changes `image` field from external URL to local filename
   - Example: `"image": "https://freakshow.fm/..."` → `"image": "tim-pritlove.jpg"`

4. **Generates index-meta.json**:
   ```json
   {
     "generatedAt": "2025-01-02T12:00:00.000Z",
     "podcastId": "freakshow",
     "count": 10,
     "speakers": [
       {
         "slug": "tim-pritlove",
         "name": "Tim Pritlove",
         "hasImage": true,
         "imageFile": "tim-pritlove.jpg"
       },
       ...
     ]
   }
   ```
   
   **Note**: This file is named `index-meta.json` to avoid conflicts with `index.json` which contains speaker statistics used by the backend.

## Frontend Integration

### Using the Speaker Meta Composable

The `useSpeakerMeta` composable provides a clean API for loading speaker metadata with index support:

```typescript
import { useSpeakerMeta } from '@/composables/useSpeakerMeta';

const { loadSpeakers, getSpeakerImage, getSpeakerMeta } = useSpeakerMeta();

// Load metadata for multiple speakers
await loadSpeakers(['Tim Pritlove', 'Ralf Stockmann']);

// Get image URL (handles CDN automatically)
const imageUrl = getSpeakerImage('Tim Pritlove');

// Get full metadata
const meta = getSpeakerMeta('Tim Pritlove');
```

### Benefits

1. **Reduced 404 Requests**: 
   - Index is checked first before making requests
   - Non-existent speakers are skipped automatically

2. **CDN Support**:
   - Images are served from CDN when `VITE_CDN_BASE_URL` is set
   - Falls back to local paths when CDN is not configured

3. **Caching**:
   - Global cache shared across components
   - Index is loaded once and reused

4. **Image URL Resolution**:
   - Automatically resolves local image filenames to CDN URLs
   - Handles external URLs (keeps them as-is)

## Migration Guide

### Before (Old Pattern)

```typescript
// In component
const speakersMeta = ref<Map<string, SpeakerMeta>>(new Map());

function speakerNameToSlug(name: string): string {
  return name.toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

const loadSpeakerMeta = async (speakerName: string) => {
  const slug = speakerNameToSlug(speakerName);
  const url = getSpeakerMetaUrl(slug);
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) return;
  const data = await res.json();
  speakersMeta.value.set(speakerName, {
    name: data.name,
    slug: data.slug || slug,
    image: data.image || undefined,
  });
};
```

### After (New Pattern)

```typescript
// In component
import { useSpeakerMeta } from '@/composables/useSpeakerMeta';

const { loadSpeakers, getSpeakerImage, speakersMeta } = useSpeakerMeta();

// Load all speakers at once
await loadSpeakers(speakerNames);

// Use image URL (automatically handles CDN)
const imageUrl = getSpeakerImage(speakerName);
```

## File Structure

```
frontend/public/podcasts/<podcast-id>/speakers/
├── index.json                    # Speaker statistics (backend, not overwritten)
├── index-meta.json              # Generated meta index file (frontend)
├── tim-pritlove-meta.json       # Speaker metadata
├── tim-pritlove.jpg             # Cached image
├── ralf-stockmann-meta.json
├── ralf-stockmann.jpg
└── ...
```

## Workflow

1. **After scraping speakers**:
   ```bash
   npm run scrape-speakers -- --podcast freakshow
   ```

2. **Generate index and cache images**:
   ```bash
   npm run speaker-index -- --podcast freakshow
   ```

3. **Deploy to GitHub Pages** (if using CDN):
   - Images and index.json are automatically deployed
   - Frontend uses CDN URLs when `VITE_CDN_BASE_URL` is set

## Image Format Support

The script automatically detects and handles:
- `.jpg` / `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.svg`

Default format is `.jpg` if extension cannot be determined.

## Error Handling

- **Failed downloads**: Logged but don't stop processing
- **Missing images**: Speaker is still added to index with `hasImage: false`
- **Invalid meta files**: Skipped with warning

## Performance

- **Parallel downloads**: Multiple images downloaded simultaneously
- **Skip existing**: Already downloaded images are skipped
- **Index caching**: Index is loaded once and cached globally

