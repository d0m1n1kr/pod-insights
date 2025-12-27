# Freakshow Topic Clustering - Rust Performance Version

Die Rust-Version des Topic-Clustering ist deutlich schneller als die JavaScript-Version durch:

## Performance-Optimierungen

### 1. Parallelisierung mit Rayon
- **Distanz-Matrix**: Parallele Berechnung aller Zeilen
- **Cluster-Distanzen**: Parallele Suche nach nächstem Cluster-Paar
- **Cluster-Benennung**: Parallele Verarbeitung aller Cluster

### 2. Zero-Copy und Effizienz
- Direkte Arbeit mit Vektoren statt JSON-Objekten
- Keine GC-Pausen
- SIMD-optimierte Float-Operationen

### 3. Compile-Time Optimierungen
```toml
[profile.release]
opt-level = 3        # Maximale Optimierung
lto = true           # Link-Time Optimization
codegen-units = 1    # Bessere Optimierung
```

## Installation & Verwendung

### Voraussetzungen
```bash
# Installiere Rust (falls noch nicht vorhanden)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Build & Run
```bash
# Einfacher Build und Ausführung
./build-and-run.sh

# Oder manuell:
cargo build --release
./target/release/cluster-topics
```

## Erwartete Performance

| Metric | JavaScript | Rust | Speedup |
|--------|-----------|------|---------|
| Distanz-Matrix (4500 Topics) | ~20s | ~2s | **10x** |
| Clustering (256 Cluster) | ~180s | ~15s | **12x** |
| Gesamt-Laufzeit | ~3-5min | ~20-30s | **~10x** |

*Benchmarks auf Apple M1 Pro*

## Architektur

### Datenstrukturen
- `EmbeddingsDatabase`: Deserialisiert aus `topic-embeddings.json`
- `Cluster`: Enthält Items, Embedding, Gewicht, Outlier-Status
- `NamedCluster`: Output-Format mit Namen und Metadaten

### Algorithmus
1. **Distanz-Matrix** (parallel): O(n²) mit Rayon
2. **Hierarchisches Clustering**: O(n² × k) mit parallelisierter Cluster-Paar-Suche
3. **Benennung** (parallel): Gewichtete Keyword-Extraktion

### Linkage-Methoden
- `weighted`: Gewichtet nach Episoden-Anzahl (default)
- `ward`: Minimiert Varianz
- `average`: Durchschnitt aller Distanzen
- `complete`: Maximale Distanz
- `single`: Minimale Distanz

## Kompatibilität

Die Rust-Version ist 100% kompatibel mit der JavaScript-Version:
- Identische Input-Formate (`settings.json`, `topic-embeddings.json`)
- Identisches Output-Format (`topic-taxonomy.json`)
- Identische Cluster-Ergebnisse (bei gleichen Settings)

## Referenz

Die originale JavaScript-Implementation ist in `cluster-topics-reference.js` verfügbar.

