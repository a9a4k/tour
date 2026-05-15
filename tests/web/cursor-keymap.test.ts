import { describe, it, expect } from "vitest";
import {
  dispatchCursorKey,
  type CursorKeymapContext,
  type KeyEvent,
} from "../../src/web/client/cursor-keymap.js";

const baseCtx: CursorKeymapContext = {
  composerOpen: false,
  pickerOpen: false,
  focusInEditable: false,
  cursorOnCard: false,
  cursorOnHumanCard: false,
  replyLockHeld: false,
};

const cardCtx: CursorKeymapContext = {
  ...baseCtx,
  cursorOnCard: true,
  cursorOnHumanCard: true,
};

const key = (over: Partial<KeyEvent> & Pick<KeyEvent, "key">): KeyEvent => ({
  key: over.key,
  shiftKey: over.shiftKey ?? false,
  metaKey: over.metaKey ?? false,
  ctrlKey: over.ctrlKey ?? false,
  altKey: over.altKey ?? false,
});

describe("dispatchCursorKey: motion", () => {
  it("j → move-down", () => {
    expect(dispatchCursorKey(key({ key: "j" }), baseCtx)).toEqual({ type: "move-down" });
  });

  it("k → move-up", () => {
    expect(dispatchCursorKey(key({ key: "k" }), baseCtx)).toEqual({ type: "move-up" });
  });

  it("ArrowDown → move-down", () => {
    expect(dispatchCursorKey(key({ key: "ArrowDown" }), baseCtx)).toEqual({ type: "move-down" });
  });

  it("ArrowUp → move-up", () => {
    expect(dispatchCursorKey(key({ key: "ArrowUp" }), baseCtx)).toEqual({ type: "move-up" });
  });
});

describe("dispatchCursorKey: side selection", () => {
  it("h → set-side-deletions", () => {
    expect(dispatchCursorKey(key({ key: "h" }), baseCtx)).toEqual({
      type: "set-side-deletions",
    });
  });

  it("l → set-side-additions (lowercase l is reserved for cursor side)", () => {
    expect(dispatchCursorKey(key({ key: "l" }), baseCtx)).toEqual({
      type: "set-side-additions",
    });
  });

  it("ArrowLeft → set-side-deletions", () => {
    expect(dispatchCursorKey(key({ key: "ArrowLeft" }), baseCtx)).toEqual({
      type: "set-side-deletions",
    });
  });

  it("ArrowRight → set-side-additions", () => {
    expect(dispatchCursorKey(key({ key: "ArrowRight" }), baseCtx)).toEqual({
      type: "set-side-additions",
    });
  });
});

describe("dispatchCursorKey: layout rebind", () => {
  it("Shift-L → toggle-layout (the new binding)", () => {
    expect(dispatchCursorKey(key({ key: "L", shiftKey: true }), baseCtx)).toEqual({
      type: "toggle-layout",
    });
  });

  it("lowercase l no longer toggles layout — it sets the cursor side", () => {
    const a = dispatchCursorKey(key({ key: "l" }), baseCtx);
    expect(a).not.toEqual({ type: "toggle-layout" });
    expect(a).toEqual({ type: "set-side-additions" });
  });
});

describe("dispatchCursorKey: comment-at-cursor", () => {
  it("c on a row cursor → comment-at-cursor (App-side handler materializes the cursor on null)", () => {
    expect(dispatchCursorKey(key({ key: "c" }), baseCtx)).toEqual({
      type: "comment-at-cursor",
    });
  });

  it("c on a card cursor → noop (PRD #192 / ADR 0022 — `c` is row-only)", () => {
    expect(dispatchCursorKey(key({ key: "c" }), cardCtx)).toEqual({
      type: "noop",
    });
  });

  // PRD #335 / ADR 0029 hard cutover: bare `a` is unbound. No alias.
  it("bare a → noop (PRD #335 / ADR 0029 — `a` is unbound after the rebind)", () => {
    expect(dispatchCursorKey(key({ key: "a" }), baseCtx)).toEqual({
      type: "noop",
    });
    expect(dispatchCursorKey(key({ key: "a" }), cardCtx)).toEqual({
      type: "noop",
    });
  });
});

