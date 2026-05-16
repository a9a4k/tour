import type { TextareaRenderable } from "@opentui/core";
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

// Issue #391: the open composer uses a multi-line <textarea> instead of
// the legacy single-line <input>. Two reasons:
//  1. EditBufferRenderable's `scrollMargin` defaults to 0.2 (a fraction of
//     viewport width), so on a ~74-col composer ~15 cols of right-edge
//     space sit unused while the visible text scrolls left. `scrollMargin:
//     0` + `wrapMode: "word"` together fill the full inner width before
//     any scroll happens.
//  2. The <input> is height-1 and binds Enter to submit. Multi-paragraph
//     markdown notes need Enter to insert a newline and a distinct chord
//     to submit. The default textarea keybindings already bind Enter to
//     `newline`; we add a Ctrl+S → `submit` override on top.
const COMPOSER_TEXTAREA_HEIGHT = 4;

// Custom submit chord. Ctrl+S is terminal-portable (no meta/super
// required), and bare `s` is no longer bound anywhere in the TUI keymap
// (issue #390 retired the legacy `s: send to agent` binding), so muscle
// memory doesn't collide. Surface this in the hint row so a first-time
// reader doesn't have to guess.
const COMPOSER_SUBMIT_BINDINGS = [
  { name: "s", ctrl: true, action: "submit" as const },
];

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
  return " Ctrl+S: submit  ·  Enter: newline  ·  Esc: cancel ";
}

export function Composer({ state, parent, onInput, onSubmit }: ComposerProps) {
  // Errored composer paints a distinct border so the user sees the
  // submit didn't silently vanish — pre-fix the App suppressed the UI
  // entirely on `errored` and the composer disappeared. Issue #254.
  const borderColor =
    state.kind === "errored" ? theme.fg.muted : theme.border.accent;
  const showEditableInput = state.kind === "open";

  // Ref into the live TextareaRenderable so we can read `plainText` on
  // every content change. opentui's `onContentChange` event payload is
  // empty by design (the buffer is the source of truth); the ref + getter
  // is the documented read path. A callback-ref-into-a-closure-holder
  // (rather than `useRef`) keeps the Composer hook-free so the unit tests
  // can call it as a plain function without a React renderer fixture.
  const textareaRef: { current: TextareaRenderable | null } = { current: null };

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
          <textarea
            ref={(r) => {
              textareaRef.current = r;
            }}
            focused
            placeholder="Type your note (markdown supported, Enter = newline)…"
            initialValue={state.body}
            wrapMode="word"
            scrollMargin={0}
            keyBindings={COMPOSER_SUBMIT_BINDINGS}
            onContentChange={() => {
              const ta = textareaRef.current;
              if (ta) onInput(ta.plainText);
            }}
            onSubmit={() => {
              // Flush the latest text through the slice before the
              // submit action lands — the dispatcher reads `state.body`,
              // and a fast Ctrl+S right after the last keystroke can
              // race the onContentChange callback.
              const ta = textareaRef.current;
              if (ta) onInput(ta.plainText);
              onSubmit();
            }}
            style={{ flexGrow: 1, height: COMPOSER_TEXTAREA_HEIGHT }}
          />
        ) : (
          // In submitting / errored states the draft is preserved
          // verbatim and rendered as plain text — keystrokes are routed
          // through the App shell's keymap (retry / dismiss) rather
          // than the focused editor, so accidental typing can't
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
