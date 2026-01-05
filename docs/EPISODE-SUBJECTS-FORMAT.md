# Episode Subjects Data Format

## Overview

The `<episode-number>-subjects.json` file contains subject distribution data for a single episode, designed for:
- **Radar chart visualization**: Shows the relative coverage of each top subject in the episode
- **Subject timeline**: Chronological sequence of subjects with topic references

## File Format

```json
{
  "episodeNumber": 123,
  "title": "FS123 Schland unter",
  "generatedAt": "2026-01-05T12:00:00.000Z",
  "dataSource": "extended-topics",
  
  "radarChart": {
    "values": {
      "Technology": 0.45,
      "Culture": 0.15,
      "Finance": 0.10,
      "Events": 0.05,
      "Software": 0.0,
      "Hardware": 0.0,
      "...": 0.0
    },
    "durations": {
      "Technology": 3600,
      "Culture": 1200,
      "Finance": 800,
      "Events": 400,
      "Software": 0,
      "Hardware": 0,
      "...": 0
    },
    "topicCounts": {
      "Technology": 5,
      "Culture": 1,
      "Finance": 1,
      "Events": 1,
      "Software": 0,
      "Hardware": 0,
      "...": 0
    },
    "totalDurationSec": 8000,
    "totalTopics": 12
  },
  
  "timeline": [
    {
      "subject": "Culture",
      "startSec": 970,
      "endSec": 1766,
      "durationSec": 796,
      "topic": "Schland unter",
      "fineSubject": "Germany",
      "topicIndex": 0
    },
    {
      "subject": "Technology",
      "startSec": 1766,
      "endSec": 3553,
      "durationSec": 1787,
      "topic": "Layer-8-Probleme",
      "fineSubject": "Networking",
      "topicIndex": 1
    },
    {
      "subject": "Technology",
      "startSec": 7165,
      "endSec": 8532,
      "durationSec": 1367,
      "topic": "Rechnerbau und ZFS",
      "fineSubject": "Hardware",
      "topicIndex": 5
    },
    {
      "subject": "Technology",
      "startSec": null,
      "endSec": null,
      "durationSec": null,
      "topic": "Some topic without timing",
      "fineSubject": "Apple",
      "topicIndex": 8,
      "untimed": true
    }
  ]
}
```

## Field Descriptions

### Root Level

- `episodeNumber` (number): Episode number
- `title` (string|null): Episode title
- `generatedAt` (string): ISO 8601 timestamp when the file was generated
- `dataSource` (string): Source of topics data (`"topics"` or `"extended-topics"`)

### `radarChart` Object

Contains data for radar chart visualization:

- `values` (object): Normalized values (0-1) for each top subject, representing relative coverage
  - Keys: Top subject names (from `coarse-subjects.json`)
  - Values: Float between 0 and 1
  - Calculation: Duration-based if timing data available, otherwise topic-count-based
  
- `durations` (object): Raw duration in seconds for each subject
  - Keys: Top subject names
  - Values: Total seconds spent on this subject (sum of all topic durations)
  
- `topicCounts` (object): Number of topics per subject
  - Keys: Top subject names
  - Values: Integer count of topics
  
- `totalDurationSec` (number): Total duration of all timed topics in seconds
- `totalTopics` (number): Total number of topics in the episode

### `timeline` Array

Chronological sequence of subject appearances in the episode:

Each entry contains:
- `subject` (string): Top subject name (mapped via `coarse-subjects.json`)
- `startSec` (number|null): Start time in seconds (from episode start)
- `endSec` (number|null): End time in seconds
- `durationSec` (number|null): Duration in seconds (`endSec - startSec`)
- `topic` (string): Topic text
- `fineSubject` (string|null): Fine-grained subject (from `topic.subject.fine`)
- `topicIndex` (number): Index of the topic in the original topics array
- `untimed` (boolean, optional): Present if `true`, indicates topic has no timing data

**Timeline Sorting:**
- Entries are sorted by `startSec` (ascending)
- Entries with `startSec === null` are placed at the end
- Entries with the same `startSec` maintain their original order

## Subject Mapping

Subjects are mapped to top subjects using the `coarse-subjects.json` file:
1. If a subject is already a top subject, it's used directly
2. Otherwise, the `subjectMapping` is consulted
3. If mapped to a top subject, that mapping is used
4. If not mapped (or mapped to `null`), the topic is excluded from radar chart and timeline

## Data Sources Priority

The script prioritizes data sources in this order:
1. `-extended-topics.json` (preferred, has summaries and timing)
2. `-topics.json` (fallback)

For timing information:
1. `positionSec`/`durationSec` from `-topics.json` (highest priority)
2. `summaryMeta.startSec`/`endSec` from `-extended-topics.json`
3. `null` if no timing available

## Usage

### Generate for single episode:
```bash
node scripts/generate-episode-subjects.js --podcast freakshow --episode 123
```

### Generate for all episodes:
```bash
node scripts/generate-episode-subjects.js --podcast freakshow --all
```

### Generate for range:
```bash
node scripts/generate-episode-subjects.js --podcast freakshow --from 100 --to 200
```

### Overwrite existing files:
```bash
node scripts/generate-episode-subjects.js --podcast freakshow --all --overwrite
```

## Visualization Use Cases

### Radar Chart
- Use `radarChart.values` for normalized visualization (0-1 scale)
- Each axis represents a top subject
- Values show relative coverage/duration

### Timeline Visualization
- Use `timeline` array to show subject progression over episode duration
- Can visualize as:
  - Horizontal timeline bars
  - Stacked area chart
  - Gantt-style chart
- `topicIndex` allows linking back to original topic data

### Statistics
- `radarChart.topicCounts`: Show which subjects have most topics
- `radarChart.durations`: Show which subjects take most time
- `radarChart.totalDurationSec`: Episode length (timed portion)

