import type { Annotation } from "../core/types.js";
import type { Cursor } from "../core/cursor-state.js";
import { cursorFromAnnotation } from "../core/cursor-state.js";

/**
 * Compute the state diff for an explicit user-driven annotation jump in
 * the TUI (`n` / `p` keypresses). Encodes two contracts:
 *
 * 1. Bounds + β-coupling (mirrors webapp `nextAnnotationNavStep`): when
 *    `currentIdx` is -1 (no current annotation) or already at the
 *    boundary in the requested direction, the move is a no-op and we
 *    return null; the caller leaves all state intact. Otherwise we
 *    return the target Annotation and the materialized line cursor at
 *    its anchor (ADR 0011 / ADR 0012 β-coupling).
 *
 * 2. Focus routing (issue #132): every explicit jump drops sidebar
 *    focus (`sidebarFocused: false`) so subsequent `j` / `k` move the
 *    diff cursor, not the file row. The user's visual attention is on
 *    the annotation in the diff — motion keys should follow. Idempotent:
 *    a jump from already-diff-focused state still reports `false`;
 *    `setSidebarFocused(false)` is a no-op then.
 *
 * Incidental jumps (the tour-open seed effect in app.tsx) do NOT use
 * this helper — that effect updates `currentAnnotationId` /
 * `selectedRowIdx` / `collapsedFolders` directly so `sidebarFocused`
 * keeps its default of `true` (the user just opened the app and is
 * orienting in the tree; focus-thrash on every tour load would be
 * jarring).
 */
export function explicitAnnotationJump(args: {
  topLevel: ReadonlyArray<Annotation>;
  currentIdx: number;
  delta: -1 | 1;
}): { target: Annotation; cursor: Cursor; sidebarFocused: false } | null {
  if (args.currentIdx === -1) return null;
  const last = args.topLevel.length - 1;
  if (last < 0) return null;
  const newIdx = Math.max(0, Math.min(last, args.currentIdx + args.delta));
  if (newIdx === args.currentIdx) return null;
  const target = args.topLevel[newIdx];
  return {
    target,
    cursor: cursorFromAnnotation(target),
    sidebarFocused: false,
  };
}
