import type { Annotation } from "./types.js";
import type { FlatRow, DiffFlatRow, CardFlatRow } from "./flat-rows.js";
import type { InteractiveSubKind, BoundaryRef } from "./diff-rows.js";

/**
 * Unified Cursor (ADR 0022 / PRD #192): one anchor that walks diff rows,
 * interactive rows, AND Annotation cards. Tagged-union: a `RowAnchor`
 * addresses a diff or interactive row by `(file, side, lineNumber)` (with
 * an optional `interactive` discriminator for gap-row family rows); a
 * `CardAnchor` addresses an Annotation card by `annotationId`.
 *
 * `j/k/h/l` walk the row lane (skipping cards); `n/p` walk the card lane
 * (skipping rows). Action keys (`r`/`s`/`a`/`Enter`) dispatch by the
 * cursor's row kind — `r` and `s` are no-ops on a row, `a` is a no-op on
 * a card (PRD #192 stories 6-12).
 */
export interface RowAnchor {
  kind: "row";
  file: string;
  lineNumber: number;
  side: "additions" | "deletions";
  preferredSide: "additions" | "deletions";
  /** Set when the cursor sits on a hunk-separator, file boundary, or
   *  collapsed-file synthetic row (ADR 0013). When present, `lineNumber`
   *  and `side` are unused (existing fields retained for ABI simplicity
   *  but ignored — `preferredSide` is still tracked so a subsequent move
   *  back onto a paired diff row honours the user's last h/l preference). */
  interactive?: { subKind: InteractiveSubKind; boundaryRef: BoundaryRef };
}

export interface CardAnchor {
  kind: "card";
  annotationId: string;
}

export type Cursor = RowAnchor | CardAnchor;

export function isRowAnchor(c: Cursor | null): c is RowAnchor {
  return c !== null && c.kind === "row";
}

export function isCardAnchor(c: Cursor | null): c is CardAnchor {
  return c !== null && c.kind === "card";
}

/** preferredSide of a cursor, or "additions" when there's nothing to read
 *  it from (card cursor, null cursor). Used by the motion helpers when
 *  the destination is a row but the source might not be. */
export function preferredSideOf(c: Cursor | null): "additions" | "deletions" {
  return c && c.kind === "row" ? c.preferredSide : "additions";
}

/**
 * Initial cursor: first top-level Annotation's card if any, else first
 * DIFF row of the first non-folded file. Returns null when no row is
 * addressable (empty Tour, all files folded, snapshot lost). Per PRD
 * #192 the seeded cursor is now a `CardAnchor` when annotations exist —
 * the previous `line_end` row-synthesis (issue #170) is dropped in favour
 * of the card being a first-class cursor stop.
 */
export function initialCursor(args: {
  topLevelAnnotations: Annotation[];
  flatRows: FlatRow[];
}): Cursor | null {
  if (args.flatRows.length === 0) return null;
  const a = args.topLevelAnnotations[0];
  if (a) {
    const cardRow = args.flatRows.find(
      (r): r is CardFlatRow => r.kind === "card" && r.annotationId === a.id,
    );
    if (cardRow) return { kind: "card", annotationId: a.id };
  }
  const firstDiff = args.flatRows.find(
    (r): r is DiffFlatRow => r.kind === "diff",
  );
  if (!firstDiff) return null;
  return cursorFromRow(firstDiff, firstDiff.side);
}

/**
 * Row-lane walker (`j`/`k`). Moves the cursor one cursor-eligible row in
 * the given direction, SKIPPING card rows — the card lane is `n`/`p`
 * (`nextCard` / `prevCard`). When the cursor starts on a card, the walk
 * steps to the next non-card row after the card's anchor. preferredSide
 * is preserved across motion; the row's natural side wins on single-side
 * destinations.
 */
export function moveCursor(
  cursor: Cursor | null,
  direction: "up" | "down",
  flatRows: FlatRow[],
): Cursor | null {
  if (!cursor) return null;
  const idx = resolveCursorRowIdx(cursor, flatRows);
  if (idx === -1) return cursor;
  const step = direction === "down" ? 1 : -1;
  let next = idx + step;
  while (next >= 0 && next < flatRows.length && flatRows[next].kind === "card") {
    next += step;
  }
  if (next < 0 || next >= flatRows.length) return cursor;
  return cursorFromRow(flatRows[next], preferredSideOf(cursor));
}

/**
 * Card-lane walker (`n`/`p`). Moves the cursor to the next/previous
 * Annotation card in stream order, skipping diff and interactive rows.
 * Returns null when the move is a no-op (no cards in the stream or
 * already at the boundary). When the cursor is null or off-stream, the
 * walk picks the first/last card.
 */
