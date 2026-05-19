import { describe, expect, it, vi } from "vitest";
import {
  copyFinishedTextSelection,
  type TextSelectionClipboardSink,
} from "../../src/tui/text-selection-copy.js";

function selection(text: string) {
  return {
    getSelectedText: () => text,
  };
}

function sink(): TextSelectionClipboardSink {
  return {
    copyToClipboardOSC52: () => true,
  };
}

describe("copyFinishedTextSelection", () => {
  it("copies non-empty selected text through the TUI clipboard transport and flashes status", () => {
    const write = vi.fn(() => true);
    const flash = vi.fn();

    expect(
      copyFinishedTextSelection(selection("const x = 1;"), sink(), flash, write),
    ).toBe(true);

    expect(write).toHaveBeenCalledWith("const x = 1;", expect.any(Object));
    expect(flash).toHaveBeenCalledWith("Copied selection");
  });

  it("does not copy or flash when selection finished with no selected text", () => {
    const write = vi.fn(() => true);
    const flash = vi.fn();

    expect(copyFinishedTextSelection(selection(""), sink(), flash, write)).toBe(false);

    expect(write).not.toHaveBeenCalled();
    expect(flash).not.toHaveBeenCalled();
  });

  it("does not flash success when the clipboard transport rejects the selected text", () => {
    const write = vi.fn(() => false);
    const flash = vi.fn();

    expect(copyFinishedTextSelection(selection("selected"), sink(), flash, write)).toBe(false);

    expect(write).toHaveBeenCalledWith("selected", expect.any(Object));
    expect(flash).not.toHaveBeenCalled();
  });
});
