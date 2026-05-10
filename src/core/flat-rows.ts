import type { DiffFile } from "./diff-model.js";
import type { PlannedRow } from "./diff-rows.js";

/**
 * One addressable cursor position on the diff stream. Skips hunk-header and
 * annotation rows; folded files contribute zero entries. The cursor walks
 * this sequence with j/k.
 *
 * For paired rows (both line numbers populated) the cursor's effective side
 * is whichever side `preferredSide` selects. For single-side rows the row's
 * `side` is forced.
 */
export interface FlatRow {
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

/**
 * Build a FlatRow from `(file, leftLineNumber, rightLineNumber)`. Shared
 * between the planRows-based walker (TUI + webapp v1) and the DOM-based
 * walker `web/client/cursor-rows.ts` (webapp v2 — handles Pierre
 * `expandUnchanged` chevron-revealed rows). Both surfaces must agree on
 * paired/side/lineNumber semantics so the cursor reducers in
 * `core/cursor-state.ts` resolve identically against either source.
 */
export function flatRowFromLines(
  file: string,
  leftLineNumber: number | null,
  rightLineNumber: number | null,
): FlatRow {
  const paired = leftLineNumber !== null && rightLineNumber !== null;
  // Pure-deletion rows force the deletions side; everything else (paired
  // rows and pure-additions rows) defaults to additions.
  const side: "additions" | "deletions" =
    rightLineNumber === null && leftLineNumber !== null ? "deletions" : "additions";
  const lineNumber =
    side === "additions" ? (rightLineNumber as number) : (leftLineNumber as number);
  return { file, lineNumber, side, leftLineNumber, rightLineNumber, paired };
}

export function flatRows(
  files: DiffFile[],
  plannedRowsByFile: Map<string, PlannedRow[]>,
  isFileFolded: (name: string) => boolean,
): FlatRow[] {
  const out: FlatRow[] = [];
  for (const file of files) {
    if (isFileFolded(file.name)) continue;
    const rows = plannedRowsByFile.get(file.name);
    if (!rows) continue;
    for (const row of rows) {
      if (row.kind !== "diff-row") continue;
      out.push(flatRowFromLines(file.name, row.leftLineNumber, row.rightLineNumber));
    }
  }
  return out;
}
