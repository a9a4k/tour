import type { DiffFile } from "../core/diff-model.js";
import type { VisibleRow } from "../core/file-tree.js";
import { middleTruncate } from "../core/middle-truncate.js";
import { statusIcon } from "./file-entry-label.js";

// Sidebar row label composition. The caller computes the per-row name
// budget (sidebar content width minus the row's fixed decoration cost)
// and passes the integer here; this module knows how to compose the
// decorations and how wide each one is, exposing the fixed-cost
// arithmetic through `folderRowFixedCost` / `fileRowFixedCost` so the
// caller never duplicates the constants.

type FolderRow = Extract<VisibleRow<DiffFile>, { kind: "folder" }>;
type FileRow = Extract<VisibleRow<DiffFile>, { kind: "file" }>;

const LEADING = 1;
const TRAILING = 1;
const CARET_AND_SPACE = 2; // "▾ " or "▸ "
const ICON_AND_SPACE = 2;  // "M " etc.
const INDENT_PER_DEPTH = 2;

function badgeFor(annotationCount: number): string {
  return annotationCount > 0 ? ` [${annotationCount}]` : "";
}

export function folderRowFixedCost(row: FolderRow): number {
  return LEADING + INDENT_PER_DEPTH * row.depth + CARET_AND_SPACE + TRAILING;
}

export function fileRowFixedCost(row: FileRow): number {
  return (
    LEADING +
    INDENT_PER_DEPTH * row.depth +
    ICON_AND_SPACE +
    badgeFor(row.annotationCount).length +
    TRAILING
  );
}

export function folderRowLabel(row: FolderRow, nameBudget: number): string {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const caret = row.collapsed ? "▸" : "▾";
  const name = middleTruncate(row.displayName, Math.max(0, nameBudget));
  return ` ${indent}${caret} ${name} `;
}

export function fileRowLabel(row: FileRow, nameBudget: number): string {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const icon = statusIcon(row.file.type);
  const badge = badgeFor(row.annotationCount);
  const name = middleTruncate(row.displayName, Math.max(0, nameBudget));
  return ` ${indent}${icon} ${name}${badge} `;
}