describe("dispatchCursorKey: r / s gated by cursor row kind (PRD #192)", () => {
  it("r on a card cursor → open-reply-on-card", () => {
    expect(dispatchCursorKey(key({ key: "r" }), cardCtx)).toEqual({
      type: "open-reply-on-card",
    });
  });

  it("s on a human card with no lock and reply-agent configured → send-on-card", () => {
    expect(
      dispatchCursorKey(key({ key: "s" }), { ...cardCtx, replyAgent: "claude" }),
    ).toEqual({ type: "send-on-card" });
  });

  it("s on a card cursor with no reply-agent configured → noop (hidden silent — legend hides the hint too)", () => {
    expect(dispatchCursorKey(key({ key: "s" }), cardCtx)).toEqual({
      type: "noop",
    });
  });

  it("r / s still fire when composer is open (no card-aware suppression needed — composer route owns its own gate)", () => {
    // The keymap doesn't know whether a card composer is open; the App-side
    // handler is responsible for that. Here we simply confirm the dispatcher
    // doesn't treat composerOpen as a card-action suppressor (consistent
    // with how n/p/L/T survive composer-open).
    const ctx: CursorKeymapContext = {
      ...cardCtx,
      composerOpen: true,
      replyAgent: "claude",
    };
    expect(dispatchCursorKey(key({ key: "r" }), ctx)).toEqual({
      type: "open-reply-on-card",
    });
    expect(dispatchCursorKey(key({ key: "s" }), ctx)).toEqual({
      type: "send-on-card",
    });
  });
});

describe("dispatchCursorKey: r / s miss reasons surface as status (PRD #330)", () => {
  // ADR 0028 / PRD #330: cross-axis misses on the webapp footer flash a
  // reason via the transient status slot. The keymap emits the message; the
  // App-side handler routes it into setFooterStatus with a ~2s auto-dismiss.
  // PRD #335 / ADR 0029 flipped "annotation" → "comment" in these strings.

  it("r on a diff-row cursor → status `No comment under cursor.`", () => {
    expect(dispatchCursorKey(key({ key: "r" }), baseCtx)).toEqual({
      type: "status",
      message: "No comment under cursor.",
    });
  });

  it("s on a diff-row cursor with reply-agent configured → status `Send only works on comment cards.`", () => {
    expect(
      dispatchCursorKey(key({ key: "s" }), { ...baseCtx, replyAgent: "claude" }),
    ).toEqual({
      type: "status",
      message: "Send only works on comment cards.",
    });
  });

  it("s on a non-human (agent) card → status `Send only works on human comments.`", () => {
    const agentCardCtx: CursorKeymapContext = {
      ...baseCtx,
      cursorOnCard: true,
      cursorOnHumanCard: false,
      replyAgent: "claude",
    };
    expect(dispatchCursorKey(key({ key: "s" }), agentCardCtx)).toEqual({
      type: "status",
      message: "Send only works on human comments.",
    });
  });

  it("s on a human card while the reply-lock is held → status `<agent> is already replying.`", () => {
    const lockedCtx: CursorKeymapContext = {
      ...cardCtx,
      replyAgent: "claude",
      replyLockHeld: true,
    };
    expect(dispatchCursorKey(key({ key: "s" }), lockedCtx)).toEqual({
      type: "status",
      message: "claude is already replying.",
    });
  });
});

