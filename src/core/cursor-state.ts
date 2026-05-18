import type { Comment } from "./types.js";
import type { TourBundle } from "./tour-bundle.js";
import type { FlatRow, DiffFlatRow, InteractiveFlatRow, CardFlatRow } from "./flat-rows.js";
import type { InteractiveSubKind, BoundaryRef } from "./diff-rows.js";
import type { Thread } from "./threads.js";

/**
 * Unified Cursor (ADR 0022 → ADR 0023 / PRD #192, issue #200): one anchor
 * that walks diff rows, interactive rows, AND Comment cards. Tagged-
 * union: a `RowAnchor` addresses a diff or interactive row by
 * `(file, side, lineNumber)` (with an optional `interactive` discriminator
 * for gap-row family rows); a `CardAnchor` addresses a Comment card by
 * `commentId`.
 *
 * Two motion gestures, not two lanes (ADR 0023, issue #200): `j`/`k` is
 * the **step** gesture — one row per press, no destination filter, so a
 * card row is a valid stop. `n`/`p` is the **jump** gesture — one top-
 * level Comment per press, regardless of intervening rows. Cards are
 * cursor-eligible stops for both; the two differ in distance per press,
 * not in destination kind.
 *
 * Both cursor kinds carry `preferredSide` so an `h`/`l` choice survives
 * a step across a card or a jump between cards — the next diff-row
 * landing honours the user's last side preference (PRD US 18 / issue
 * #200 AC for preferredSide preservation).
 *
 * Action keys (`r`/`R`/`c`/`Enter`) dispatch by the cursor's row kind —
 * `r` and `R` are no-ops on a row, `c` is a no-op on a card (PRD #192
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
  /** Any Comment id in the Thread — parent or Reply (ADR 0037). The
   *  Card row in the flat stream is keyed on the parent's id only;
   *  `resolveCursorRowIdx` maps a reply's id through the supplied
   *  thread context to the parent's row when needed. `nextCard` /
   *  `prevCard` continue to enumerate top-level Comments only — when
   *  the cursor's id is a reply, the walker treats the cursor as
   *  being "on" the reply's root. */
  commentId: string;
  /** Carried so an `h`/`l` choice survives step-across-card and jump-
   *  between-cards (issue #200 AC). The next diff-row landing applies it. */
  preferredSide: "additions" | "deletions";
}

/** Locate the Thread that contains a given commentId (parent or
 *  Reply), and the node's position within `[root, ...replies]`. Used
 *  by the in-Card `j`/`k` walker (ADR 0037), the row-idx / validate
 *  mappers when the cursor sits on a Reply, and `sendTarget` (issue
 *  #395) so `R` dispatches Thread-scoped from a reply node. */
export function findThreadByNode(
  commentId: string,
  threads: ReadonlyArray<Thread>,
): { thread: Thread; nodeIdx: number } | null {
  for (const t of threads) {
    if (t.root.id === commentId) return { thread: t, nodeIdx: 0 };
    const idx = t.replies.findIndex((r) => r.id === commentId);
    if (idx !== -1) return { thread: t, nodeIdx: idx + 1 };
  }
  return null;
}

/** Resolve any Comment id (parent or Reply) to its Thread's root id.
 *  Falls back to `commentId` when the id isn't in any Thread (stale
 *  cursor, mid-bundle-refresh) so call sites get a stable id without
 *  branching. Used by PRD #397 / ADR 0038 action seams (`thread.toggle`,
 *  pre-dispatch `thread.expand`) which all target Thread roots. */
export function threadRootIdOf(
  commentId: string,
  threads: ReadonlyArray<Thread>,
): string {
  return findThreadByNode(commentId, threads)?.thread.root.id ?? commentId;
}

export type Cursor = RowAnchor | CardAnchor;

export function isRowAnchor(c: Cursor | null): c is RowAnchor {
  return c !== null && c.kind === "row";
}

export function isCardAnchor(c: Cursor | null): c is CardAnchor {
  return c !== null && c.kind === "card";
}

/**
 * Structural cursor validity: checks whether the cursor can still resolve
 * against the bundle substrate, independent of projection state such as
 * folds, expansion, or flat-row visibility.
 */
