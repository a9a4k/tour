import type { ReactElement, ReactNode } from "react";
import { theme } from "../core/theme.js";

// Issue #263 — terminal-native equivalent of the webapp #249 per-file
// card. The webapp wraps each file in a 1px `border.muted` rounded
// card with 16px margin so the eye anchors on file boundaries. The TUI
// has a single outer `┌─ Diff ─┐` box wrapping all files; a horizontal
// `─` (U+2500 BOX DRAWINGS LIGHT HORIZONTAL) rule in `theme.border.muted`
// between consecutive files inside the diff pane carries the same
// signal. LIGHT weight matches the LIGHT `│` from #258.
const RULE_GLYPH = "─";
// 2000 cols is wide enough for any practical terminal; the surrounding
// 100%-width box clips overflow. `wrapMode="none"` prevents the long
// string from wrapping to a second line.
const RULE_LENGTH = 2000;

// FileSeparator owns two rows: the rule line and a 1-row blank below.
// The file-card above carries `marginBottom={1}`, which supplies the
// blank row above the rule. The composition reads as:
//   ... last row of file A
//   [blank from file-card marginBottom]
//   ─────
//   [blank from FileSeparator]
//   first row of file B
// Reviewer sees 1 blank above, rule, 1 blank below. Brief AC3 ✓.
export function FileSeparator(): ReactElement {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} width="100%">
        <text fg={theme.border.muted} wrapMode="none">
          {RULE_GLYPH.repeat(RULE_LENGTH)}
        </text>
      </box>
      <box height={1} />
    </box>
  );
}

// Interleaves a `<FileSeparator />` between every consecutive pair of
// rendered file cards. No separator before the first file or after the
// last. Single-file and empty file lists pass through with no
// separator. Brief AC4 + AC5 ✓.
export function withFileSeparators<T extends { name: string }>(
  files: readonly T[],
  renderCard: (file: T, index: number) => ReactElement,
): ReactNode[] {
  const out: ReactNode[] = [];
  files.forEach((file, i) => {
    out.push(renderCard(file, i));
    if (i < files.length - 1) {
      out.push(<FileSeparator key={`file-separator-${file.name}`} />);
    }
  });
  return out;
}
