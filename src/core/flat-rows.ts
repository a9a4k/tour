import type { DiffFile } from "./diff-model.js";
import type {
  PlannedRow,
  InteractiveSubKind,
  BoundaryRef,
} from "./diff-rows.js";

export type { InteractiveSubKind, BoundaryRef };

/**
 * One addressable cursor position on the diff stream. Skips hunk-header and
 * annotation rows; folded files contribute zero entries. The cursor walks
 * this sequence with j/k.
 *
 * Discriminated by `kind`:
 * - `diff` rows back the existing j/k anchor + h/l side toggle on real
 *   source lines.
 * - `interactive` rows (ADR 0013) are non-source affordances the cursor
 *   walks alongside diff rows: hunk-separators, synthetic file-top /
 *   file-bottom boundaries, and classifier-collapsed-file indicators.
 *   Pressing Enter routes to a row-kind-specific handler.
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

export type FlatRow = DiffFlatRow | InteractiveFlatRow;

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
      if (row.kind === "diff-row") {
        const left = row.leftLineNumber;
        const right = row.rightLineNumber;
        const paired = left !== null && right !== null;
        // Pure-deletion rows force the deletions side; everything else
        // (paired rows and pure-additions rows) defaults to additions.
        const side: "additions" | "deletions" =
          right === null && left !== null ? "deletions" : "additions";
        const lineNumber = side === "additions" ? (right as number) : (left as number);
        out.push({
          kind: "diff",
          file: file.name,
          lineNumber,
          side,
          leftLineNumber: left,
          rightLineNumber: right,
          paired,
        });
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
      // hunk-header + annotation rows are not cursor-addressable.
    }
  }
  return out;
}
