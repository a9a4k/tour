import type { Annotation } from "./types.js";
import type { FlatRow, DiffFlatRow, CardFlatRow } from "./flat-rows.js";
import type { InteractiveSubKind, BoundaryRef } from "./diff-rows.js";

/**
 * Unified Cursor (ADR 0022 → ADR 0023 / PRD #192, issue #200): one anchor
 * that walks diff rows, interactive rows, AND Annotation cards. Tagged-
 * union: a `RowAnchor` addresses a diff or interactive row by
 * `(file, side, lineNumber)` (with an optional `interactive` discriminator
 * for gap-row family rows); a `CardAnchor` addresses an Annotation card by
 * `annotationId`.
 *
 * Two motion gestures, not two lanes (ADR 0023, issue #200): `j`/`k` is
 * the **step** gesture — one row per press, no destination filter, so a
 * card row is a valid stop. `n`/`p` is the **jump** gesture — one top-
 * level Annotation per press, regardless of intervening rows. Cards are
 * cursor-eligible stops for both; the two differ in distance per press,
 * not in destination kind.
 *
 * Both cursor kinds carry `preferredSide` so an `h`/`l` choice survives
 * a step across a card or a jump between cards — the next diff-row
 * landing honours the user's last side preference (PRD US 18 / issue
 * #200 AC for preferredSide preservation).
 *
 * Action keys (`r`/`s`/`a`/`Enter`) dispatch by the cursor's row kind —
 * `r` and `s` are no-ops on a row, `a` is a no-op on a card (PRD #192
 * stories 6-12).
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
  /** Carried so an `h`/`l` choice survives step-across-card and jump-
   *  between-cards (issue #200 AC). The next diff-row landing applies it. */
  preferredSide: "additions" | "deletions";
}

export type Cursor = RowAnchor | CardAnchor;

export function isRowAnchor(c: Cursor | null): c is RowAnchor {
  return c !== null && c.kind === "row";
}

export function isCardAnchor(c: Cursor | null): c is CardAnchor {
  return c !== null && c.kind === "card";
}

/** preferredSide of a cursor, or "additions" when there's nothing to read
 *  it from (null cursor only — both RowAnchor and CardAnchor carry it,
 *  issue #200). Used by the motion helpers when the destination is a row
 *  but the source might be either kind. */
export function preferredSideOf(c: Cursor | null): "additions" | "deletions" {
  return c ? c.preferredSide : "additions";
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
    if (cardRow) return { kind: "card", annotationId: a.id, preferredSide: "additions" };
  }
  const firstDiff = args.flatRows.find(
    (r): r is DiffFlatRow => r.kind === "diff",
  );
  if (!firstDiff) return null;
  return cursorFromRow(firstDiff, firstDiff.side);
}

/**
 * Step gesture (`j`/`k`, ADR 0023 / issue #200). Moves the cursor one
 * row in the flat stream in the given direction — no destination filter.
 * Diff rows, interactive rows, and Annotation cards are all valid stops.
 * Stacked cards (multiple top-level annotations at the same anchor) count
 * as one step each. preferredSide is preserved across motion (across
 * cards too); the row's natural side wins on single-side destinations.
 * The card-lane jump gesture is `n`/`p` (`nextCard` / `prevCard`), which
 * skips over rows.
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
  const next = idx + step;
  if (next < 0 || next >= flatRows.length) return cursor;
  return cursorFromRow(flatRows[next], preferredSideOf(cursor));
}

/**
 * Card-lane walker (`n`/`p`). Moves the cursor to the next/previous
 * top-level Annotation. Returns null at the bounds (no wrap).
 *
 * Three input shapes, three behaviours:
 * - **CardAnchor**: walks the canonical top-level list directly by
 *   index — same order the `[N/M]` pill counter reads (issue #197), so
 *   `n` from `K/M` always lands on `K+1/M` even when JSONL `created_at`
 *   order disagrees with file display order.
 * - **RowAnchor**: position-aware jump (issue #203). Iterates topLevel
 *   in order; `nextCard` returns the first annotation whose anchor row
 *   is at or after the cursor's stream position (`a.file` after
 *   `cursor.file` in `files` order, or same file with
 *   `a.line_end >= cursor.lineNumber`). `prevCard` is the symmetric
 *   backwards walk over reverse topLevel order. So a reviewer who has
 *   stepped past annotation 1 onto a row below it presses `n` and
 *   lands on annotation 2 (forward in reading order), not annotation 1.
 * - **null** (lazy materialization seed) or **stale CardAnchor**
 *   (id not in topLevel — `validateCursor` clears these independently):
 *   null returns the topLevel edge (`nextCard` → first, `prevCard` →
 *   last). Stale CardAnchor returns null — the validation policy nulls
 *   it on the next render and lazy materialization re-seeds.
 *
 * `preferredSide` is threaded onto the destination CardAnchor in every
 * case (issue #200): from a Cursor, `cursor.preferredSide`; from null,
 * `"additions"`.
 */
