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
  it("a → annotate-at-cursor (App-side handler materializes the cursor on null)", () => {
    expect(dispatchCursorKey(key({ key: "a" }), baseCtx)).toEqual({
      type: "annotate-at-cursor",
    });
  });
});

describe("dispatchCursorKey: annotation navigation (β-coupling)", () => {
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

  it("t → open-picker", () => {
    expect(dispatchCursorKey(key({ key: "t" }), baseCtx)).toEqual({
      type: "open-picker",
    });
  });
});

describe("dispatchCursorKey: suppression rules", () => {
  it("focus in editable element → all cursor keys noop", () => {
    const ctx = { ...baseCtx, focusInEditable: true };
    for (const k of ["j", "k", "h", "l", "ArrowDown", "ArrowUp", "a", "n", "p", "t"]) {
      expect(dispatchCursorKey(key({ key: k }), ctx)).toEqual({ type: "noop" });
    }
    expect(
      dispatchCursorKey(key({ key: "L", shiftKey: true }), ctx),
    ).toEqual({ type: "noop" });
  });

  it("picker open → all keys noop (picker owns input)", () => {
    const ctx = { ...baseCtx, pickerOpen: true };
    for (const k of ["j", "k", "h", "l", "n", "p", "a", "t"]) {
      expect(dispatchCursorKey(key({ key: k }), ctx)).toEqual({ type: "noop" });
    }
    expect(
      dispatchCursorKey(key({ key: "L", shiftKey: true }), ctx),
    ).toEqual({ type: "noop" });
  });

  it("composer open → motion keys noop, but n/p/L/t/a still dispatch", () => {
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
