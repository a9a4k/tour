import { describe, expect, it, vi } from "vitest";
import { copyFinishedTextSelection } from "../../src/tui/text-selection-copy.js";
import type { ClipboardSink } from "../../src/tui/clipboard.js";

function selection(text: string) {
  return {
    getSelectedText: () => text,
  };
}

function sink(): ClipboardSink {
  return {
    copyToClipboardOSC52: () => true,
  };
}

describe("copyFinishedTextSelection", () => {
  it("copies non-empty selected text through the TUI clipboard transport and flashes status", () => {
    const write = vi.fn(() => true);
    const flash = vi.fn();
    const clipboardSink = sink();

    expect(
      copyFinishedTextSelection(
        selection("const x = 1;"),
        clipboardSink,
        flash,
        write,
      ),
    ).toBe(true);

    expect(write).toHaveBeenCalledWith("const x = 1;", clipboardSink);
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
    const clipboardSink = sink();

    expect(
      copyFinishedTextSelection(selection("selected"), clipboardSink, flash, write),
    ).toBe(false);

    expect(write).toHaveBeenCalledWith("selected", clipboardSink);
    expect(flash).not.toHaveBeenCalled();
  });
});
