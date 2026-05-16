// HTML emitter for a single `TokenLine` from `core/syntax-highlight.ts`.
//
// Inline-styled `<span>` runs — matches the existing webapp output the row
// renderer paints with `dangerouslySetInnerHTML`. The font-style attributes
// (italic / bold / underline) are emitted only when present on the chunk so
// the markup stays compact for the common code-token case.

import type { TokenLine } from "../../core/syntax-highlight.js";

export function paintHtml(line: TokenLine): string {
  let html = "";
  for (const chunk of line.chunks) {
    const text = escapeHtml(chunk.text);
    const style = buildStyle(chunk);
    html += style ? `<span style="${style}">${text}</span>` : `<span>${text}</span>`;
  }
  return html;
}

function buildStyle(chunk: TokenLine["chunks"][number]): string {
  let s = "";
  if (chunk.color) s += `color:${chunk.color}`;
  if (chunk.bold) s += `${s ? ";" : ""}font-weight:bold`;
  if (chunk.italic) s += `${s ? ";" : ""}font-style:italic`;
  if (chunk.underline) s += `${s ? ";" : ""}text-decoration:underline`;
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
