import type { DiffFile } from "../core/diff-model.js";
import type { VisibleRow } from "../core/file-tree.js";
import { middleTruncate } from "../core/middle-truncate.js";
import { statusIcon } from "./file-entry-label.js";

// Sidebar row label composition (issue #156). The name slot is middle-
// truncated to a budget derived by the caller; everything else (leading
// space, indent, caret / status icon, annotation badge, trailing space)
// stays in shape. `sidebarContentWidth` is the total available width inside
// the sidebar box (sidebar width minus borders); the per-row fixed costs
// are subtracted here so callers stay decoupled from box-chrome details.

const LEADING = 1;
const TRAILING = 1;
const CARET_AND_SPACE = 2; // "▾ " or "▸ "
const ICON_AND_SPACE = 2;  // "M " etc.
const INDENT_PER_DEPTH = 2;

function badgeFor(annotationCount: number): string {
  return annotationCount > 0 ? ` [${annotationCount}]` : "";
}

export function folderRowLabel(
  row: Extract<VisibleRow<DiffFile>, { kind: "folder" }>,
  sidebarContentWidth: number,
): string {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const caret = row.collapsed ? "▸" : "▾";
  const fixed = LEADING + indent.length + CARET_AND_SPACE + TRAILING;
  const nameBudget = Math.max(0, sidebarContentWidth - fixed);
  const name = middleTruncate(row.displayName, nameBudget);
  return ` ${indent}${caret} ${name} `;
}

export function fileRowLabel(
  row: Extract<VisibleRow<DiffFile>, { kind: "file" }>,
  sidebarContentWidth: number,
): string {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const icon = statusIcon(row.file.type);
  const badge = badgeFor(row.annotationCount);
  const fixed = LEADING + indent.length + ICON_AND_SPACE + badge.length + TRAILING;
  const nameBudget = Math.max(0, sidebarContentWidth - fixed);
  const name = middleTruncate(row.displayName, nameBudget);
  return ` ${indent}${icon} ${name}${badge} `;
}
