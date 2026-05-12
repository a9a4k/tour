import { describe, it, expect } from "vitest";
import {
  TUI_FOOTER_HINTS,
  composeFooterHints,
} from "../../src/tui/footer-hints.js";

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

  it("omits the `s: send to {agent}` hint by default (no reply-agent configured)", () => {
    expect(TUI_FOOTER_HINTS).not.toContain("s: send to");
  });
});

describe("composeFooterHints (issue #184)", () => {
  it("interpolates the agent name when showSendHint is true", () => {
    const out = composeFooterHints({ replyAgent: "claude", showSendHint: true });
    expect(out).toContain("s: send to claude");
  });

  it("omits the send hint when replyAgent is unset (even if showSendHint is true)", () => {
    const out = composeFooterHints({ showSendHint: true });
    expect(out).not.toContain("s: send to");
  });

  it("omits the send hint when showSendHint is false (e.g. focus is on an agent card)", () => {
    const out = composeFooterHints({ replyAgent: "claude", showSendHint: false });
    expect(out).not.toContain("s: send to");
  });

  it("renders the send hint between `r: reply` and `Enter: expand` (next to the human-reply verb)", () => {
    const out = composeFooterHints({ replyAgent: "codex", showSendHint: true });
    const r = out.indexOf("r: reply");
    const s = out.indexOf("s: send to codex");
    const enter = out.indexOf("Enter: expand");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(s).toBeGreaterThan(r);
    expect(enter).toBeGreaterThan(s);
  });
});
