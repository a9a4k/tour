import type { DiffFile } from "./diff-model.js";
import type {
  PlannedRow,
  InteractiveSubKind,
  BoundaryRef,
} from "./diff-rows.js";

export type { InteractiveSubKind, BoundaryRef };

/**
 * One addressable cursor position on the diff stream. The cursor walks
 * this sequence via two lanes — `j`/`k` steps row-kind entries (diff +
 * interactive), `n`/`p` steps card-kind entries (PRD #192 / ADR 0022).
 *
 * Discriminated by `kind`:
 * - `diff` rows back the existing j/k anchor + h/l side toggle on real
 *   source lines.
 * - `interactive` rows (ADR 0013) are non-source affordances the cursor
 *   walks alongside diff rows: hunk-separators, synthetic file-top /
 *   file-bottom boundaries, and classifier-collapsed-file indicators.
 *   Pressing Enter routes to a row-kind-specific handler.
 * - `card` rows (PRD #192) are Comment cards — addressed by
 *   `commentId`. `r` / `s` dispatch only when the cursor sits on a
 *   card; `c` is suppressed on a card.
 *
 * For paired diff rows (both line numbers populated) the cursor's
 * effective side is whichever side `preferredSide` selects. For single-
 * side rows the row's `side` is forced. Interactive rows carry no `side`
 * or `lineNumber` — they are addressed by `(file, subKind, boundaryRef)`.
 */
export interface DiffFlatRow {
  kind: "diff";
  file: string;
  /** Line number on the row's natural side. For paired rows defaults to the
   *  additions side. */
  lineNumber: number;
  /** Natural side of this row. For paired rows: "additions". For pure
   *  add/del rows: forced to the populated side. */
  side: "additions" | "deletions";
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  /** Both line numbers populated → user can toggle side via h/l. */
  paired: boolean;
}

export interface InteractiveFlatRow {
  kind: "interactive";
  file: string;
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
}

/**
 * Comment-card cursor stop (PRD #192 / ADR 0022). Emitted directly
 * after the diff row the card's comment anchors to (`line_end` on
 * `side`). Multiple cards at the same anchor stack in `created_at` order
 * (the planner's interleave step already enforces that — see
 * `interleaveComments` in `diff-rows.ts`).
 */
export interface CardFlatRow {
  kind: "card";
  file: string;
  side: "additions" | "deletions";
  /** Anchor line (`comment.line_end` on `comment.side`) — lets the
   *  renderer find the card's anchor row when the cursor is on the card. */
  lineEnd: number;
  commentId: string;
}

export type FlatRow = DiffFlatRow | InteractiveFlatRow | CardFlatRow;

/** Options for `flatRows`. */
export interface FlatRowsOptions {
  /** Vestigial. Issue #280 brought the hunk-header banner back as a
   *  cursor stop on both surfaces, and issue #359 made every emitted
   *  banner cursor-walkable. The option is kept for caller-side
   *  compatibility (TUI passes `false`); the value is now ignored. */
  hunkHeaderCursorStop?: boolean;
}

/**
 * Build a DiffFlatRow from `(file, leftLineNumber, rightLineNumber)`. Used
 * by `flatRows` to project the planner's `PlannedRow[]` into the cursor's
 * walkable sequence on both surfaces. Paired/side/lineNumber semantics
 * agree with `core/cursor-state.ts`'s anchor resolution.
 */
export function flatRowFromLines(
  file: string,
  leftLineNumber: number | null,
  rightLineNumber: number | null,
): DiffFlatRow {
  const paired = leftLineNumber !== null && rightLineNumber !== null;
  // Pure-deletion rows force the deletions side; everything else (paired
  // rows and pure-additions rows) defaults to additions.
  const side: "additions" | "deletions" =
    rightLineNumber === null && leftLineNumber !== null ? "deletions" : "additions";
  const lineNumber =
    side === "additions" ? (rightLineNumber as number) : (leftLineNumber as number);
  return {
    kind: "diff",
    file,
    lineNumber,
    side,
    leftLineNumber,
    rightLineNumber,
    paired,
  };
}

export function flatRows(
  files: DiffFile[],
  plannedRowsByFile: Map<string, PlannedRow[]>,
  isFileFolded: (name: string) => boolean,
  options: FlatRowsOptions = {},
): FlatRow[] {
  // `options.hunkHeaderCursorStop` is accepted but unused — PRD #270
  // Slices 2 & 3 collapsed both surfaces onto unconditional skip.
  void options;
  const out: FlatRow[] = [];
  for (const file of files) {
    if (isFileFolded(file.name)) continue;
    const rows = plannedRowsByFile.get(file.name);
    if (!rows) continue;
    for (const row of rows) {
      if (row.kind === "diff-row") {
        out.push(flatRowFromLines(file.name, row.leftLineNumber, row.rightLineNumber));
        continue;
      }
      if (row.kind === "interactive") {
        out.push({
          kind: "interactive",
          file: file.name,
          subKind: row.subKind,
          boundaryRef: row.boundaryRef,
        });
        continue;
      }
      if (row.kind === "hunk-header") {
        // Issue #280: the banner's left cell hosts the primary expand
        // affordance (`primaryExpand: "up" | "all"`); the cursor walks
        // the row. Identity uses the existing `boundary-top` (file-top,
        // hunkIndex 0) / `hunk-separator` (mid-file) subkinds so existing
        // matching logic in FileBlock + TUI cursor visuals composes
        // unchanged. Issue #359: the planner skips emission entirely
        // when `gapAbove === 0`, so every hunk-header row reaching this
        // branch is cursor-walkable.
        const subKind: InteractiveSubKind =
          row.hunkIndex === 0 ? "boundary-top" : "hunk-separator";
        const boundaryRef: BoundaryRef =
          row.hunkIndex === 0 ? "top" : row.hunkIndex;
        out.push({
          kind: "interactive",
          file: file.name,
          subKind,
          boundaryRef,
        });
        continue;
      }
      if (row.kind === "comment") {
        // Comment cards are first-class cursor stops in the unified
        // cursor model (PRD #192). The planner's interleave step has
        // already placed the comment row directly after its anchor
        // diff row; we mirror that placement into the flat stream so
        // the row-index lookup unifies for rows and cards.
        out.push({
          kind: "card",
          file: file.name,
          side: row.comment.side,
          lineEnd: row.comment.line_end,
          commentId: row.comment.id,
        });
        continue;
      }
    }
  }
  return out;
}
