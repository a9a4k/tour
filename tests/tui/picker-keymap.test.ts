import { describe, it, expect } from "vitest";
import { dispatchPickerKey } from "../../src/tui/picker-keymap.js";
import type { KeyInput } from "../../src/tui/keymap.js";

const k = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyInput => ({
  name,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
});

// Issue #340 / ADR 0030: when the picker is open, close it on Escape and
// Shift+T (mirrors how it opens). Bare `t` is unbound everywhere after
// the t → T cutover (#337), including this state — the prior bare-`t`
// close binding was the last surviving exception to the rule.
describe("dispatchPickerKey", () => {
  it("Escape closes the picker", () => {
    expect(dispatchPickerKey(k("escape"))).toEqual({ type: "close" });
  });

  it("Shift+T closes the picker (open binding mirrored, ADR 0030)", () => {
    expect(dispatchPickerKey(k("t", { shift: true }))).toEqual({ type: "close" });
  });

  it("bare t does NOT close the picker (issue #340 — bare-t-is-noop)", () => {
    expect(dispatchPickerKey(k("t"))).toEqual({ type: "noop" });
  });

  it("Ctrl+T does not close the picker", () => {
    expect(dispatchPickerKey(k("t", { ctrl: true }))).toEqual({ type: "noop" });
  });

  it("Ctrl+Shift+T does not close the picker (modifier guard mirrors open binding)", () => {
    expect(dispatchPickerKey(k("t", { ctrl: true, shift: true }))).toEqual({ type: "noop" });
  });

  it("j and ArrowDown move the highlight down", () => {
    expect(dispatchPickerKey(k("j"))).toEqual({ type: "move", delta: 1 });
    expect(dispatchPickerKey(k("down"))).toEqual({ type: "move", delta: 1 });
  });

  it("k and ArrowUp move the highlight up", () => {
    expect(dispatchPickerKey(k("k"))).toEqual({ type: "move", delta: -1 });
    expect(dispatchPickerKey(k("up"))).toEqual({ type: "move", delta: -1 });
  });

  it("Return commits the highlighted row", () => {
    expect(dispatchPickerKey(k("return"))).toEqual({ type: "commit" });
  });

  it("bare a toggles the picker scope", () => {
    expect(dispatchPickerKey(k("a"))).toEqual({ type: "toggle-scope" });
  });

  it("unbound letters are a plain noop", () => {
    expect(dispatchPickerKey(k("c"))).toEqual({ type: "noop" });
    expect(dispatchPickerKey(k("q"))).toEqual({ type: "noop" });
  });

  it("Shift + non-close letters are a plain noop (no shifted commit path)", () => {
    expect(dispatchPickerKey(k("j", { shift: true }))).toEqual({ type: "noop" });
    expect(dispatchPickerKey(k("k", { shift: true }))).toEqual({ type: "noop" });
    expect(dispatchPickerKey(k("return", { shift: true }))).toEqual({ type: "noop" });
  });
});
