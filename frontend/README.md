# Freak Show Topic River Visualisierung

Ein interaktives Topic River Diagramm, das die Themenentwicklung des Freak Show Podcasts über die Jahre visualisiert.

## Technologien

- **Vue.js 3** - Progressive JavaScript Framework
- **TypeScript** - Typsicheres JavaScript
- **Vite** - Schneller Build-Tool
- **Tailwind CSS 4** - Utility-First CSS Framework
- **D3.js** - Datenvisualisierung

## Installation

```bash
npm install
```

## Entwicklung

```bash
npm run dev
```

Der Development-Server startet unter `http://localhost:5173`

## Build

```bash
npm run build
```

## Features

- **Interaktives Topic River Diagramm**: Zeigt die Entwicklung von Topics über die Jahre als Stream-Graph
- **Hover-Effekte**: Hebt einzelne Topics beim Hovern hervor
- **Auswählbare Topics**: Klicke auf Topics für detaillierte Informationen
- **Anpassbare Anzahl**: Passe die Anzahl der angezeigten Topics mit einem Slider an
- **Responsive Design**: Passt sich verschiedenen Bildschirmgrößen an
- **Schöne Farbpalette**: Verwendet D3's Tableau-10 Farbschema

## Datenstruktur

Das Diagramm liest die `topic-river-data.json` aus dem public-Ordner, die Topic-Daten nach Jahren aggregiert enthält.
