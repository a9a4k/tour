import type { Annotation } from "./types.js";
import type { FlatRow } from "./flat-rows.js";

/**
 * A semantic anchor (file, line, side) plus a sticky `preferredSide` the
 * user toggles with h/l. Layout, fold state, and bundle reloads only change
 * how the cursor RESOLVES against the diff — the anchor itself is invariant.
 */
export interface Cursor {
  file: string;
  lineNumber: number;
  side: "additions" | "deletions";
  preferredSide: "additions" | "deletions";
}

/**
 * Initial cursor: first top-level Annotation's anchor if any, else first
 * row of the first non-folded file. Returns null when no rows are
 * addressable (empty Tour, all files folded, snapshot lost).
 */
export function initialCursor(args: {
  topLevelAnnotations: Annotation[];
  flatRows: FlatRow[];
}): Cursor | null {
  if (args.flatRows.length === 0) return null;
  const a = args.topLevelAnnotations[0];
  if (a) {
    const target = args.flatRows.find((r) => rowMatchesAnchor(r, a.file, a.side, a.line_start));
    if (target) return cursorFromRow(target, a.side);
  }
  return cursorFromRow(args.flatRows[0], args.flatRows[0].side);
}

export function moveCursor(
  cursor: Cursor | null,
  direction: "up" | "down",
  flatRows: FlatRow[],
): Cursor | null {
  if (!cursor) return null;
  const idx = resolveCursorRowIdx(cursor, flatRows);
  if (idx === -1) return cursor;
  const next = direction === "down" ? idx + 1 : idx - 1;
  if (next < 0 || next >= flatRows.length) return cursor;
  return cursorFromRow(flatRows[next], cursor.preferredSide);
}

export function setCursorSide(
  cursor: Cursor | null,
  side: "additions" | "deletions",
  flatRows: FlatRow[],
): Cursor | null {
  if (!cursor) return null;
  const idx = resolveCursorRowIdx(cursor, flatRows);
  if (idx === -1) return cursor;
  // preferredSide always updates; effective side snaps to whatever the row
  // actually offers (paired rows honour the new side, single-side rows force
  // their populated side).
  return cursorFromRow(flatRows[idx], side);
}

/**
 * Snap a cursor to the nearest still-valid anchor after the row sequence
 * changes (fold/unfold, layout toggle, bundle reload). When the anchor is
 * still resolvable, returns the cursor unchanged. When only the anchor's
 * specific row vanished but the file is still in the sequence, snaps to
 * that file's first row. When the cursor's file is gone (folded or removed
 * from the bundle), `files` is consulted to snap to the next file in
 * stream order — falling back to the previous file when the cursor's file
 * was the last one. Returns null when no valid row exists in the bundle.
 */
export function validateCursor(
  cursor: Cursor | null,
  flatRows: FlatRow[],
  files?: ReadonlyArray<{ name: string }>,
): Cursor | null {
  if (!cursor) return null;
  if (flatRows.length === 0) return null;
  if (resolveCursorRowIdx(cursor, flatRows) !== -1) return cursor;
  const fileRow = flatRows.find((r) => r.file === cursor.file);
  if (fileRow) return cursorFromRow(fileRow, cursor.preferredSide);
  if (!files) return null;
  const cursorFileIdx = files.findIndex((f) => f.name === cursor.file);
  if (cursorFileIdx === -1) return null;
  for (let i = cursorFileIdx + 1; i < files.length; i++) {
    const r = flatRows.find((row) => row.file === files[i].name);
    if (r) return cursorFromRow(r, cursor.preferredSide);
  }
  for (let i = cursorFileIdx - 1; i >= 0; i--) {
    const r = flatRows.find((row) => row.file === files[i].name);
    if (r) return cursorFromRow(r, cursor.preferredSide);
  }
  return null;
}

/**
 * Cursor at a file's first annotatable row in stream order, or null when
 * the file has no rows (folded, classified-no-textual, snapshot-lost,
 * empty tour). Used by sidebar-driven file selection (PRD US 20) — the
 * explicit "show me from the top" gesture distinct from j/k cross-file
 * motion which lands on the immediate-next row, not the file's first.
 */
export function cursorAtFirstFileRow(
  file: string,
  flatRows: FlatRow[],
): Cursor | null {
  const r = flatRows.find((row) => row.file === file);
  if (!r) return null;
  return cursorFromRow(r, r.side);
}

export function resolveCursorRowIdx(
  cursor: Cursor | null,
  flatRows: FlatRow[],
): number {
  if (!cursor) return -1;
  for (let i = 0; i < flatRows.length; i++) {
    if (rowMatchesAnchor(flatRows[i], cursor.file, cursor.side, cursor.lineNumber)) {
      return i;
    }
  }
  return -1;
}

/**
 * Cursor anchored at an annotation's (file, side, line_start) — the
 * β-coupling shape per ADR 0011 (annotation-nav is inherently code-nav,
 * so going "to annotation 5" means going to its line). preferredSide
 * mirrors the annotation's side so a follow-up `a` (sibling top-level)
 * lands on the same column the user just navigated to.
 */
export function cursorFromAnnotation(a: Annotation): Cursor {
  return {
    file: a.file,
    lineNumber: a.line_start,
    side: a.side,
    preferredSide: a.side,
  };
}

function rowMatchesAnchor(
  row: FlatRow,
  file: string,
  side: "additions" | "deletions",
  lineNumber: number,
): boolean {
  if (row.file !== file) return false;
  if (side === "additions") return row.rightLineNumber === lineNumber;
  return row.leftLineNumber === lineNumber;
}

function cursorFromRow(row: FlatRow, preferredSide: "additions" | "deletions"): Cursor {
  // Paired rows honour preferredSide. Single-side rows force their populated
  // side (a deletion-only row can't anchor an additions-side cursor).
  const effective: "additions" | "deletions" = row.paired ? preferredSide : row.side;
  const lineNumber =
    effective === "additions"
      ? (row.rightLineNumber as number)
      : (row.leftLineNumber as number);
  return {
    file: row.file,
    lineNumber,
    side: effective,
    preferredSide,
  };
}
