import type { DiffFile, DiffHunk } from "./diff-model.js";
import type { Comment } from "./types.js";
import type { BoundaryRef, OrphanWindow } from "./expansion-state.js";

export interface HunkExpansionRegion {
  fromStart: number;
  fromEnd: number;
}

export interface OrphanWindowOptions {
  oldLineCount: number;
  newLineCount: number;
}

const WINDOW_RADIUS = 10;

/**
 * Pierre's `expandedHunks` keys gaps by the hunk that follows them — the
 * gap before hunk i has key i; the trailing gap after the last hunk has
 * key hunks.length. fromStart counts lines exposed from the top of the
 * gap (closer to the previous hunk's end), fromEnd from the bottom
 * (closer to the next hunk's start). Both are gap-relative counts, so
 * they apply identically to the additions and deletions columns Pierre
 * renders side-by-side over the symmetric unchanged region.
 */
export function computeOrphanWindows(
  file: DiffFile,
  comments: Comment[],
  opts: OrphanWindowOptions,
): Map<number, HunkExpansionRegion> {
  const spans = new Map<number, OrphanSpan>();

  for (const comment of comments) {
    if (comment.file !== file.name) continue;
    const span = orphanSpanFor(file, comment, opts);
    if (!span) continue;
    const prev = spans.get(span.hunkIndex);
    if (!prev) {
      spans.set(span.hunkIndex, span);
      continue;
    }
    spans.set(span.hunkIndex, {
      ...prev,
      startOffset: Math.min(prev.startOffset, span.startOffset),
      endOffset: Math.max(prev.endOffset, span.endOffset),
    });
  }

  const result = new Map<number, HunkExpansionRegion>();
  for (const span of spans.values()) {
    result.set(span.hunkIndex, projectSpanToEdge(span));
  }

  return result;
}

/**
 * Bridges `computeOrphanWindows`' numeric-gap-keyed map onto the
 * `BoundaryRef`-keyed `OrphanWindow[]` shape that
 * `core/expansion-state.ts`' `seedFromOrphans` consumes. The TUI feeds
 * the result into expansion state at planner-init so orphan comments
 * render inline with `±10` lines of surrounding context (PRD #108).
 *
 * Mapping rule: hunkIndex `0` → `'top'`, hunkIndex === `file.hunks.length`
 * → `'bottom'`, otherwise the numeric hunk index. This matches the
 * planner's boundary identity in `diff-rows.ts`.
 */
export function orphanSeedWindows(
  file: DiffFile,
  comments: Comment[],
  opts: OrphanWindowOptions,
): OrphanWindow[] {
  const out: OrphanWindow[] = [];
  for (const [hunkIndex, region] of computeOrphanWindows(file, comments, opts)) {
    out.push({
      file: file.name,
      ref: hunkIndexToBoundaryRef(hunkIndex, file.hunks.length),
      fromStart: region.fromStart,
      fromEnd: region.fromEnd,
    });
  }
  return out;
}

export function hunkIndexToBoundaryRef(hunkIndex: number, hunkCount: number): BoundaryRef {
  if (hunkIndex === 0) return "top";
  if (hunkIndex === hunkCount) return "bottom";
  return hunkIndex;
}

interface OrphanSpan {
  hunkIndex: number;
  gapSize: number;
  startOffset: number;
  endOffset: number;
}

function hunkRangeOn(h: DiffHunk, isAdditions: boolean): { start: number; count: number } {
  return isAdditions
    ? { start: h.additionStart, count: h.additionCount }
    : { start: h.deletionStart, count: h.deletionCount };
}

function orphanSpanFor(
  file: DiffFile,
  comment: Comment,
  opts: OrphanWindowOptions,
): OrphanSpan | null {
  const isAdditions = comment.side === "additions";
  const lineCount = isAdditions ? opts.newLineCount : opts.oldLineCount;
  const line = comment.line_start;
  if (line < 1 || line > lineCount) return null;

  let hunkIndex = file.hunks.length;
  for (let i = 0; i < file.hunks.length; i++) {
    const { start, count } = hunkRangeOn(file.hunks[i], isAdditions);
    if (count === 0) continue;
    const end = start + count - 1;
    if (line >= start && line <= end) return null;
    if (line < start) {
      hunkIndex = i;
      break;
    }
  }

  const { gapStart, gapEnd } = gapBoundsFor(file, hunkIndex, isAdditions, lineCount);
  if (gapEnd < gapStart) return null;

  const wStart = Math.max(1, line - WINDOW_RADIUS);
  const wEnd = Math.min(lineCount, line + WINDOW_RADIUS);
  const wStartG = Math.max(wStart, gapStart);
  const wEndG = Math.min(wEnd, gapEnd);

  return {
    hunkIndex,
    gapSize: gapEnd - gapStart + 1,
    startOffset: wStartG - gapStart + 1,
    endOffset: wEndG - gapStart + 1,
  };
}

function projectSpanToEdge(span: OrphanSpan): HunkExpansionRegion {
  const fromStart = span.endOffset;
  const fromEnd = span.gapSize - span.startOffset + 1;
  return fromStart <= fromEnd
    ? { fromStart, fromEnd: 0 }
    : { fromStart: 0, fromEnd };
}

function gapBoundsFor(
  file: DiffFile,
  hunkIndex: number,
  isAdditions: boolean,
  lineCount: number,
): { gapStart: number; gapEnd: number } {
  if (hunkIndex === 0) {
    for (const h of file.hunks) {
      const { start, count } = hunkRangeOn(h, isAdditions);
      if (count > 0) return { gapStart: 1, gapEnd: start - 1 };
    }
    return { gapStart: 1, gapEnd: lineCount };
  }
  if (hunkIndex >= file.hunks.length) {
    for (let i = file.hunks.length - 1; i >= 0; i--) {
      const { start, count } = hunkRangeOn(file.hunks[i], isAdditions);
      if (count > 0) return { gapStart: start + count, gapEnd: lineCount };
    }
    return { gapStart: 1, gapEnd: lineCount };
  }
  let prevEnd = 0;
  for (let i = hunkIndex - 1; i >= 0; i--) {
    const { start, count } = hunkRangeOn(file.hunks[i], isAdditions);
    if (count > 0) {
      prevEnd = start + count - 1;
      break;
    }
  }
  const { start: nextStart } = hunkRangeOn(file.hunks[hunkIndex], isAdditions);
  return { gapStart: prevEnd + 1, gapEnd: nextStart - 1 };
}