export function nextCard(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  files: ReadonlyArray<string>,
): CardAnchor | null {
  return walkCards(cursor, topLevel, files, 1);
}

export function prevCard(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  files: ReadonlyArray<string>,
): CardAnchor | null {
  return walkCards(cursor, topLevel, files, -1);
}

function walkCards(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  files: ReadonlyArray<string>,
  step: 1 | -1,
): CardAnchor | null {
  if (topLevel.length === 0) return null;
  if (cursor === null) {
    const target = step === 1 ? topLevel[0] : topLevel[topLevel.length - 1];
    return { kind: "card", annotationId: target.id, preferredSide: "additions" };
  }
  if (cursor.kind === "card") {
    const idx = topLevel.findIndex((a) => a.id === cursor.annotationId);
    if (idx === -1) return null;
    const next = idx + step;
    if (next < 0 || next >= topLevel.length) return null;
    return { kind: "card", annotationId: topLevel[next].id, preferredSide: cursor.preferredSide };
  }
  const cursorFileIdx = files.indexOf(cursor.file);
  if (cursorFileIdx === -1) return null;
  const preferredSide = cursor.preferredSide;
  if (step === 1) {
    for (const a of topLevel) {
      const aFileIdx = files.indexOf(a.file);
      if (aFileIdx === -1) continue;
      if (aFileIdx > cursorFileIdx ||
          (aFileIdx === cursorFileIdx && a.line_end >= cursor.lineNumber)) {
        return { kind: "card", annotationId: a.id, preferredSide };
      }
    }
    return null;
  }
  for (let i = topLevel.length - 1; i >= 0; i--) {
    const a = topLevel[i];
    const aFileIdx = files.indexOf(a.file);
    if (aFileIdx === -1) continue;
    if (aFileIdx < cursorFileIdx ||
        (aFileIdx === cursorFileIdx && a.line_end <= cursor.lineNumber)) {
      return { kind: "card", annotationId: a.id, preferredSide };
    }
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
  return cursorFromRow(r, r.side) as RowAnchor;
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
 * `preferredSide` is threaded so an `h`/`l` choice survives the
 * card stop (ADR 0023 / issue #200).
 */
export function cursorFromAnnotation(
  a: Annotation,
  preferredSide: "additions" | "deletions" = "additions",
): CardAnchor {
  return { kind: "card", annotationId: a.id, preferredSide };
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
  if (row.kind === "card") {
    // Card rows are first-class cursor stops in the step/jump model
    // (ADR 0023 / issue #200). `j`/`k` lands on the card; `r` opens
    // the Reply composer and the pill counter shows the card's
    // top-level index. preferredSide is threaded so the next diff-row
    // landing honours the user's last h/l choice.
    return { kind: "card", annotationId: row.annotationId, preferredSide };
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
