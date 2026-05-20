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
type FolderRow = Extract<VisibleRow<DiffFile>, { kind: "folder" }>;
type FileRow = Extract<VisibleRow<DiffFile>, { kind: "file" }>;

interface SidebarRowCommonProps {
  isSelected: boolean;
  sidebarFocused: boolean;
  sidebarContentWidth: number;
  onActivate: (event?: SidebarActivationEvent) => void;
}

type SidebarRowTuiProps = SidebarRowCommonProps & (
  | { row: FolderRow; stats?: never }
  | { row: FileRow; stats: FileRowStats }
);

export function SidebarRowTui(props: SidebarRowTuiProps) {
  const { row, isSelected, sidebarFocused, sidebarContentWidth, onActivate } = props;
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
        <text height={1} fg={theme.fg.muted}>
          {leadingText}
        </text>
        <text height={1} fg={theme.fg.muted} selectable={true}>
          {parts.name}
        </text>
        <text height={1} fg={theme.fg.muted}>
          {parts.trailing}
        </text>
      </box>
    );
  }

  const segs = fileRowParts(
    row,
    props.stats,
    sidebarContentWidth - fileRowFixedCost(row, props.stats),
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
      <text height={1} fg={theme.fg.default}>
        {leadingText}
      </text>
      <text height={1} fg={theme.fg.default} selectable={true}>
        {segs.name}
      </text>
      {segs.additions.length > 0 && (
        <text height={1} fg={theme.fg.success}>
          {segs.additions}
        </text>
      )}
      {segs.deletions.length > 0 && (
        <text height={1} fg={theme.fg.danger}>
          {segs.deletions}
        </text>
      )}
      {segs.badge.length > 0 && (
        <text height={1} fg={theme.fg.default}>
          {segs.badge}
        </text>
      )}
      <text height={1} fg={theme.fg.default}>
        {segs.trailing}
      </text>
    </box>
  );
}
