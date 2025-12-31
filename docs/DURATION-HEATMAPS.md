# Duration Heatmaps - Multi-View Implementation

## Übersicht

Der "Duration" Tab zeigt jetzt **drei verschiedene Heatmaps** in einem Tab-Interface:

1. **Wochentag × Dauer** - Verteilung der Episoden nach Wochentag und Dauer
2. **Jahr × Dauer** - Verteilung der Episoden nach Jahr und Dauer
3. **Sprecher × Dauer** - Verteilung der Episoden nach Sprecher und Dauer

## Daten-Generierung

### Neue Skripte

Drei Skripte generieren die benötigten JSON-Daten:

```bash
# Wochentag × Dauer (bereits vorhanden)
node scripts/generate-dayofweek-duration-heatmap.js

# Jahr × Dauer (neu)
node scripts/generate-year-duration-heatmap.js

# Sprecher × Dauer (neu)
node scripts/generate-speaker-duration-heatmap.js
```

### Generierte Dateien

- `frontend/public/dayofweek-duration-heatmap.json`
- `frontend/public/year-duration-heatmap.json`
- `frontend/public/speaker-duration-heatmap.json`

## Frontend-Implementierung

### Komponenten

**Neu:** `frontend/src/views/DurationHeatmapView.vue`
- Ersetzt die alte `DayOfWeekDurationHeatmapView.vue`
- Tab-basierte Navigation zwischen den drei Heatmaps
- Lazy Loading: Daten werden nur geladen wenn der Tab aktiviert wird
- Shared Code für alle drei Visualisierungen

### Router

**Geändert:** Route `/dayofweek-duration-heatmap` → `/duration-heatmap`

### Navigation

**Tab-Name geändert:** "Wochentag × Dauer" → "Duration"

## Features

- **Tab-Switching:** Einfacher Wechsel zwischen den drei Heatmap-Typen
- **Responsive Design:** Alle drei Heatmaps passen sich an die Bildschirmgröße an
- **Dark Mode Support:** Funktioniert im Dark Mode
- **Interaktive Zellen:** Click zum Anzeigen der Episode-Details
- **Lazy Loading:** Optimierte Performance durch verzögertes Laden

## Statistiken

### Wochentag × Dauer
- 7 Wochentage × 10 Dauer-Buckets
- 30-Minuten-Schritte (60min bis 330min)

### Jahr × Dauer
- 17 Jahre (2008-2025) × 10 Dauer-Buckets
- Zeigt Entwicklung der Episode-Längen über die Jahre

### Sprecher × Dauer
- 67 Sprecher × 10 Dauer-Buckets
- Sortiert nach Episode-Count (häufigste Sprecher oben)

## Verwendung

1. **Daten generieren:**
   ```bash
   node scripts/generate-year-duration-heatmap.js
   node scripts/generate-speaker-duration-heatmap.js
   ```

2. **Frontend bauen:**
   ```bash
   cd frontend
   npm run build
   ```

3. **Für Produktion:**
   ```bash
   cp frontend/public/*.json frontend/dist/
   ```

## Technische Details

- **Duration Buckets:** 30-Minuten-Schritte
- **Farb-Skala:** d3.interpolatePurples
- **Visualisierung:** D3.js SVG-basierte Heatmaps
- **Framework:** Vue 3 mit TypeScript
