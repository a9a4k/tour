import type { Annotation } from "../core/types.js";
import type { Cursor } from "../core/cursor-state.js";

export type ComposerState =
  | { kind: "top-level"; file: string; side: "additions" | "deletions"; line_start: number; line_end: number }
  | { kind: "reply"; parent: Annotation };

/**
 * Seed the top-level composer. The line cursor wins when present (ADR
 * 0011) — `a` annotates exactly the cursor's line. When the cursor is
 * null (empty Tour, all files folded, snapshot lost) we fall back to the
 * currently-selected Annotation's anchor so the previous "annotate this
 * file's first agent note" UX still works in the degraded path. Both
 * null → null, and `a` becomes a silent no-op upstream.
 */
export function buildTopLevelComposer(args: {
  cursor: Cursor | null;
  currentAnnotation: Annotation | null;
}): ComposerState | null {
  if (args.cursor) {
    return {
      kind: "top-level",
      file: args.cursor.file,
      side: args.cursor.side,
      line_start: args.cursor.lineNumber,
      line_end: args.cursor.lineNumber,
    };
  }
  const a = args.currentAnnotation;
  if (a) {
    return {
      kind: "top-level",
      file: a.file,
      side: a.side,
      line_start: a.line_start,
      line_end: a.line_end,
    };
  }
  return null;
}

export function buildReplyComposer(args: {
  currentAnnotation: Annotation | null;
}): ComposerState | null {
  if (!args.currentAnnotation) return null;
  return { kind: "reply", parent: args.currentAnnotation };
}
