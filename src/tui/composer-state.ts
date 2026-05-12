import type { Annotation } from "../core/types.js";
import type { Cursor } from "../core/cursor-state.js";

export type ComposerState =
  | { kind: "top-level"; file: string; side: "additions" | "deletions"; line_start: number; line_end: number }
  | { kind: "reply"; parent: Annotation };

/**
 * Seed the top-level composer from a row cursor (PRD #192 / ADR 0022).
 * `a` annotates exactly the cursor's line. The unified-cursor keymap
 * already gates `a` to a row cursor (cards reject `a` as a no-op with a
 * footer hint), so by the time this helper runs the cursor is either a
 * non-interactive row or null. Null falls back to the currentAnnotation's
 * anchor so the degraded path still has a target on small Tours.
 */
export function buildTopLevelComposer(args: {
  cursor: Cursor | null;
  currentAnnotation: Annotation | null;
}): ComposerState | null {
  // Interactive rows are not annotatable (PRD #107 US 9).
  if (args.cursor && args.cursor.kind === "row" && args.cursor.interactive) return null;
  if (args.cursor && args.cursor.kind === "row") {
    return {
      kind: "top-level",
      file: args.cursor.file,
      side: args.cursor.side,
      line_start: args.cursor.lineNumber,
      line_end: args.cursor.lineNumber,
    };
  }
  // Card cursor or null cursor: fall back to the currentAnnotation's
  // anchor. The App-shell keymap already gates `a` on a card cursor to a
  // labelled no-op via footer hint; this fallback covers degraded direct-
  // call paths and the empty-Tour / null-cursor case.
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
