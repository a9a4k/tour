import type { Annotation } from "../core/types.js";

/**
 * Bounds-checked index step for explicit user-driven annotation nav in
 * the TUI (`n` / `p` keypresses). Returns the target Annotation, or
 * null when the move is a no-op — `currentIdx` is -1 (no current
 * annotation), the list is empty, or we are already at the boundary in
 * the requested direction. The caller leaves all state intact on null.
 *
 * The full explicit-jump contract — drop sidebar focus (issue #132) and
 * materialize the line cursor at the target's anchor (ADR 0011 / 0012
 * β-coupling) — is applied by `jumpToAnnotation` in app.tsx, which is
 * the single entry point for n/p explicit jumps. The tour-open seed
 * effect bypasses both this helper and `jumpToAnnotation` (updating
 * `currentAnnotationId` / `selectedRowIdx` / `collapsedFolders`
 * directly), but applies the same `sidebarFocused = false` when the
 * tour has annotations — tour-open is itself an explicit user action
 * (issue #132 revision). Empty tours keep `sidebarFocused = true`.
 */
export function explicitAnnotationJump(args: {
  topLevel: ReadonlyArray<Annotation>;
  currentIdx: number;
  delta: -1 | 1;
}): Annotation | null {
  if (args.currentIdx === -1) return null;
  const last = args.topLevel.length - 1;
  if (last < 0) return null;
  const newIdx = Math.max(0, Math.min(last, args.currentIdx + args.delta));
  if (newIdx === args.currentIdx) return null;
  return args.topLevel[newIdx];
}
