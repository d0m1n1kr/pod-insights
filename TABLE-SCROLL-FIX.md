# Table Horizontal Scroll Fix

## Problem
Episode detail tables need to scroll horizontally on mobile, but ONLY the table should scroll, not the entire details panel (headers, buttons, text).

## Solution Structure

The correct nesting structure for scrollable tables:

```vue
<!-- Episode List Container (fixed width, no scroll) -->
<div v-if="showEpisodeList" class="mt-4 bg-white dark:bg-gray-900 rounded-lg border border-COLOR overflow-hidden">
  
  <!-- Loading State -->
  <div v-if="loadingEpisodes" class="p-4 text-center text-gray-600 dark:text-gray-400">
    Lade Episoden-Details...
  </div>
  
  <!-- Table Container - HORIZONTAL SCROLL WRAPPER -->
  <div v-else class="overflow-x-auto">
    
    <!-- VERTICAL SCROLL WRAPPER -->
    <div class="max-h-96 overflow-y-auto">
      
      <!-- TABLE with explicit min-width to force horizontal scroll -->
      <table class="text-sm" style="min-width: 800px;">
        <thead class="bg-COLOR sticky top-0">
          <tr>
            <th>...</th>
          </tr>
        </thead>
        <tbody>
          <tr>...</tr>
        </tbody>
      </table>
      
    </div><!-- Close vertical scroll -->
  </div><!-- Close horizontal scroll -->
</div><!-- Close container -->
```

## Key Points

1. **Outer Container** (`overflow-hidden`): Clips content and provides border/background
2. **Horizontal Scroll Wrapper** (`overflow-x-auto`): Enables left-right scrolling for wide tables
3. **Vertical Scroll Wrapper** (`max-h-96 overflow-y-auto`): Enables up-down scrolling for many rows
4. **Table** (`style="min-width: 800px"`): Forces a minimum width to ensure horizontal scrolling on mobile
   - Removed `w-full` class which was causing the table to compress to container width
   - Removed `min-w-max` which wasn't strong enough
   - Uses explicit inline style to guarantee the table is wide enough to require scrolling on mobile devices

## Files Updated

All episode tables have been updated with this structure:

### Views
- ✅ `HeatmapView.vue` (Speaker-Category)
- ✅ `ClusterHeatmapView.vue` (Speaker-Cluster)
- ✅ `SpeakerSpeakerHeatmapView.vue` (Speaker-Speaker)
- ✅ `ClusterClusterHeatmapView.vue` (Cluster-Cluster)
- ✅ `DurationHeatmapView.vue` (Duration analysis)

### Components
- ✅ `TopicRiver.vue` (Episode list in topic details)
- ✅ `SpeakerRiver.vue` (Episode list in speaker details)

## CSS Support

Added in `style.css`:

```css
@media (max-width: 639px) {
  /* Ensure table scroll containers work properly */
  .overflow-x-auto {
    -webkit-overflow-scrolling: touch;
    width: 100%;
  }
}
```

## Testing Checklist

On mobile device or browser dev tools (< 640px width):

1. ✅ Headers and buttons should NOT scroll horizontally
2. ✅ Only the table area scrolls left/right
3. ✅ All 6 columns visible when scrolling (Episode #, Date, Title, Duration, Speakers, Link)
4. ✅ Vertical scroll works independently when many episodes
5. ✅ Table headers stay sticky when scrolling vertically
6. ✅ Smooth touch scrolling on iOS devices

## Common Issues

### Issue: Entire panel scrolls
**Cause**: `overflow-x-auto` is on outer container instead of table wrapper
**Fix**: Move `overflow-x-auto` to the div directly wrapping the table

### Issue: Table doesn't scroll
**Cause**: Table using `w-full` class which makes it fit container width instead of expanding
**Fix**: Remove `w-full` and use explicit `style="min-width: 800px"` to force horizontal scroll

### Issue: Content compressed
**Cause**: `min-w-max` class not strong enough to prevent compression
**Fix**: Use inline style with explicit pixel width: `style="min-width: 800px"`

