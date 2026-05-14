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
  topLevelAnnotations: ReadonlyArray<Annotation>;
  flatRows: ReadonlyArray<FlatRow>;
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
  flatRows: ReadonlyArray<FlatRow>,
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
 * top-level Annotation — same order the `[N/M]` pill counter reads
 * (issue #197). Walks the canonical top-level list directly, not the
 * flat-row display stream, so `n` from `K/M` always lands on `K+1/M`
 * even when JSONL `created_at` order disagrees with file display order.
 * Returns null at the bounds (no wrap). When the cursor is null, on a
 * row, or pointing at a stale annotation, the walk picks the first
 * (`nextCard`) or last (`prevCard`) top-level annotation — `n`/`p` is
 * a pure topLevel-order gesture, independent of the cursor's stream
 * position (issue #206 revert of #203).
 */
export function nextCard(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
): CardAnchor | null {
  return walkCards(cursor, topLevel, 1);
}

export function prevCard(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
): CardAnchor | null {
  return walkCards(cursor, topLevel, -1);
}

function walkCards(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  step: 1 | -1,
): CardAnchor | null {
  if (topLevel.length === 0) return null;
  const startIdx =
    cursor && cursor.kind === "card"
      ? topLevel.findIndex((a) => a.id === cursor.annotationId)
      : -1;
  // When the cursor isn't on a resolvable card, start one step beyond the
  // boundary so the first move lands on the first/last entry.
  const from = startIdx === -1 ? (step === 1 ? -1 : topLevel.length) : startIdx;
  const next = from + step;
  if (next < 0 || next >= topLevel.length) return null;
  return { kind: "card", annotationId: topLevel[next].id, preferredSide: preferredSideOf(cursor) };
}

export function setCursorSide(
  cursor: Cursor | null,
  side: "additions" | "deletions",
  flatRows: ReadonlyArray<FlatRow>,
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
 * row when the file still has any row but the specific row vanished;
 * preserved when `files` is provided and the cursor's file is in `files`
 * but has no rows in flatRows (the file is folded — uncollapsing restores
 * the anchor); returns null otherwise. For a CardAnchor: preserved when
 * its annotationId is still in the flat-row stream; returns null otherwise
 * — cards have no "snap to file's first row" fallback (PRD #192).
 *
 * Reconciled with the webapp's prior `validateWebappCursor` (issue #232):
 * the "preserve cursor when file is in the bundle but has no visible rows"
 * branch was webapp-specific because the webapp's flatRows stream excludes
 * collapsed files, conflating "file collapsed" with "file removed from
 * bundle". Folding a file with the cursor on it no longer walks the cursor
 * to the next file in stream order — it preserves the anchor invisibly so
 * unfolding lands the cursor back in the same place.
 */
export function validateCursor(
  cursor: Cursor | null,
  flatRows: ReadonlyArray<FlatRow>,
  files?: ReadonlyArray<{ name: string }>,
): Cursor | null {
  if (!cursor) return null;
  if (resolveCursorRowIdx(cursor, flatRows) !== -1) return cursor;
  if (cursor.kind === "card") return null;
  const fileRow = flatRows.find((r) => r.file === cursor.file);
  if (fileRow) return cursorFromRow(fileRow, cursor.preferredSide);
  if (files && files.some((f) => f.name === cursor.file)) return cursor;
  return null;
}

/**
 * Cursor at a file's first annotatable row in stream order, or null when
 * the file has no diff row. Used by sidebar-driven file selection
 * (PRD US 20). Skips interactive rows and card rows.
 */
export function cursorAtFirstFileRow(
  file: string,
  flatRows: ReadonlyArray<FlatRow>,
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
  flatRows: ReadonlyArray<FlatRow>,
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

/**
 * Predict the cursor's landing after an Enter-press orphans the current
 * interactive cursor (issue #306). Pressing Enter on a gap-row that
 * consumes its entire remaining gap leaves the cursor anchored to a row
 * the next render drops from the walkable stream (banner with
 * `primaryExpand === null`, expand-down with gap < emit threshold, or
 * the collapsed-file row replaced by the file body). Both surfaces call
 * this helper with the pre-dispatch `flatRows` and the orphan kind to
 * compute a landing on a row that survives the expansion; the caller
 * then dispatches `cursor.set` alongside the `expansion.*` action.
 *
 * Landing rules (per issue #306 brief):
 *
 * - `boundary-top` / `hunk-separator` / `expand-down-mid` consumed →
 *   first DIFF row of the same file at or after `idx+1` in
 *   `flatRowsBefore`. Interactive rows are skipped because the same
 *   dispatch can orphan adjacent interactives (a mid-file `expand-down`
 *   sits immediately before a `hunk-header` banner that the same
 *   full-gap dispatch will also orphan).
 *
 * - `expand-down-bottom` consumed → last DIFF row of the same file at
 *   or before `idx-1`. The `+1` fallback would jump into the next file.
 *
 * - `collapsed-file` consumed → a synthetic `boundary-top` anchor on
 *   the file. After the file body materialises the banner resolves
 *   directly when walkable (`primaryExpand !== null` — the common
 *   case); otherwise `validateCursor` snaps the cursor to the file's
 *   first emitted row.
 */
export type ExpandOrphanKind =
  | "boundary-top"
  | "hunk-separator"
  | "expand-down-mid"
  | "expand-down-bottom"
  | "collapsed-file";

export function cursorAfterExpand(
  cursor: RowAnchor,
  flatRowsBefore: ReadonlyArray<FlatRow>,
  orphanKind: ExpandOrphanKind,
): Cursor {
  const file = cursor.file;
  const preferredSide = cursor.preferredSide;

  if (orphanKind === "collapsed-file") {
    // The file's diff body materialises after dispatch — `flatRowsBefore`
    // has no diff rows for this file (only the collapsed-file synthetic).
    // The post-expansion file emits its hunk-header banner first when the
    // file-top gap > 0; otherwise the first hunk-content row. The
    // boundary-top anchor resolves in the former case and is snapped by
    // `validateCursor`'s file-row fallback in the latter.
    return cursorOnInteractive({
      file,
      subKind: "boundary-top",
      boundaryRef: "top",
      preferredSide,
    });
  }

  const idx = resolveCursorRowIdx(cursor, flatRowsBefore);
  if (idx === -1) return cursor;

  const direction: 1 | -1 = orphanKind === "expand-down-bottom" ? -1 : 1;
  const target = nearestDiffRowInFile(flatRowsBefore, file, idx, direction);
  if (target) return cursorFromRow(target, preferredSide);

  // Fallback: try the opposite direction within the same file (covers the
  // pathological case where the orphan is the only walkable row of its
  // kind ahead and the file has nothing behind it).
  const opposite: 1 | -1 = direction === 1 ? -1 : 1;
  const fallback = nearestDiffRowInFile(flatRowsBefore, file, idx, opposite);
  if (fallback) return cursorFromRow(fallback, preferredSide);

  return cursor;
}

function nearestDiffRowInFile(
  rows: ReadonlyArray<FlatRow>,
  file: string,
  fromIdx: number,
  direction: 1 | -1,
): DiffFlatRow | null {
  const end = direction === 1 ? rows.length : -1;
  for (let i = fromIdx + direction; i !== end; i += direction) {
    const r = rows[i];
    if (r.kind === "diff" && r.file === file) return r;
  }
  return null;
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
