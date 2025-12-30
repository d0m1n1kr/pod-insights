# Markdown-Rendering in der Suche

## Übersicht

Die Suchergebnisse werden jetzt als **Markdown** gerendert, was eine deutlich bessere Formatierung und Lesbarkeit ermöglicht. Dies ist besonders nützlich für den Diskussionsmodus, wo Dialoge zwischen zwei Sprechern stattfinden.

## Features

### ✅ Unterstützte Markdown-Syntax

- **Fettschrift**: `**Text**` → **Text**
- **Kursiv**: `*Text*` oder `_Text_` → *Text*
- **Überschriften**: `# H1`, `## H2`, `### H3`, etc.
- **Listen**: 
  - Ungeordnet: `- Item` oder `* Item`
  - Geordnet: `1. Item`, `2. Item`
- **Links**: `[Text](URL)`
- **Code**:
  - Inline: `` `code` `` → `code`
  - Block: ``` ```code``` ```
- **Zitate**: `> Zitat`
- **Trennlinien**: `---` oder `***`
- **Zeilenumbrüche**: Werden als `<br>` gerendert (GFM-Modus)

### 🎯 Spezielle Features

#### Episode-Links bleiben funktional

Episode-Referenzen wie `(Episode 297, 1:53:19)` werden automatisch in klickbare Links umgewandelt, die den Audio-Player öffnen:

```
Tim: Bitcoin Mining ist kompliziert (Episode 297, 1:53:19-1:54:13)
```

→ Die Episode-Referenz wird zu einem anklickbaren Link, der das Audio ab dieser Stelle abspielt.

#### Diskussionsmodus-Formatierung

Im Diskussionsmodus kann das LLM jetzt Markdown verwenden, um Dialoge besser zu strukturieren:

```markdown
**Tim**: Also, ich würde sagen...

**Roddi**: *Moment mal*, das sehe ich anders! 

1. Erstens...
2. Zweitens...
```

Wird gerendert als:

**Tim**: Also, ich würde sagen...

**Roddi**: *Moment mal*, das sehe ich anders! 

1. Erstens...
2. Zweitens...

## Technische Details

### Verwendete Bibliothek

- **marked** v14.1.3
- Parser für Markdown → HTML
- Unterstützt GitHub Flavored Markdown (GFM)

### Konfiguration

```typescript
marked.parse(text, { 
  breaks: true,  // Zeilenumbrüche als <br>
  gfm: true      // GitHub Flavored Markdown
})
```

### Styling

Das gerenderte Markdown verwendet **Tailwind Typography** (`@tailwindcss/typography`):

```html
<div class="prose prose-sm dark:prose-invert max-w-none ...">
  <!-- Markdown-HTML hier -->
</div>
```

**CSS-Klassen**:
- `prose`: Basis-Styling für typographische Elemente
- `prose-sm`: Kleinere Schriftgröße für kompaktere Darstellung
- `dark:prose-invert`: Dark-Mode-Unterstützung
- `max-w-none`: Keine Breiten-Beschränkung
- `prose-p:my-2`: Reduzierter Absatz-Abstand
- `prose-headings:mt-4 prose-headings:mb-2`: Kompaktere Überschriften

### Reihenfolge der Verarbeitung

1. **Markdown → HTML**: `marked.parse()` konvertiert Markdown zu HTML
2. **Episode-Links**: Regex ersetzt Episode-Referenzen mit klickbaren Links
3. **Rendering**: Vue rendert das HTML mit `v-html`
4. **Event-Handling**: Click-Handler auf Episode-Links für Audio-Player

## Implementierung

### Code-Änderungen

**SearchView.vue**:

```typescript
import { marked } from 'marked';

const renderMarkdownWithLinks = (text: string): string => {
  // 1. Markdown → HTML
  let html = marked.parse(text, { 
    breaks: true, 
    gfm: true 
  }) as string;
  
  // 2. Episode-Links hinzufügen
  const episodePattern = /\(Episode\s+(\d+),\s+([\d:]+)(?:-[\d:]+)?\)/gi;
  html = html.replace(episodePattern, (match, episodeNum, startTime) => {
    // ... Link-Generierung
  });
  
  return html;
};
```

**Template**:

```vue
<div 
  class="prose prose-sm dark:prose-invert max-w-none ..."
  v-html="renderMarkdownWithLinks(result.answer)"
  @click="handleAnswerClick"
>
</div>
```

## Sicherheit

### XSS-Schutz

- `marked` escaped HTML-Tags automatisch
- Episode-Links werden manuell mit bekannten, sicheren Attributen erstellt
- `v-html` ist sicher, da der Content vom Backend kommt (vertrauenswürdig)

### Content Security Policy (CSP)

Wenn CSP verwendet wird, beachte:
- `unsafe-inline` für inline-Styles (Tailwind)
- `unsafe-eval` nicht benötigt

## Best Practices für LLM-Prompts

Um das beste aus dem Markdown-Rendering herauszuholen, können LLM-Prompts angepasst werden:

```
- Format speaker names as **bold**
- Use *italics* for emphasis
- Structure complex answers with lists
- Use headings (##) for sections
- Add line breaks for better readability
```

## Beispiele

### Einfache Antwort mit Formatting

```markdown
Bitcoin Mining ist der Prozess, bei dem neue Bitcoins erstellt werden. 

**Wichtige Punkte:**
1. Proof-of-Work-Algorithmus
2. Hoher Energieverbrauch
3. Dezentralisierung

Mehr Details in (Episode 297, 1:53:19-1:54:13).
```

### Diskussions-Dialog

```markdown
**Tim**: Also, ich finde das *sehr* interessant...

**Roddi**: Moment! Das sehe ich **völlig anders**:

- Erstens...
- Zweitens...

**Tim**: Okay, aber bedenke auch...
```

## Migration von Plain Text

Die vorherige `linkifyAnswer()`-Funktion wurde ersetzt durch `renderMarkdownWithLinks()`:

**Vorher** (nur Plain Text):
```typescript
const linkifyAnswer = (text: string): string => {
  return text.replace(episodePattern, ...);
};
```

**Nachher** (Markdown + Links):
```typescript
const renderMarkdownWithLinks = (text: string): string => {
  let html = marked.parse(text, { breaks: true, gfm: true });
  return html.replace(episodePattern, ...);
};
```

## Abhängigkeiten

```json
{
  "dependencies": {
    "marked": "^14.1.3"
  },
  "devDependencies": {
    "@tailwindcss/typography": "^0.5.15"
  }
}
```

## Siehe auch

- [marked Documentation](https://marked.js.org/)
- [Tailwind Typography](https://tailwindcss.com/docs/typography-plugin)
- [DISCUSSION-MODE.md](./DISCUSSION-MODE.md) - Diskussionsmodus
- [SPEAKER-PERSONAS.md](./SPEAKER-PERSONAS.md) - Speaker-Personas

