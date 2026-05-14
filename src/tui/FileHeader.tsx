import type { ReactElement } from "react";
import { theme } from "../core/theme.js";

// Per-file file-header row at the top of each diff-pane file card
// (issue #297). Hosts the static file label on the left and a clickable
// `↕` Expand-all-hidden affordance on the right when the file has at
// least 2 distinct hidden gaps (issue #298) — mirroring the web's
// file-header chrome (per issue #274) and replacing the now-retired
// standalone `expand-file-all` planner row. Single-gap files don't
// render the chrome cell: the per-hunk banner button (or standalone
// `expand-down` row for file-bottom) is already the right granularity
// and a chrome `↕` next to it would just stack a redundant duplicate.
//
// Mouse: clicking the `↕` button dispatches `expand-file-all` for this
// file. Keyboard: the file-header itself is not a diff-pane cursor stop;
// the `e` keymap binding on any diff-pane cursor inside the file is the
// keyboard path to the same dispatch — unchanged by #298 (the binding
// stays useful any time there's something to expand; the chrome is the
// discoverability surface, `e` is the power-user shortcut).
export const EXPAND_ALL_GLYPH = "↕";

export function fileHeaderExpandAllId(fileName: string): string {
  return `file-header-expand-all-${fileName}`;
}

interface FileHeaderProps {
  fileName: string;
  label: string;
  hasMultipleHiddenGaps: boolean;
  onExpandAll?: (fileName: string) => void;
}

export function FileHeader(props: FileHeaderProps): ReactElement {
  const { fileName, label, hasMultipleHiddenGaps, onExpandAll } = props;
  const onMouseDown = onExpandAll ? () => onExpandAll(fileName) : undefined;
  return (
    <box flexDirection="row" width="100%">
      <box flexGrow={1}>
        <text>{label}</text>
      </box>
      {hasMultipleHiddenGaps && (
        <box
          id={fileHeaderExpandAllId(fileName)}
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={onMouseDown}
        >
          <text fg={theme.fg.muted}>{EXPAND_ALL_GLYPH}</text>
        </box>
      )}
    </box>
  );
}
