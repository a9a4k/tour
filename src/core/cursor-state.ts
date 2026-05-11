import type { Annotation } from "./types.js";
import type { FlatRow, DiffFlatRow } from "./flat-rows.js";
import type { InteractiveSubKind, BoundaryRef } from "./diff-rows.js";

/**
 * A semantic anchor (file, line, side) plus a sticky `preferredSide` the
 * user toggles with h/l. Layout, fold state, and bundle reloads only change
 * how the cursor RESOLVES against the diff — the anchor itself is invariant.
 *
 * `interactive` (ADR 0013) is set when the cursor sits on a hunk-separator,
 * file-top / file-bottom boundary, or collapsed-file synthetic row. When
 * present, `lineNumber` and `side` are unused (existing fields retained for
 * ABI simplicity but ignored — `preferredSide` is still tracked so a
 * subsequent move back onto a paired diff row honours the user's last
 * h/l preference).
 */
export interface Cursor {
  file: string;
  lineNumber: number;
  side: "additions" | "deletions";
  preferredSide: "additions" | "deletions";
  interactive?: { subKind: InteractiveSubKind; boundaryRef: BoundaryRef };
}

/**
 * Initial cursor: first top-level Annotation's anchor if any, else first
 * DIFF row of the first non-folded file. Returns null when no diff row is
 * addressable (empty Tour, all files folded, snapshot lost). Per PRD #107
 * US 14, initial position never lands on an interactive row by default.
 * Per issue #170 the seeded cursor uses `line_end` to mirror
 * `cursorFromAnnotation` (n/p β-coupling), so single-line annotations are
 * unchanged and multiline annotations seed at the bottom of the range.
 */
export function initialCursor(args: {
  topLevelAnnotations: Annotation[];
  flatRows: FlatRow[];
}): Cursor | null {
  if (args.flatRows.length === 0) return null;
  const a = args.topLevelAnnotations[0];
  if (a) {
    const target = args.flatRows.find(
      (r): r is DiffFlatRow =>
        r.kind === "diff" && rowMatchesAnchor(r, a.file, a.side, a.line_end),
    );
    if (target) return cursorFromAnnotation(a);
  }
  const firstDiff = args.flatRows.find(
    (r): r is DiffFlatRow => r.kind === "diff",
  );
  if (!firstDiff) return null;
  return cursorFromRow(firstDiff, firstDiff.side);
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
  // Interactive rows have no side concept — h/l is a silent no-op there
  // (PRD #107 US 10). preferredSide is preserved untouched so the next
  // diff-row landing honours the user's last side choice.
  if (cursor.interactive) return cursor;
  const idx = resolveCursorRowIdx(cursor, flatRows);
  if (idx === -1) return cursor;
  const row = flatRows[idx];
  // Should never happen — a non-interactive cursor that resolves must land
  // on a diff row — but the union narrows guard against future row kinds.
  if (row.kind !== "diff") return cursor;
  // preferredSide always updates; effective side snaps to whatever the row
  // actually offers (paired rows honour the new side, single-side rows force
  // their populated side).
  return cursorFromRow(row, side);
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
 *
 * Interactive cursors (ADR 0013) preserve identity by `(file, subKind,
 * boundaryRef)` — the same boundary still resolves across SHA-stable
 * bundle reloads. When the boundary is gone (hunk count changed,
 * file removed, file folded) the same fallback rules apply.
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
 * the file has no diff row (folded, classified-no-textual, snapshot-lost,
 * empty tour). Used by sidebar-driven file selection (PRD US 20) — the
 * explicit "show me from the top" gesture distinct from j/k cross-file
 * motion which lands on the immediate-next row, not the file's first.
 *
 * Skips interactive rows: "annotatable" specifically means a real diff row
 * (PRD #107 US 14 — initial position never lands on an interactive row).
 */
export function cursorAtFirstFileRow(
  file: string,
  flatRows: FlatRow[],
): Cursor | null {
  const r = flatRows.find(
    (row): row is DiffFlatRow => row.kind === "diff" && row.file === file,
  );
  if (!r) return null;
  return cursorFromRow(r, r.side);
}

/**
 * Cursor anchored to an interactive row by `(file, subKind, boundaryRef)`.
 * Used by mouse click on an interactive row (PRD #107 US 16) — sets
 * cursor.interactive, no `side`. preferredSide carries forward so a
 * subsequent move back onto a paired diff row honours the user's last
 * h/l preference.
 */
export function cursorOnInteractive(args: {
  file: string;
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
  preferredSide?: "additions" | "deletions";
}): Cursor {
  const preferredSide = args.preferredSide ?? "additions";
  return {
    file: args.file,
    lineNumber: 0,
    side: preferredSide,
    preferredSide,
    interactive: { subKind: args.subKind, boundaryRef: args.boundaryRef },
  };
}

export function resolveCursorRowIdx(
  cursor: Cursor | null,
  flatRows: FlatRow[],
): number {
  if (!cursor) return -1;
  if (cursor.interactive) {
    const target = cursor.interactive;
    for (let i = 0; i < flatRows.length; i++) {
      const r = flatRows[i];
      if (r.kind !== "interactive") continue;
      if (r.file !== cursor.file) continue;
      if (r.subKind !== target.subKind) continue;
      if (r.boundaryRef !== target.boundaryRef) continue;
      return i;
    }
    return -1;
  }
  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i];
    if (r.kind !== "diff") continue;
    if (rowMatchesAnchor(r, cursor.file, cursor.side, cursor.lineNumber)) {
      return i;
    }
  }
  return -1;
}

/**
 * Cursor anchored at an annotation's (file, side, line_end) — the
 * β-coupling shape per ADR 0011 (annotation-nav is inherently code-nav,
 * so going "to annotation 5" means going to its line). For multiline
 * annotations the cursor lands on line_end (issue #170) so the eye lands
 * at the bottom of the annotated range with the card and the rest of
 * the range above; single-line annotations are unchanged. preferredSide
 * mirrors the annotation's side so a follow-up `a` (sibling top-level)
 * lands on the same column the user just navigated to.
 */
export function cursorFromAnnotation(a: Annotation): Cursor {
  return {
    file: a.file,
    lineNumber: a.line_end,
    side: a.side,
    preferredSide: a.side,
  };
}

function rowMatchesAnchor(
  row: DiffFlatRow,
  file: string,
  side: "additions" | "deletions",
  lineNumber: number,
): boolean {
  if (row.file !== file) return false;
  if (side === "additions") return row.rightLineNumber === lineNumber;
  return row.leftLineNumber === lineNumber;
}

export function cursorFromRow(
  row: FlatRow,
  preferredSide: "additions" | "deletions",
): Cursor {
  if (row.kind === "interactive") {
    return cursorOnInteractive({
      file: row.file,
      subKind: row.subKind,
      boundaryRef: row.boundaryRef,
      preferredSide,
    });
  }
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
