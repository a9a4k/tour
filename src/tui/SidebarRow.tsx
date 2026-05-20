import type { MouseEvent } from "@opentui/core";
import type { DiffFile } from "../core/diff-model.js";
import type { VisibleRow } from "../core/file-tree.js";
import { theme } from "../core/theme.js";
import { CURSOR_FG, CURSOR_GLYPH } from "./DiffLine.js";
import { sidebarCursorPaint } from "./sidebar-cursor-paint.js";
import {
  fileRowFixedCost,
  fileRowParts,
  folderRowFixedCost,
  folderRowParts,
  type FileRowStats,
} from "./sidebar-row-label.js";
import { textSelectionSafeActivation } from "./text-selection-gesture.js";

type SidebarActivationEvent = Pick<MouseEvent, "stopPropagation">;

interface SidebarRowTuiProps {
  row: VisibleRow<DiffFile>;
  isSelected: boolean;
  sidebarFocused: boolean;
  sidebarContentWidth: number;
  stats: FileRowStats;
  onActivate: (event?: SidebarActivationEvent) => void;
}

export function SidebarRowTui({
  row,
  isSelected,
  sidebarFocused,
  sidebarContentWidth,
  stats,
  onActivate,
}: SidebarRowTuiProps) {
  const { bg, showGlyph } = sidebarCursorPaint({ isSelected, sidebarFocused });
  const rowMouseHandlers = textSelectionSafeActivation(onActivate);

  if (row.kind === "folder") {
    const parts = folderRowParts(row, sidebarContentWidth - folderRowFixedCost(row));
    const leadingText = showGlyph ? parts.leading.slice(1) : parts.leading;
    return (
      <box
        key={`d:${row.path}`}
        id={`row-${row.path}`}
        flexDirection="row"
        backgroundColor={bg}
        onMouseDown={rowMouseHandlers.onMouseDown}
        onMouseDrag={rowMouseHandlers.onMouseDrag}
        onMouseUp={rowMouseHandlers.onMouseUp}
      >
        {showGlyph && (
          <text height={1} fg={CURSOR_FG} selectable={false}>{CURSOR_GLYPH}</text>
        )}
        <text height={1} fg={theme.fg.muted} selectable={false}>
          {leadingText}
        </text>
        <text height={1} fg={theme.fg.muted} selectable={true}>
          {parts.name}
        </text>
        <text height={1} fg={theme.fg.muted} selectable={false}>
          {parts.trailing}
        </text>
      </box>
    );
  }

  const segs = fileRowParts(
    row,
    stats,
    sidebarContentWidth - fileRowFixedCost(row, stats),
  );
  const leadingText = showGlyph ? segs.leading.slice(1) : segs.leading;

  return (
    <box
      key={`f:${row.path}`}
      id={`row-${row.path}`}
      flexDirection="row"
      backgroundColor={bg}
      onMouseDown={rowMouseHandlers.onMouseDown}
      onMouseDrag={rowMouseHandlers.onMouseDrag}
      onMouseUp={rowMouseHandlers.onMouseUp}
    >
      {showGlyph && (
        <text height={1} fg={CURSOR_FG} selectable={false}>{CURSOR_GLYPH}</text>
      )}
      <text height={1} fg={theme.fg.default} selectable={false}>
        {leadingText}
      </text>
      <text height={1} fg={theme.fg.default} selectable={true}>
        {segs.name}
      </text>
      {segs.additions.length > 0 && (
        <text height={1} fg={theme.fg.success} selectable={false}>
          {segs.additions}
        </text>
      )}
      {segs.deletions.length > 0 && (
        <text height={1} fg={theme.fg.danger} selectable={false}>
          {segs.deletions}
        </text>
      )}
      {segs.badge.length > 0 && (
        <text height={1} fg={theme.fg.default} selectable={false}>
          {segs.badge}
        </text>
      )}
      <text height={1} fg={theme.fg.default} selectable={false}>
        {segs.trailing}
      </text>
    </box>
  );
}
