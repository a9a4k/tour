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
      const left = row.leftLineNumber;
      const right = row.rightLineNumber;
      const paired = left !== null && right !== null;
      // Pure-deletion rows force the deletions side; everything else
      // (paired rows and pure-additions rows) defaults to additions.
      const side: "additions" | "deletions" =
        right === null && left !== null ? "deletions" : "additions";
      const lineNumber = side === "additions" ? (right as number) : (left as number);
      out.push({
        file: file.name,
        lineNumber,
        side,
        leftLineNumber: left,
        rightLineNumber: right,
        paired,
      });
    }
  }
  return out;
}
