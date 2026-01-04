# Unified Episode Table Loading

## Overview

All episode tables now use a unified `useEpisodeTable` composable that provides consistent, reliable loading behavior across all components.

## Features

1. **Immediate Priming**: All rows are primed immediately with `episodes.json` metadata, so tables are fully populated right away
2. **Background Batch Loading**: Full episode details are loaded in batches in the background (no scrolling required)
3. **Filter Change Handling**: Changing filters or switching selections automatically reloads episodes without losing fallback data
4. **Race Condition Prevention**: Request tokens prevent stale updates when filters change rapidly
5. **Fallback Preservation**: Never overwrites fallback data with null - missing episodes still show metadata from `episodes.json`

## Usage

```typescript
import { useEpisodeTable } from '@/composables/useEpisodeTable';

// In component setup
const { episodeDetails, loadingEpisodes, setupEpisodeTable } = useEpisodeTable();

// Load episodes when list changes
async function loadEpisodeDetails() {
  if (!selectedCell.value) return;
  await setupEpisodeTable(selectedCell.value.episodes);
}

// Watch for filter changes
watch(selectedCell, async () => {
  if (selectedCell.value && selectedCell.value.episodes.length > 0) {
    await loadEpisodeDetails();
  }
});

// Watch for list visibility
watch(showEpisodeList, async (newValue) => {
  if (newValue && selectedCell.value && selectedCell.value.episodes.length > 0) {
    await loadEpisodeDetails();
  }
});
```

## Components Using This

- ✅ `DurationHeatmapView.vue` - Migrated
- ⏳ `ClusterHeatmapView.vue` - To migrate
- ⏳ `ClusterClusterHeatmapView.vue` - To migrate  
- ⏳ `SpeakerSpeakerHeatmapView.vue` - To migrate
- ⏳ `SpeakerRiver.vue` - To migrate
- ⏳ `TopicRiver.vue` - To migrate

## Migration Steps

1. Replace imports:
   ```typescript
   // Old
   import { useLazyEpisodeDetails, type EpisodeDetail, loadEpisodeDetail, getCachedEpisodeDetail } from '@/composables/useEpisodeDetails';
   
   // New
   import { useEpisodeTable } from '@/composables/useEpisodeTable';
   ```

2. Replace state declarations:
   ```typescript
   // Old
   const episodeDetails = ref<Map<number, EpisodeDetail | null>>(new Map());
   const loadingEpisodes = ref(false);
   const observerCleanups = ref<Map<number, () => void>>(new Map());
   let episodeDetailsRequestId = 0;
   
   // New
   const { episodeDetails, loadingEpisodes, setupEpisodeTable } = useEpisodeTable();
   ```

3. Replace loading function:
   ```typescript
   // Old: Complex setupLazyLoadingForEpisodes function
   // New: Simple wrapper
   async function loadEpisodeDetails() {
     if (!selectedCell.value) return;
     await setupEpisodeTable(selectedCell.value.episodes);
   }
   ```

4. Add watchers for filter changes:
   ```typescript
   watch(selectedCell, async () => {
     if (selectedCell.value && selectedCell.value.episodes.length > 0) {
       await loadEpisodeDetails();
     }
   });
   
   watch(showEpisodeList, async (newValue) => {
     if (newValue && selectedCell.value && selectedCell.value.episodes.length > 0) {
       await loadEpisodeDetails();
     }
   });
   ```

5. Remove cleanup code (handled by composable):
   ```typescript
   // Remove this - composable handles it
   onUnmounted(() => {
     observerCleanups.value.forEach(cleanup => cleanup());
     observerCleanups.value.clear();
   });
   ```

## Benefits

- **Consistency**: All episode tables behave the same way
- **Reliability**: Handles filter changes, rapid switching, and edge cases
- **Performance**: Batch loading in background, no scrolling required
- **Maintainability**: Single source of truth for episode loading logic
- **User Experience**: Tables are always fully populated, even while loading

