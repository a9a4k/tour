import type { Annotation } from "../core/types.js";
import type { ComposerTarget } from "../core/tour-session.js";
import { theme } from "../core/theme.js";
import { shortId } from "../core/ids.js";

interface ComposerProps {
  target: ComposerTarget;
  body: string;
  /**
   * Parent annotation resolved from the live bundle when `target.kind ===
   * "reply"`. Null otherwise. Used purely to render the context label —
   * the slice itself stores only the parent id so the draft survives a
   * bundle refresh.
   */
  parent: Annotation | null;
  onInput: (body: string) => void;
  onSubmit: () => void;
}

function rangeLabel(line_start: number, line_end: number): string {
  return line_start === line_end ? String(line_start) : `${line_start}-${line_end}`;
}

function contextLabel(target: ComposerTarget, parent: Annotation | null): string {
  if (target.kind === "top-level") {
    return ` New annotation · ${target.file}:${rangeLabel(target.line_start, target.line_end)} (${target.side}) `;
  }
  if (parent) {
    return ` Reply to #${shortId(parent.id)} · ${parent.file}:${rangeLabel(parent.line_start, parent.line_end)} (${parent.side}) `;
  }
  return ` Reply to #${shortId(target.replies_to)} `;
}

export function Composer({ target, body, parent, onInput, onSubmit }: ComposerProps) {
  return (
    <box
      position="absolute"
      bottom={1}
      left="10%"
      right="10%"
      borderStyle="single"
      borderColor={theme.border.accent}
      title={contextLabel(target, parent)}
      flexDirection="column"
      zIndex={100}
      backgroundColor={theme.canvas.default}
    >
      <box paddingX={1} paddingTop={1} flexDirection="row">
        <text fg={theme.fg.muted}>{"❯ "}</text>
        <input
          focused
          placeholder="Type your note (markdown supported)…"
          value={body}
          onInput={(v) => onInput(v)}
          onSubmit={() => onSubmit()}
          style={{ flexGrow: 1 }}
        />
      </box>
      <box height={1} paddingX={1}>
        <text fg={theme.fg.muted}>{" Enter: submit  ·  Esc: cancel "}</text>
      </box>
    </box>
  );
}
