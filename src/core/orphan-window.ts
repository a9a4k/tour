import type { DiffFile, DiffHunk } from "./diff-model.js";
import type { Annotation } from "./types.js";

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
  annotations: Annotation[],
  opts: OrphanWindowOptions,
): Map<number, HunkExpansionRegion> {
  const result = new Map<number, HunkExpansionRegion>();

  for (const a of annotations) {
    if (a.file !== file.name) continue;
    const region = orphanRegionFor(file, a, opts);
    if (!region) continue;
    const prev = result.get(region.hunkIndex) ?? { fromStart: 0, fromEnd: 0 };
    result.set(region.hunkIndex, {
      fromStart: Math.max(prev.fromStart, region.fromStart),
      fromEnd: Math.max(prev.fromEnd, region.fromEnd),
    });
  }

  return result;
}

interface OrphanRegion extends HunkExpansionRegion {
  hunkIndex: number;
}

function hunkRangeOn(h: DiffHunk, isAdditions: boolean): { start: number; count: number } {
  return isAdditions
    ? { start: h.additionStart, count: h.additionCount }
    : { start: h.deletionStart, count: h.deletionCount };
}

function orphanRegionFor(
  file: DiffFile,
  a: Annotation,
  opts: OrphanWindowOptions,
): OrphanRegion | null {
  const isAdditions = a.side === "additions";
  const lineCount = isAdditions ? opts.newLineCount : opts.oldLineCount;
  const L = a.line_start;
  if (L < 1 || L > lineCount) return null;

  let hunkIndex = file.hunks.length;
  for (let i = 0; i < file.hunks.length; i++) {
    const { start, count } = hunkRangeOn(file.hunks[i], isAdditions);
    if (count === 0) continue;
    const end = start + count - 1;
    if (L >= start && L <= end) return null;
    if (L < start) {
      hunkIndex = i;
      break;
    }
  }

  const { gapStart, gapEnd } = gapBoundsFor(file, hunkIndex, isAdditions, lineCount);
  if (gapEnd < gapStart) return null;

  const wStart = Math.max(1, L - WINDOW_RADIUS);
  const wEnd = Math.min(lineCount, L + WINDOW_RADIUS);
  const wStartG = Math.max(wStart, gapStart);
  const wEndG = Math.min(wEnd, gapEnd);

  return {
    hunkIndex,
    fromStart: Math.max(0, wEndG - gapStart + 1),
    fromEnd: Math.max(0, gapEnd - wStartG + 1),
  };
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
