import type { PickerRow } from "../core/tour-list.js";
import { theme } from "../core/theme.js";
import { CURSOR_GLYPH } from "./DiffLine.js";

interface TourPickerProps {
  rows: PickerRow[];
  currentTourId: string | null;
  cursor: number;
}

function rowLabel(r: PickerRow): string {
  const age = r.age.padEnd(10);
  const badge = r.annotationCount > 0 ? `  [${r.annotationCount}]` : "";
  return ` ${r.glyph} ${age}  ${r.title}${badge} `;
}

export function TourPicker({ rows, currentTourId, cursor }: TourPickerProps) {
  return (
    <box
      position="absolute"
      top={2}
      left="10%"
      right="10%"
      bottom={2}
      borderStyle="single"
      borderColor={theme.border.accent}
      title=" Select Tour "
      flexDirection="column"
      zIndex={100}
      backgroundColor={theme.canvas.default}
    >
      <scrollbox height="100%">
        {rows.length === 0 ? (
          <text fg={theme.fg.muted}>{" (no tours) "}</text>
        ) : (
          rows.map((r, i) => {
            const isCurrent = r.id === currentTourId;
            const isCursor = i === cursor;
            // Cursor row: bg.accent.cursor + fg.accent ❯ glyph (universal
            // list-cursor convention — same shape as the diff cursor).
            // Current row: bg.accent.current only, no glyph.
            // ADR 0008 / Issue #57.
            let bg: string | undefined;
            if (isCursor) bg = theme.bg.accentCursor.tui;
            else if (isCurrent) bg = theme.bg.accentCurrent.tui;
            const glyph = isCursor ? CURSOR_GLYPH : " ";
            return (
              <box key={r.id} flexDirection="row">
                <text fg={theme.fg.accent} bg={bg}>{glyph}</text>
                <text fg={theme.fg.default} bg={bg}>{rowLabel(r)}</text>
              </box>
            );
          })
        )}
      </scrollbox>
      <box height={1} paddingX={1}>
        <text fg={theme.fg.muted}>
          {" j/k: move  ·  Enter: select  ·  t/Esc: close "}
        </text>
      </box>
    </box>
  );
}
