import { describe, it, expect } from "vitest";
import { TUI_FOOTER_HINTS } from "../../src/tui/footer-hints.js";

describe("TUI_FOOTER_HINTS", () => {
  // Issue #183 / PRD #181: the top-level annotate affordance is labelled
  // "Comment" in both surfaces. The verb the hint surfaces against the
  // `a` keystroke must match — `a` keybinding itself is unchanged.
  it("labels the `a` action as `comment`, not `annotate`", () => {
    expect(TUI_FOOTER_HINTS).toContain("a: comment");
    expect(TUI_FOOTER_HINTS).not.toContain("a: annotate");
  });

  it("preserves the other top-level keybindings", () => {
    expect(TUI_FOOTER_HINTS).toContain("j/k: move");
    expect(TUI_FOOTER_HINTS).toContain("n/p: nav");
    expect(TUI_FOOTER_HINTS).toContain("r: reply");
    expect(TUI_FOOTER_HINTS).toContain("q: quit");
  });
});
