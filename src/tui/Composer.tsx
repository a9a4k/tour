import type { Comment } from "../core/types.js";
import type { ComposerSlice, ComposerTarget } from "../core/tour-session.js";
import { theme } from "../core/theme.js";
import { shortId } from "../core/ids.js";

// The full composer slice — the renderer dispatches on `state.kind` to
// show the open / submitting / errored affordances. Pre-fix the App
// rendered only `kind === "open"`; the `errored` branch had no UI so
// failed submits looked like the composer silently vanished (issue #254).
interface ComposerProps {
  state: Exclude<ComposerSlice, { kind: "closed" }>;
  /**
   * Parent comment resolved from the live bundle when `state.target.kind
   * === "reply"`. Null otherwise. Used purely to render the context label —
   * the slice itself stores only the parent id so the draft survives a
   * bundle refresh.
   */
  parent: Comment | null;
  onInput: (body: string) => void;
  onSubmit: () => void;
}

function rangeLabel(line_start: number, line_end: number): string {
  return line_start === line_end ? String(line_start) : `${line_start}-${line_end}`;
}

function contextLabel(target: ComposerTarget, parent: Comment | null): string {
  if (target.kind === "top-level") {
    return ` New comment · ${target.file}:${rangeLabel(target.line_start, target.line_end)} (${target.side}) `;
  }
  if (parent) {
    return ` Reply to #${shortId(parent.id)} · ${parent.file}:${rangeLabel(parent.line_start, parent.line_end)} (${parent.side}) `;
  }
  return ` Reply to #${shortId(target.replies_to)} `;
}

function hintText(state: ComposerProps["state"]): string {
  if (state.kind === "submitting") return " Submitting…  ·  Esc: cancel ";
  if (state.kind === "errored") {
    return ` Error: ${state.error}  ·  Enter: retry  ·  Esc: dismiss `;
  }
  return " Enter: submit  ·  Esc: cancel ";
}

export function Composer({ state, parent, onInput, onSubmit }: ComposerProps) {
  // Errored composer paints a distinct border so the user sees the
  // submit didn't silently vanish — pre-fix the App suppressed the UI
  // entirely on `errored` and the composer disappeared. Issue #254.
  const borderColor =
    state.kind === "errored" ? theme.fg.muted : theme.border.accent;
  const showEditableInput = state.kind === "open";

  return (
    <box
      position="absolute"
      bottom={1}
      left="10%"
      right="10%"
      borderStyle="single"
      borderColor={borderColor}
      title={contextLabel(state.target, parent)}
      flexDirection="column"
      zIndex={100}
      backgroundColor={theme.canvas.default}
    >
      <box paddingX={1} paddingTop={1} flexDirection="row">
        <text fg={theme.fg.muted}>{"❯ "}</text>
        {showEditableInput ? (
          <input
            focused
            placeholder="Type your note (markdown supported)…"
            value={state.body}
            onInput={(v) => onInput(v)}
            onSubmit={() => onSubmit()}
            style={{ flexGrow: 1 }}
          />
        ) : (
          // In submitting / errored states the draft is preserved
          // verbatim and rendered as plain text — keystrokes are routed
          // through the App shell's keymap (retry / dismiss) rather
          // than the focused <input>, so accidental typing can't
          // overwrite the body the user is about to retry with.
          <text>{state.body.length === 0 ? " " : state.body}</text>
        )}
      </box>
      <box height={1} paddingX={1}>
        <text fg={theme.fg.muted}>{hintText(state)}</text>
      </box>
    </box>
  );
}

export type { ComposerProps };
