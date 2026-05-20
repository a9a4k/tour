import type { Comment } from "../core/types.js";
import type { Cursor } from "../core/cursor-state.js";
import type { ComposerTarget } from "../core/tour-session.js";

/**
 * Seed a top-level ComposerTarget from a row cursor (PRD #192 / ADR 0022).
 * `a` annotates exactly the cursor's line. The unified-cursor keymap
 * already gates `a` to a row cursor (cards reject `a` as a no-op with a
 * footer hint), so by the time this helper runs the cursor is either a
 * non-interactive row or null. Null falls back to the currentComment's
 * anchor so the degraded path still has a target on small Tours.
 */
export function buildTopLevelComposer(args: {
  cursor: Cursor | null;
  currentComment: Comment | null;
}): ComposerTarget | null {
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
  // Card cursor or null cursor: fall back to the currentComment's
  // anchor. The App-shell keymap already gates `a` on a card cursor to a
  // labelled no-op via footer hint; this fallback covers degraded direct-
  // call paths and the empty-Tour / null-cursor case.
  const a = args.currentComment;
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

/**
 * Seed a reply ComposerTarget from the cursor-focused parent Comment.
 * The target carries the parent's id (not the full Comment) so the
 * slice doesn't go stale when the bundle refreshes mid-composition —
 * surfaces resolve the live parent at submit time (PRD #234).
 */
export function buildReplyComposer(args: {
  currentComment: Comment | null;
}): ComposerTarget | null {
  if (!args.currentComment) return null;
  return {
    kind: "reply",
    thread_id: args.currentComment.thread_id ?? args.currentComment.id,
  };
}
