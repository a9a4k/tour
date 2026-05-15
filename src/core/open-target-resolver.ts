// Cursor → open-target resolver (PRD #349 / ADR 0032 / issue #352).
// Slice 1 covers the row-cursor case only — every other cursor shape
// returns null and the caller surfaces a placeholder footer hint. Full
// permissive resolution (card → annotation `line_end`, sidebar file →
// line 1) lands in #351.

import type { Cursor } from "./cursor-state.js";

export interface OpenTarget {
  file: string;
  line: number;
}

export function resolveOpenTarget(cursor: Cursor | null): OpenTarget | null {
  if (!cursor) return null;
  if (cursor.kind !== "row") return null;
  if (cursor.interactive) return null;
  return { file: cursor.file, line: cursor.lineNumber };
}
