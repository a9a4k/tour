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

describe("dispatchCursorKey: annotate-at-cursor", () => {
  it("c on a row cursor → annotate-at-cursor (App-side handler materializes the cursor on null)", () => {
    expect(dispatchCursorKey(key({ key: "c" }), baseCtx)).toEqual({
      type: "annotate-at-cursor",
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
    // with how n/p/L/t survive composer-open).
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

describe("dispatchCursorKey: annotation navigation (β-coupling)", () => {
  // β-coupling per ADR 0012 (mirrors ADR 0011): the keymap classifies
  // n/p as nav-next/prev-annotation; the App-side handler routes the
  // dispatch to navigateBy, which calls setCursor(cursorFromAnnotation
  // (target)) so the line cursor materializes at the navigated-to
  // anchor on the same keystroke. The asymmetric rule is enforced
  // here at the dispatcher: motion keys (j/k/h/l/arrows) classify as
  // move-*/set-side-* — never as nav-* — so j/k/h/l never touch
  // currentAnnotationId (App handler reads action.type).
  it("n → nav-next-annotation", () => {
    expect(dispatchCursorKey(key({ key: "n" }), baseCtx)).toEqual({
      type: "nav-next-annotation",
    });
  });

  it("p → nav-prev-annotation", () => {
    expect(dispatchCursorKey(key({ key: "p" }), baseCtx)).toEqual({
      type: "nav-prev-annotation",
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
    // change currentAnnotationId. Dispatcher-level guard: a motion key
    // never routes through the nav-next/prev path.
    const motionKeys = ["j", "k", "h", "l", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    for (const k of motionKeys) {
      const a = dispatchCursorKey(key({ key: k }), baseCtx);
      expect(a.type).not.toBe("nav-next-annotation");
      expect(a.type).not.toBe("nav-prev-annotation");
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
    // Annotation nav and layout still work (matches focusInEditable being
    // false — the textarea handles its own focus suppression separately).
    expect(dispatchCursorKey(key({ key: "n" }), ctx)).toEqual({
      type: "nav-next-annotation",
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
