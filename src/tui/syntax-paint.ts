// OpenTUI StyledText emitter for a single `TokenLine` from
// `core/syntax-highlight.ts`. Builds one `TextChunk` per token chunk —
// `fg(color)(text)` composed through `bold(...)` / `italic(...)` /
// `underline(...)` from `@opentui/core` when the chunk's attributes are
// set — wrapped in a `StyledText`. Surface-symmetric with the webapp's
// `paintHtml` emitter that consumes the same `TokenLine`.

import { StyledText, bold, fg, italic, underline, type TextChunk } from "@opentui/core";
import type { TokenLine } from "../core/syntax-highlight.js";

export function paintStyledText(line: TokenLine): StyledText {
  const chunks: TextChunk[] = new Array(line.chunks.length);
  for (let i = 0; i < line.chunks.length; i++) {
    const c = line.chunks[i]!;
    let chunk: TextChunk;
    if (c.color) {
      chunk = fg(c.color)(c.text);
    } else {
      // Plain chunk — wrap text in a TextChunk via fg(...) on a sentinel
      // colour would force a paint; instead emit a TextChunk directly.
      chunk = { __isChunk: true, text: c.text };
    }
    if (c.bold) chunk = bold(chunk);
    if (c.italic) chunk = italic(chunk);
    if (c.underline) chunk = underline(chunk);
    chunks[i] = chunk;
  }
  return new StyledText(chunks);
}
