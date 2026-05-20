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
// filename and the comment badge — `+N` paints in `theme.fg.success`,
// `-M` in `theme.fg.danger`. The segment APIs keep decoration, name,
// stats, and padding as separate strings so callers can independently
// colour stats and mark only the user-facing name selectable.

type FolderRow = Extract<VisibleRow<DiffFile>, { kind: "folder" }>;
type FileRow = Extract<VisibleRow<DiffFile>, { kind: "file" }>;

export interface FileRowStats {
  additions: number;
  deletions: number;
}

export interface FileRowSegments {
  // " ${indent}${icon} ${truncatedName}" — compatibility shape for callers
  // that still render decoration and name as one segment. No trailing
  // whitespace; each subsequent non-empty segment carries its own leading
  // space so omitted segments leave no double-space gap.
  leading: string;
  // " +N" or "" when additions === 0. Paints in theme.fg.success.
  additions: string;
  // " -M" or "" when deletions === 0. Paints in theme.fg.danger.
  deletions: string;
  // " [N]" or "" when commentCount === 0.
  badge: string;
  // Single trailing space for row padding.
  trailing: string;
}

export interface FolderRowParts {
  // " ${indent}${caret} " — row padding, tree indentation, and folder caret.
  leading: string;
  // Middle-truncated display name; this is the selectable content segment.
  name: string;
  // Single trailing space for row padding.
  trailing: string;
}

export interface FileRowParts {
  // " ${indent}${icon} " — row padding, tree indentation, and status icon.
  leading: string;
  // Middle-truncated display name; this is the selectable content segment.
  name: string;
  // " +N" or "" when additions === 0. Paints in theme.fg.success.
  additions: string;
  // " -M" or "" when deletions === 0. Paints in theme.fg.danger.
  deletions: string;
  // " [N]" or "" when commentCount === 0.
  badge: string;
  // Single trailing space for row padding.
  trailing: string;
}

const LEADING = 1;
const TRAILING = 1;
const CARET_AND_SPACE = 2; // "▾ " or "▸ "
const ICON_AND_SPACE = 2;  // "M " etc.
// Issue #312: dropped from 2 → 1. With a depth-5 monorepo the prior
// `2 * depth` ate 10 of 28 usable sidebar cols; halving the indent
// is the only knob that helps when the 40% terminal-width cap binds
// (narrow terminals + deep trees). The constant stays static — a
// dynamic per-tour indent would optimise the comfortable case at
// the cost of an API change to four exported functions.
const INDENT_PER_DEPTH = 1;

function badgeFor(commentCount: number): string {
  return commentCount > 0 ? ` [${commentCount}]` : "";
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
    badgeFor(row.commentCount).length +
    TRAILING
  );
}

export function folderRowLabel(row: FolderRow, nameBudget: number): string {
  const parts = folderRowParts(row, nameBudget);
  return parts.leading + parts.name + parts.trailing;
}

export function folderRowParts(row: FolderRow, nameBudget: number): FolderRowParts {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const caret = row.collapsed ? "▸" : "▾";
  const name = middleTruncate(row.displayName, Math.max(0, nameBudget));
  return {
    leading: ` ${indent}${caret} `,
    name,
    trailing: " ",
  };
}

export function fileRowSegments(
  row: FileRow,
  stats: FileRowStats,
  nameBudget: number,
): FileRowSegments {
  const parts = fileRowParts(row, stats, nameBudget);
  return {
    leading: parts.leading + parts.name,
    additions: parts.additions,
    deletions: parts.deletions,
    badge: parts.badge,
    trailing: parts.trailing,
  };
}

export function fileRowParts(
  row: FileRow,
  stats: FileRowStats,
  nameBudget: number,
): FileRowParts {
  const indent = " ".repeat(INDENT_PER_DEPTH * row.depth);
  const icon = statusIcon(row.file.type);
  const name = middleTruncate(row.displayName, Math.max(0, nameBudget));
  return {
    leading: ` ${indent}${icon} `,
    name,
    additions: additionsSegment(stats.additions),
    deletions: deletionsSegment(stats.deletions),
    badge: badgeFor(row.commentCount),
    trailing: " ",
  };
}
