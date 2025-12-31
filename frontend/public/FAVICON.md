# Favicon Design

## Design Concept

The Freak Show AI favicon combines elements from the original Freak Show podcast with clear AI references:

### Visual Elements

1. **Background**: Indigo to purple gradient circle
   - Represents the AI/tech theme
   - Modern, distinct from the original red Freak Show logo

2. **"F" Letter**: Stylized white "F" on the left
   - References "Freak Show"
   - Maintains connection to the original podcast

3. **Neural Network**: Gold/amber nodes and connections on the right
   - Represents AI and machine learning
   - Visual metaphor for the clustering and analysis performed by the app

4. **"AI" Badge**: Small golden badge in the bottom right
   - Clear, explicit AI indicator
   - Makes it immediately distinguishable from the original podcast favicon

## Color Palette

- **Primary Gradient**: Indigo (#6366f1) to Purple (#8b5cf6)
- **Neural Network**: Gold (#fbbf24) to Amber (#f59e0b)
- **Accent**: White for the "F" letter
- **Border**: Dark Indigo (#4f46e5)

## Files

- `favicon.svg` - Vector source (recommended for modern browsers)
- `favicon-32x32.png` - Standard favicon size
- `favicon-192x192.png` - Android/Chrome size
- `favicon-180x180.png` - Apple touch icon size

## Regenerating PNGs

If you modify the SVG, regenerate the PNG versions:

```bash
npm run generate-favicon
```

This runs `scripts/generate-favicon-pngs.js` which automatically creates all three PNG sizes from the SVG source.

## Technical Details

- The SVG uses gradients for modern appearance
- PNG versions are generated using Sharp library
- All sizes are optimized for their respective use cases
- SVG is preferred by modern browsers for crisp rendering at any scale