describe("dispatchCursorKey: comment navigation (β-coupling)", () => {
  // β-coupling per ADR 0012 (mirrors ADR 0011): the keymap classifies
  // n/p as nav-next/prev-comment; the App-side handler routes the
  // dispatch to navigateBy, which calls setCursor(cursorFromComment
  // (target)) so the line cursor materializes at the navigated-to
  // anchor on the same keystroke. The asymmetric rule is enforced
  // here at the dispatcher: motion keys (j/k/h/l/arrows) classify as
  // move-*/set-side-* — never as nav-* — so j/k/h/l never touch
  // currentCommentId (App handler reads action.type).
  it("n → nav-next-comment", () => {
    expect(dispatchCursorKey(key({ key: "n" }), baseCtx)).toEqual({
      type: "nav-next-comment",
    });
  });

  it("p → nav-prev-comment", () => {
    expect(dispatchCursorKey(key({ key: "p" }), baseCtx)).toEqual({
      type: "nav-prev-comment",
    });
  });

  it("T (Shift+t) → open-picker", () => {
    expect(dispatchCursorKey(key({ key: "T", shiftKey: true }), baseCtx)).toEqual({
      type: "open-picker",
    });
  });

  // PRD #335 / ADR 0029 + ADR 0030 promoted `t → T` so the global-state
  // binding follows the lowercase=cursor / capital=global rule. Bare `t`
  // is now unbound — hard cutover, no alias.
  it("bare t → noop (PRD #335 / ADR 0030 — picker promoted to capital T)", () => {
    expect(dispatchCursorKey(key({ key: "t" }), baseCtx)).toEqual({
      type: "noop",
    });
  });

  it("j / k / h / l / arrows never classify as nav-* (the asymmetric β-rule)", () => {
    // The reverse direction stays decoupled — line motion does NOT
    // change currentCommentId. Dispatcher-level guard: a motion key
    // never routes through the nav-next/prev path.
    const motionKeys = ["j", "k", "h", "l", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    for (const k of motionKeys) {
      const a = dispatchCursorKey(key({ key: k }), baseCtx);
      expect(a.type).not.toBe("nav-next-comment");
      expect(a.type).not.toBe("nav-prev-comment");
    }
  });
});

describe("dispatchCursorKey: suppression rules", () => {
  it("focus in editable element → all cursor keys noop", () => {
    const ctx = { ...baseCtx, focusInEditable: true };
    for (const k of ["j", "k", "h", "l", "ArrowDown", "ArrowUp", "c", "n", "p"]) {
      expect(dispatchCursorKey(key({ key: k }), ctx)).toEqual({ type: "noop" });
    }
    expect(
      dispatchCursorKey(key({ key: "L", shiftKey: true }), ctx),
    ).toEqual({ type: "noop" });
    expect(
      dispatchCursorKey(key({ key: "T", shiftKey: true }), ctx),
    ).toEqual({ type: "noop" });
  });

  it("picker open → all keys noop (picker owns input)", () => {
    const ctx = { ...baseCtx, pickerOpen: true };
    for (const k of ["j", "k", "h", "l", "n", "p", "c"]) {
      expect(dispatchCursorKey(key({ key: k }), ctx)).toEqual({ type: "noop" });
    }
    expect(
      dispatchCursorKey(key({ key: "L", shiftKey: true }), ctx),
    ).toEqual({ type: "noop" });
    expect(
      dispatchCursorKey(key({ key: "T", shiftKey: true }), ctx),
    ).toEqual({ type: "noop" });
  });

  it("composer open → motion keys noop, but n/p/L/T/c still dispatch", () => {
    const ctx = { ...baseCtx, composerOpen: true };
    // j/k/h/l/arrows go inert so the textarea owns them
    expect(dispatchCursorKey(key({ key: "j" }), ctx)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "k" }), ctx)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "h" }), ctx)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "l" }), ctx)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "ArrowDown" }), ctx)).toEqual({ type: "noop" });
    // Comment nav and layout still work (matches focusInEditable being
    // false — the textarea handles its own focus suppression separately).
    expect(dispatchCursorKey(key({ key: "n" }), ctx)).toEqual({
      type: "nav-next-comment",
    });
  });

  // PRD #349 / ADR 0032 / issue #353: `o` fires when the composer is
  // open (mid-compose fact-checking) but is suppressed by picker and
  // editable-focus like every other action key. Modifier guards also
  // apply (Ctrl/Cmd/Alt/Shift+O → noop so browser shortcuts are
  // unaffected).
  it("o → open-in-editor on a row cursor in diff mode", () => {
    expect(dispatchCursorKey(key({ key: "o" }), baseCtx)).toEqual({
      type: "open-in-editor",
    });
  });

  it("o still fires when the composer is open (above the composer-open gate)", () => {
    const ctx = { ...baseCtx, composerOpen: true };
    expect(dispatchCursorKey(key({ key: "o" }), ctx)).toEqual({
      type: "open-in-editor",
    });
  });

  it("o is suppressed when the picker is open", () => {
    const ctx = { ...baseCtx, pickerOpen: true };
    expect(dispatchCursorKey(key({ key: "o" }), ctx)).toEqual({ type: "noop" });
  });

  it("o is suppressed when focus is in an editable element", () => {
    const ctx = { ...baseCtx, focusInEditable: true };
    expect(dispatchCursorKey(key({ key: "o" }), ctx)).toEqual({ type: "noop" });
  });

  it("Shift+O / Ctrl+O / Cmd+O → noop (modifier guards)", () => {
    expect(
      dispatchCursorKey(key({ key: "o", shiftKey: true }), baseCtx),
    ).toEqual({ type: "noop" });
    expect(
      dispatchCursorKey(key({ key: "o", ctrlKey: true }), baseCtx),
    ).toEqual({ type: "noop" });
    expect(
      dispatchCursorKey(key({ key: "o", metaKey: true }), baseCtx),
    ).toEqual({ type: "noop" });
  });

  it("o fires in sidebar mode too — App-side handler surfaces the resolution-failure hint when no row is under cursor", () => {
    const ctx: CursorKeymapContext = {
      ...baseCtx,
      paneFocus: "sidebar",
      selectedRowKind: "file",
    };
    expect(dispatchCursorKey(key({ key: "o" }), ctx)).toEqual({
      type: "open-in-editor",
    });
  });

  it("Cmd / Ctrl / Alt modifiers → noop (browser shortcuts)", () => {
    expect(dispatchCursorKey(key({ key: "j", metaKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
    expect(dispatchCursorKey(key({ key: "j", ctrlKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
    expect(dispatchCursorKey(key({ key: "j", altKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
  });

  it("unknown keys → noop", () => {
    expect(dispatchCursorKey(key({ key: "x" }), baseCtx)).toEqual({ type: "noop" });
  });
});

// PRD #343 / ADR 0031 / issue #346: webapp Esc with modal-unwind
// precedence + sidebar-mode key surface (j/k/h/l/Enter routes to
// file-tree navigation; c/r/s silent no-ops). The paneFocus field on
// CursorKeymapContext drives the surface switch; the default is
// `"diff"` so callers that haven't migrated keep today's behavior.
describe("dispatchCursorKey: Esc with modal-unwind precedence (PRD #343)", () => {
  it("Esc with no modal and paneFocus = diff → pane-focus-toggle", () => {
    expect(dispatchCursorKey(key({ key: "Escape" }), baseCtx)).toEqual({
      type: "pane-focus-toggle",
    });
  });

  it("Esc with no modal and paneFocus = sidebar → pane-focus-toggle (same action)", () => {
    expect(
      dispatchCursorKey(key({ key: "Escape" }), { ...baseCtx, paneFocus: "sidebar" }),
    ).toEqual({ type: "pane-focus-toggle" });
  });

  it("Esc with composer open → close-modal (paneFocus unchanged)", () => {
    const ctx: CursorKeymapContext = { ...baseCtx, composerOpen: true };
    expect(dispatchCursorKey(key({ key: "Escape" }), ctx)).toEqual({
      type: "close-modal",
    });
  });

  it("Esc with picker open → close-modal", () => {
    const ctx: CursorKeymapContext = { ...baseCtx, pickerOpen: true };
    expect(dispatchCursorKey(key({ key: "Escape" }), ctx)).toEqual({
      type: "close-modal",
    });
  });

  it("Esc with both composer and picker open → close-modal", () => {
    const ctx: CursorKeymapContext = {
      ...baseCtx,
      composerOpen: true,
      pickerOpen: true,
    };
    expect(dispatchCursorKey(key({ key: "Escape" }), ctx)).toEqual({
      type: "close-modal",
    });
  });

  it("Shift+Esc / Ctrl+Esc / Cmd+Esc → noop (modifier guard)", () => {
    expect(
      dispatchCursorKey(key({ key: "Escape", shiftKey: true }), baseCtx),
    ).toEqual({ type: "noop" });
    expect(
      dispatchCursorKey(key({ key: "Escape", ctrlKey: true }), baseCtx),
    ).toEqual({ type: "noop" });
    expect(
      dispatchCursorKey(key({ key: "Escape", metaKey: true }), baseCtx),
    ).toEqual({ type: "noop" });
  });
});

describe("dispatchCursorKey: sidebar-mode key surface (PRD #343 / issue #346)", () => {
  const sidebarCtx = (
    selectedRowKind: "file" | "folder" | null = "file",
  ): CursorKeymapContext => ({
    ...baseCtx,
    paneFocus: "sidebar",
    selectedRowKind,
  });

  it("j / ArrowDown → move-file-down (file row selected)", () => {
    expect(dispatchCursorKey(key({ key: "j" }), sidebarCtx("file"))).toEqual({
      type: "move-file-down",
    });
    expect(dispatchCursorKey(key({ key: "ArrowDown" }), sidebarCtx("file"))).toEqual({
      type: "move-file-down",
    });
  });

  it("k / ArrowUp → move-file-up (file row selected)", () => {
    expect(dispatchCursorKey(key({ key: "k" }), sidebarCtx("file"))).toEqual({
      type: "move-file-up",
    });
    expect(dispatchCursorKey(key({ key: "ArrowUp" }), sidebarCtx("file"))).toEqual({
      type: "move-file-up",
    });
  });

  it("Enter on file row → select-file", () => {
    expect(dispatchCursorKey(key({ key: "Enter" }), sidebarCtx("file"))).toEqual({
      type: "select-file",
    });
  });

  it("Enter on folder row → toggle-folder", () => {
    expect(dispatchCursorKey(key({ key: "Enter" }), sidebarCtx("folder"))).toEqual({
      type: "toggle-folder",
    });
  });

  it("l / ArrowRight on folder row → expand-folder", () => {
    expect(dispatchCursorKey(key({ key: "l" }), sidebarCtx("folder"))).toEqual({
      type: "expand-folder",
    });
    expect(
      dispatchCursorKey(key({ key: "ArrowRight" }), sidebarCtx("folder")),
    ).toEqual({ type: "expand-folder" });
  });

  it("l / ArrowRight on file row → noop (file rows have no expand semantic)", () => {
    expect(dispatchCursorKey(key({ key: "l" }), sidebarCtx("file"))).toEqual({
      type: "noop",
    });
    expect(
      dispatchCursorKey(key({ key: "ArrowRight" }), sidebarCtx("file")),
    ).toEqual({ type: "noop" });
  });

  it("h / ArrowLeft on folder row → collapse-folder", () => {
    expect(dispatchCursorKey(key({ key: "h" }), sidebarCtx("folder"))).toEqual({
      type: "collapse-folder",
    });
    expect(
      dispatchCursorKey(key({ key: "ArrowLeft" }), sidebarCtx("folder")),
    ).toEqual({ type: "collapse-folder" });
  });

  it("h / ArrowLeft on file row → collapse-parent (jump to parent folder)", () => {
    expect(dispatchCursorKey(key({ key: "h" }), sidebarCtx("file"))).toEqual({
      type: "collapse-parent",
    });
    expect(
      dispatchCursorKey(key({ key: "ArrowLeft" }), sidebarCtx("file")),
    ).toEqual({ type: "collapse-parent" });
  });

  it("c / r / s in sidebar mode → noop (silent gating per PRD #343 stories 21-22)", () => {
    const ctxFile = sidebarCtx("file");
    expect(dispatchCursorKey(key({ key: "c" }), ctxFile)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "r" }), ctxFile)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "s" }), ctxFile)).toEqual({ type: "noop" });
    // Including when reply-agent / card context would normally fire them
    // in diff mode — the paneFocus gate dominates.
    const ctxLoaded: CursorKeymapContext = {
      ...ctxFile,
      cursorOnCard: true,
      cursorOnHumanCard: true,
      replyAgent: "claude",
    };
    expect(dispatchCursorKey(key({ key: "c" }), ctxLoaded)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "r" }), ctxLoaded)).toEqual({ type: "noop" });
    expect(dispatchCursorKey(key({ key: "s" }), ctxLoaded)).toEqual({ type: "noop" });
  });

  it("n / p in sidebar mode still classify as nav-next/prev-comment (auto-flip handled App-side)", () => {
    expect(dispatchCursorKey(key({ key: "n" }), sidebarCtx("file"))).toEqual({
      type: "nav-next-comment",
    });
    expect(dispatchCursorKey(key({ key: "p" }), sidebarCtx("file"))).toEqual({
      type: "nav-prev-comment",
    });
  });

  it("Shift+L / Shift+T still open layout / picker in sidebar mode (pane-agnostic)", () => {
    const ctx = sidebarCtx("file");
    expect(dispatchCursorKey(key({ key: "L", shiftKey: true }), ctx)).toEqual({
      type: "toggle-layout",
    });
    expect(dispatchCursorKey(key({ key: "T", shiftKey: true }), ctx)).toEqual({
      type: "open-picker",
    });
  });

  it("Enter with no selectedRowKind falls back to select-file (defensive)", () => {
    expect(dispatchCursorKey(key({ key: "Enter" }), sidebarCtx(null))).toEqual({
      type: "select-file",
    });
  });

  it("paneFocus default is `diff` — omitting it keeps today's diff-mode behavior", () => {
    // No paneFocus field → j routes to cursor move-down, not sidebar
    // move-file-down. Regression guard against an accidental flip.
    expect(dispatchCursorKey(key({ key: "j" }), baseCtx)).toEqual({
      type: "move-down",
    });
  });
});

// PRD #356 / issue #358: context-aware `y` yank on the webapp. Mirrors
// the TUI slice (#357) — bare lowercase `y` dispatches `yank-at-cursor`
// in both pane modes; modifier-decorated `y` is a noop (preserves
// browser/OS shortcuts like Cmd-Y redo); `y` inside an editable / picker
// is absorbed by the existing suppression gates. The App-side handler
// invokes the shared `resolveYankTarget` resolver to discriminate
// line / path / none.
describe("dispatchCursorKey: context-aware yank (PRD #356 / issue #358)", () => {
  it("bare y in diff mode → yank-at-cursor", () => {
    expect(dispatchCursorKey(key({ key: "y" }), baseCtx)).toEqual({
      type: "yank-at-cursor",
    });
  });

  it("bare y in sidebar mode → yank-at-cursor (read-only, no auto-flip — ADR 0031 spirit check)", () => {
    const sidebar: CursorKeymapContext = {
      ...baseCtx,
      paneFocus: "sidebar",
      selectedRowKind: "file",
    };
    expect(dispatchCursorKey(key({ key: "y" }), sidebar)).toEqual({
      type: "yank-at-cursor",
    });
    // Folder / null selection also dispatch — the resolver is the
    // arbiter of "no-selection" via `kind: "none"`.
    expect(
      dispatchCursorKey(key({ key: "y" }), { ...sidebar, selectedRowKind: "folder" }),
    ).toEqual({ type: "yank-at-cursor" });
    expect(
      dispatchCursorKey(key({ key: "y" }), { ...sidebar, selectedRowKind: null }),
    ).toEqual({ type: "yank-at-cursor" });
  });

  it("bare y on a card cursor still dispatches yank-at-cursor (resolver falls back to path)", () => {
    expect(dispatchCursorKey(key({ key: "y" }), cardCtx)).toEqual({
      type: "yank-at-cursor",
    });
  });

  it("Cmd-Y / Ctrl-Y / Alt-Y → noop (preserves browser/OS shortcuts: redo, back, etc.)", () => {
    expect(dispatchCursorKey(key({ key: "y", metaKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
    expect(dispatchCursorKey(key({ key: "y", ctrlKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
    expect(dispatchCursorKey(key({ key: "y", altKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
  });

  it("Shift-Y → noop (reserved per ADR 0030 for a future capital-variant binding)", () => {
    expect(dispatchCursorKey(key({ key: "Y", shiftKey: true }), baseCtx)).toEqual({
      type: "noop",
    });
  });

  it("y while focus is in an editable → noop (user is typing the letter)", () => {
    expect(
      dispatchCursorKey(key({ key: "y" }), { ...baseCtx, focusInEditable: true }),
    ).toEqual({ type: "noop" });
  });

  it("y while picker is open → noop (picker absorbs all input)", () => {
    expect(
      dispatchCursorKey(key({ key: "y" }), { ...baseCtx, pickerOpen: true }),
    ).toEqual({ type: "noop" });
  });

  it("y while composer is open still dispatches yank-at-cursor (matches n/p/L/T survival rule)", () => {
    // The composer's textarea owns its own `focusInEditable` gate when
    // focus is inside it; this branch covers an unfocused-composer
    // edge case (e.g. click-outside leaves composer open but document
    // body is focused), mirroring how n/p continue to dispatch.
    expect(
      dispatchCursorKey(key({ key: "y" }), { ...baseCtx, composerOpen: true }),
    ).toEqual({ type: "yank-at-cursor" });
  });
});