export function validateCursorStructural(
  cursor: Cursor | null,
  bundle: TourBundle,
): Cursor | null {
  if (cursor === null) return null;
  if (bundle.kind !== "ok") return null;
  if (cursor.kind === "card") {
    const comment = bundle.comments.find((c) => c.id === cursor.commentId);
    if (!comment || comment.deleted !== undefined) return null;
    return cursor;
  }
  return bundle.files.some((f) => f.name === cursor.file) ? cursor : null;
}

/** preferredSide of a cursor, or "additions" when there's nothing to read
 *  it from (null cursor only — both RowAnchor and CardAnchor carry it,
 *  issue #200). Used by the motion helpers when the destination is a row
 *  but the source might be either kind. */
export function preferredSideOf(c: Cursor | null): "additions" | "deletions" {
  return c ? c.preferredSide : "additions";
}

/**
 * Initial cursor: first top-level Comment's card if any, else first
 * DIFF row of the first non-folded file. Returns null when no row is
 * addressable (empty Tour, all files folded, snapshot lost). Per PRD
 * #192 the seeded cursor is now a `CardAnchor` when comments exist —
 * the previous `line_end` row-synthesis (issue #170) is dropped in favour
 * of the card being a first-class cursor stop.
 */
export function initialCursor(args: {
  topLevelComments: ReadonlyArray<Comment>;
  flatRows: ReadonlyArray<FlatRow>;
}): Cursor | null {
  if (args.flatRows.length === 0) return null;
  const a = args.topLevelComments[0];
  if (a) {
    const cardRow = args.flatRows.find(
      (r): r is CardFlatRow => r.kind === "card" && r.commentId === a.id,
    );
    if (cardRow) return { kind: "card", commentId: a.id, preferredSide: "additions" };
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
 * Diff rows, interactive rows, and Comment cards are all valid stops.
 * Stacked cards (multiple top-level comments at the same anchor) count
 * as one step each. preferredSide is preserved across motion (across
 * cards too); the row's natural side wins on single-side destinations.
 * The card-lane jump gesture is `n`/`p` (`nextCard` / `prevCard`), which
 * skips over rows.
 *
 * ADR 0037 — reply-level cursor stops. When `threads` is supplied and
 * the cursor is on a `CardAnchor` inside a multi-node Thread, `j`/`k`
 * walks the Thread's nodes (`[root, ...replies]`) before exiting to
 * the next flat row. From the last reply, `j` exits downward to the
 * row after the Card; from the root, `k` exits upward to the row
 * before the Card. Threads with no replies behave exactly as today
 * (parent → exit). When `threads` is omitted, the function preserves
 * its prior contract — the webapp does not adopt the reply-level
 * walker (ADR 0037 is TUI-scoped).
 *
 * PRD #397 / ADR 0038 — when `collapsedThreads` contains the Thread's
 * root id, the Replies are not rendered, so the in-Card walker is
 * skipped: the Thread is a single cursor stop on `j`/`k`, exiting
 * directly to the next/previous flat row. Without this, the view-
 * level validator would project a Reply anchor back to the parent
 * (cursor-state.ts:projectAnchorOnCollapse) and the user would need
 * N+1 j-presses on a Thread with N hidden Replies before the cursor
 * visibly moved.
 */
export function moveCursor(
  cursor: Cursor | null,
  direction: "up" | "down",
  flatRows: ReadonlyArray<FlatRow>,
  threads?: ReadonlyArray<Thread>,
  collapsedThreads?: ReadonlySet<string>,
): Cursor | null {
  if (!cursor) return null;
  if (cursor.kind === "card" && threads) {
    const found = findThreadByNode(cursor.commentId, threads);
    if (found && !collapsedThreads?.has(found.thread.root.id)) {
      const nodes = [found.thread.root, ...found.thread.replies];
      const nextIdx = direction === "down" ? found.nodeIdx + 1 : found.nodeIdx - 1;
      if (nextIdx >= 0 && nextIdx < nodes.length) {
        return {
          kind: "card",
          commentId: nodes[nextIdx].id,
          preferredSide: cursor.preferredSide,
        };
      }
      // Out of in-Card range — fall through to the row-walk below.
      // `resolveCursorRowIdx` maps a reply's id through `threads` to
      // the root's card row, so a step from there exits the Card.
    }
  }
  const idx = resolveCursorRowIdx(cursor, flatRows, threads);
  if (idx === -1) return cursor;
  const step = direction === "down" ? 1 : -1;
  const next = idx + step;
  if (next < 0 || next >= flatRows.length) return cursor;
  // Issue #410 — `k` mirrors the in-Thread walker on bottom boundary
  // entry. Stepping up onto a Card row with live, expanded Replies lands
  // on the last Reply (in append order), not the parent. From there the
  // in-Thread walker handles every subsequent `k` press (Reply N-1, …,
  // Reply 1, parent, exit upward). Top-entry (`j` onto a Card going
  // down) keeps landing on the parent — that direction was already
  // symmetric with the existing exit-from-last-reply.
  const target = flatRows[next];
  if (direction === "up" && target.kind === "card" && threads) {
    const found = findThreadByNode(target.commentId, threads);
    if (
      found &&
      found.thread.replies.length > 0 &&
      !collapsedThreads?.has(found.thread.root.id)
    ) {
      const lastReply = found.thread.replies[found.thread.replies.length - 1];
      return {
        kind: "card",
        commentId: lastReply.id,
        preferredSide: preferredSideOf(cursor),
      };
    }
  }
  return cursorFromRow(target, preferredSideOf(cursor));
}

/**
 * Card-lane walker (`n`/`p`). Moves the cursor to the next/previous
 * top-level Comment — same order the `[N/M]` pill counter reads
 * (issue #197). Walks the canonical top-level list directly, not the
 * flat-row display stream, so `n` from `K/M` always lands on `K+1/M`
 * even when JSONL `created_at` order disagrees with file display order.
 * Returns null at the bounds (no wrap). When the cursor is null, on a
 * row, or pointing at a stale comment, the walk picks the first
 * (`nextCard`) or last (`prevCard`) top-level comment — `n`/`p` is
 * a pure topLevel-order gesture, independent of the cursor's stream
 * position (issue #206 revert of #203).
 */
export function nextCard(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Comment>,
  threads?: ReadonlyArray<Thread>,
): CardAnchor | null {
  return walkCards(cursor, topLevel, 1, threads);
}

export function prevCard(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Comment>,
  threads?: ReadonlyArray<Thread>,
): CardAnchor | null {
  return walkCards(cursor, topLevel, -1, threads);
}

function walkCards(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Comment>,
  step: 1 | -1,
  threads?: ReadonlyArray<Thread>,
): CardAnchor | null {
  if (topLevel.length === 0) return null;
  let startIdx = -1;
  if (cursor && cursor.kind === "card") {
    startIdx = topLevel.findIndex((a) => a.id === cursor.commentId);
    if (startIdx === -1 && threads) {
      // ADR 0037 — when the cursor sits on a reply, treat it as being on
      // the reply's root for the purposes of top-level walking.
      const found = findThreadByNode(cursor.commentId, threads);
      if (found) {
        startIdx = topLevel.findIndex((a) => a.id === found.thread.root.id);
      }
    }
  }
  // When the cursor isn't on a resolvable card, start one step beyond the
  // boundary so the first move lands on the first/last entry.
  const from = startIdx === -1 ? (step === 1 ? -1 : topLevel.length) : startIdx;
  const next = from + step;
  if (next < 0 || next >= topLevel.length) return null;
  return { kind: "card", commentId: topLevel[next].id, preferredSide: preferredSideOf(cursor) };
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
 * its commentId is still in the flat-row stream; returns null otherwise
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
  threads?: ReadonlyArray<Thread>,
  collapsedThreads?: ReadonlySet<string>,
): Cursor | null {
  if (!cursor) return null;
  // PRD #397 / ADR 0038. When the cursor sits on a Reply node inside a
  // Thread the user just collapsed, project the anchor to the parent's
  // id so the visible cursor stays on the same Card the user acted on.
  // The generalised principle: project to the most-specific live stop
  // in the same lineage. Resolution falls through to the standard
  // row-idx lookup below — collapsing does not remove the parent's
  // Card row from the flat stream.
  const projected = projectAnchorOnCollapse(cursor, threads, collapsedThreads);
  if (resolveCursorRowIdx(projected, flatRows, threads) !== -1) return projected;
  if (projected.kind === "card") return null;
  const fileRow = flatRows.find((r) => r.file === projected.file);
  if (fileRow) return cursorFromRow(fileRow, projected.preferredSide);
  if (files && files.some((f) => f.name === projected.file)) return projected;
  return null;
}

function projectAnchorOnCollapse(
  cursor: Cursor,
  threads?: ReadonlyArray<Thread>,
  collapsedThreads?: ReadonlySet<string>,
): Cursor {
  if (cursor.kind !== "card") return cursor;
  if (!threads || !collapsedThreads || collapsedThreads.size === 0) return cursor;
  const found = findThreadByNode(cursor.commentId, threads);
  if (!found || found.nodeIdx === 0) return cursor;
  if (!collapsedThreads.has(found.thread.root.id)) return cursor;
  return {
    kind: "card",
    commentId: found.thread.root.id,
    preferredSide: cursor.preferredSide,
  };
}

/**
 * Cursor at a file's first walkable row in stream order, or null when the
 * file has no row. Used by sidebar-driven file selection (PRD US 20).
 * Skips card rows.
 *
 * Prefers a diff row so a sidebar click on a non-collapsed file lands the
 * cursor on real source content. Falls back to the file's first
 * interactive row when no diff row exists — issue #313: a classifier-
 * collapsed file's only walkable row is the synthetic `collapsed-file`
 * interactive banner, and sidebar click must land the cursor there
 * (Enter then dispatches the explicit reveal).
 */
export function cursorAtFirstFileRow(
  file: string,
  flatRows: ReadonlyArray<FlatRow>,
): RowAnchor | null {
  const diff = flatRows.find(
    (row): row is DiffFlatRow => row.kind === "diff" && row.file === file,
  );
  if (diff) return cursorFromRow(diff, diff.side) as RowAnchor;
  const interactive = flatRows.find(
    (row): row is InteractiveFlatRow =>
      row.kind === "interactive" && row.file === file,
  );
  if (!interactive) return null;
  return cursorFromRow(interactive, "additions") as RowAnchor;
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
  threads?: ReadonlyArray<Thread>,
): number {
  if (!cursor) return -1;
  if (cursor.kind === "card") {
    for (let i = 0; i < flatRows.length; i++) {
      const r = flatRows[i];
      if (r.kind === "card" && r.commentId === cursor.commentId) return i;
    }
    // ADR 0037 — when the cursor sits on a Reply, the flat stream's
    // Card row is keyed on the Reply's root, not the Reply itself.
    if (threads) {
      const found = findThreadByNode(cursor.commentId, threads);
      if (found && found.nodeIdx > 0) {
        const rootId = found.thread.root.id;
        for (let i = 0; i < flatRows.length; i++) {
          const r = flatRows[i];
          if (r.kind === "card" && r.commentId === rootId) return i;
        }
      }
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
 * Card cursor for a Comment. Used by `n`/`p` comment-nav and by
 * mouse-click on a card. The card itself is the cursor stop — no row
 * synthesis (PRD #192 supersedes the ADR 0011 β-coupling rule).
 * `preferredSide` is threaded so an `h`/`l` choice survives the
 * card stop (ADR 0023 / issue #200).
 */
export function cursorFromComment(
  a: Comment,
  preferredSide: "additions" | "deletions" = "additions",
): CardAnchor {
  return { kind: "card", commentId: a.id, preferredSide };
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
 * the next render drops from the walkable stream (banner dropped by the
 * planner when `gapAbove === 0` per issue #359, expand-down with gap <
 * emit threshold, or the collapsed-file row replaced by the file body).
 * Both surfaces call this helper with the pre-dispatch `flatRows` and
 * the orphan kind to compute a landing on a row that survives the
 * expansion; the caller then dispatches `cursor.set` alongside the
 * `expansion.*` action.
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
 *   directly when emitted (planner emits at `gapAbove > 0` per issue
 *   #359); otherwise `validateCursor` snaps the cursor to the file's
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
    return { kind: "card", commentId: row.commentId, preferredSide };
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