export function nextCard(
  cursor: Cursor | null,
  flatRows: FlatRow[],
): CardAnchor | null {
  return walkCards(cursor, flatRows, 1);
}

export function prevCard(
  cursor: Cursor | null,
  flatRows: FlatRow[],
): CardAnchor | null {
  return walkCards(cursor, flatRows, -1);
}

function walkCards(
  cursor: Cursor | null,
  flatRows: FlatRow[],
  step: 1 | -1,
): CardAnchor | null {
  const startIdx = cursor ? resolveCursorRowIdx(cursor, flatRows) : -1;
  // When cursor isn't resolved, start one step BEFORE the boundary so the
  // loop's first hit is the first/last card in the stream's direction.
  const from = startIdx === -1
    ? (step === 1 ? -1 : flatRows.length)
    : startIdx;
  for (let i = from + step; i >= 0 && i < flatRows.length; i += step) {
    const r = flatRows[i];
    if (r.kind === "card") return { kind: "card", annotationId: r.annotationId };
  }
  return null;
}

export function setCursorSide(
  cursor: Cursor | null,
  side: "additions" | "deletions",
  flatRows: FlatRow[],
): Cursor | null {
  if (!cursor) return null;
  // h/l is meaningful only on paired diff rows. On cards and interactive
  // rows it's a silent no-op (preferredSide preserved untouched so a
  // subsequent diff-row landing honours the user's last side choice).
  if (cursor.kind === "card") return cursor;
  if (cursor.interactive) return cursor;
  const idx = resolveCursorRowIdx(cursor, flatRows);
  if (idx === -1) return cursor;
  const row = flatRows[idx];
  if (row.kind !== "diff") return cursor;
  return cursorFromRow(row, side);
}

/**
 * Snap a cursor to the nearest still-valid anchor after the row sequence
 * changes (fold/unfold, layout toggle, bundle reload). For a RowAnchor:
 * preserved when its anchor still resolves; snapped to the file's first
 * row when only the specific row vanished; snapped to the next file in
 * stream order when the file is gone (with `files` provided); returns
 * null otherwise. For a CardAnchor: preserved when its annotationId is
 * still in the flat-row stream; returns null otherwise — cards have no
 * "snap to file's first row" fallback (PRD #192).
 */
export function validateCursor(
  cursor: Cursor | null,
  flatRows: FlatRow[],
  files?: ReadonlyArray<{ name: string }>,
): Cursor | null {
  if (!cursor) return null;
  if (flatRows.length === 0) return null;
  if (resolveCursorRowIdx(cursor, flatRows) !== -1) return cursor;
  if (cursor.kind === "card") return null;
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
 * the file has no diff row. Used by sidebar-driven file selection
 * (PRD US 20). Skips interactive rows and card rows.
 */
export function cursorAtFirstFileRow(
  file: string,
  flatRows: FlatRow[],
): RowAnchor | null {
  const r = flatRows.find(
    (row): row is DiffFlatRow => row.kind === "diff" && row.file === file,
  );
  if (!r) return null;
  return cursorFromRow(r, r.side);
}

/**
 * Cursor anchored to an interactive row by `(file, subKind, boundaryRef)`.
 */
export function cursorOnInteractive(args: {
  file: string;
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
  preferredSide?: "additions" | "deletions";
}): RowAnchor {
  const preferredSide = args.preferredSide ?? "additions";
  return {
    kind: "row",
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
  if (cursor.kind === "card") {
    for (let i = 0; i < flatRows.length; i++) {
      const r = flatRows[i];
      if (r.kind === "card" && r.annotationId === cursor.annotationId) return i;
    }
    return -1;
  }
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
 * Card cursor for an Annotation. Used by `n`/`p` annotation-nav and by
 * mouse-click on a card. The card itself is the cursor stop — no row
 * synthesis (PRD #192 supersedes the ADR 0011 β-coupling rule).
 */
export function cursorFromAnnotation(a: Annotation): CardAnchor {
  return { kind: "card", annotationId: a.id };
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
): RowAnchor {
  if (row.kind === "card") {
    // Card rows participate in flatRows so Home/End and pageMove's
    // nearest-row snap can pick one. The row-lane return shape forces
    // a synthesised RowAnchor at the card's (file, side, lineEnd) —
    // the n/p card lane is the way to land on a CardAnchor.
    return {
      kind: "row",
      file: row.file,
      lineNumber: row.lineEnd,
      side: row.side,
      preferredSide,
    };
  }
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
    kind: "row",
    file: row.file,
    lineNumber,
    side: effective,
    preferredSide,
  };
}
