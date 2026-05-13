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
//
// File rows (issue #265) carry per-file diff stats `+N -M` between the
// filename and the annotation badge — `+N` paints in `theme.fg.success`,
// `-M` in `theme.fg.danger`. To support per-segment colouring the file
// row exposes `fileRowSegments` instead of a single string: the caller
// renders each non-empty segment as its own `<text>` inside a row box.

type FolderRow = Extract<VisibleRow<DiffFile>, { kind: "folder" }>;
type FileRow = Extract<VisibleRow<DiffFile>, { kind: "file" }>;

export interface FileRowStats {
  additions: number;
  deletions: number;
}

export interface FileRowSegments {
  // " ${indent}${icon} ${truncatedName}" — leading space, indent, status
  // icon, single space, middle-truncated name. No trailing whitespace;
  // each subsequent non-empty segment carries its own leading space so
  // omitted segments leave no double-space gap.
  leading: string;
  // " +N" or "" when additions === 0. Paints in theme.fg.success.
  additions: string;
  // " -M" or "" when deletions === 0. Paints in theme.fg.danger.
  deletions: string;
  // " [N]" or "" when annotationCount === 0.
  badge: string;
  // Single trailing space for row padding.
  trailing: string;
}

const LEADING = 1;
const TRAILING = 1;
const CARET_AND_SPACE = 2; // "▾ " or "▸ "
const ICON_AND_SPACE = 2;  // "M " etc.
const INDENT_PER_DEPTH = 2;

function badgeFor(annotationCount: number): string {
  return annotationCount > 0 ? ` [${annotationCount}]` : "";
}

function additionsSegment(additions: number): string {
  return additions > 0 ? ` +${additions}` : "";
}

function deletionsSegment(deletions: number): string {
  return deletions > 0 ? ` -${deletions}` : "";
}

export function folderRowFixedCost(row: FolderRow): number {
  return LEADING + INDENT_PER_DEPTH * row.depth + CARET_AND_SPACE + TRAILING;
}

export function fileRowFixedCost(row: FileRow, stats: FileRowStats): number {
  return (
    LEADING +
    INDENT_PER_DEPTH * row.depth +
    ICON_AND_SPACE +
    additionsSegment(stats.additions).length +
    deletionsSegment(stats.deletions).length +
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

export function fileRowSegments(
  row: FileRow,
  stats: FileRowStats,
  nameBudget: number,
): FileRowSegments {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const icon = statusIcon(row.file.type);
  const name = middleTruncate(row.displayName, Math.max(0, nameBudget));
  return {
    leading: ` ${indent}${icon} ${name}`,
    additions: additionsSegment(stats.additions),
    deletions: deletionsSegment(stats.deletions),
    badge: badgeFor(row.annotationCount),
    trailing: " ",
  };
}
