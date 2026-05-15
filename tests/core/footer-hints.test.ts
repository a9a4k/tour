import { describe, it, expect } from "vitest";
import { composeFooterHints } from "../../src/core/footer-hints.js";
import {
  TUI_FOOTER_HINTS,
  composeFooterHints as composeFooterHintsTui,
} from "../../src/tui/footer-hints.js";

// Issue #331: core/footer-hints.ts owns the keybinding-legend vocabulary
// for both surfaces. The TUI consumer in src/tui/footer-hints.ts is a
// thin delegate pinned to `surface: "tui"`; the webapp's Footer.tsx
// composes with `surface: "web"` to render only the bound-keys subset.

describe("composeFooterHints (core, surface: tui) — byte-equality with the TUI export", () => {
  it("emits today's TUI_FOOTER_HINTS constant verbatim with no options", () => {
    expect(composeFooterHints({ surface: "tui" })).toBe(TUI_FOOTER_HINTS);
  });

  it("matches the TUI delegate for the send-hint matrix (replyAgent + showSendHint)", () => {
    expect(
      composeFooterHints({ surface: "tui", replyAgent: "claude", showSendHint: true }),
    ).toBe(composeFooterHintsTui({ replyAgent: "claude", showSendHint: true }));
    expect(
      composeFooterHints({ surface: "tui", replyAgent: "claude", showSendHint: false }),
    ).toBe(composeFooterHintsTui({ replyAgent: "claude", showSendHint: false }));
    expect(composeFooterHints({ surface: "tui", showSendHint: true })).toBe(
      composeFooterHintsTui({ showSendHint: true }),
    );
  });

  it("inserts `s: send to {agent}` between `r: reply` and `Enter: expand`", () => {
    const out = composeFooterHints({
      surface: "tui",
      replyAgent: "codex",
      showSendHint: true,
    });
    const r = out.indexOf("r: reply");
    const s = out.indexOf("s: send to codex");
    const enter = out.indexOf("Enter: expand");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(s).toBeGreaterThan(r);
    expect(enter).toBeGreaterThan(s);
  });
});

describe("composeFooterHints (core, surface: web)", () => {
  it("emits exactly the 8-key webapp subset when showSendHint is false", () => {
    expect(composeFooterHints({ surface: "web" })).toBe(
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply  ·  L: layout  ·  t: picker",
    );
  });

  it("inserts `s: send to {agent}` after `r: reply` when reply-agent is configured", () => {
    const out = composeFooterHints({
      surface: "web",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toBe(
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply  ·  s: send to claude  ·  L: layout  ·  t: picker",
    );
  });

  it("omits the send hint when replyAgent is unset (even if showSendHint is true)", () => {
    const out = composeFooterHints({ surface: "web", showSendHint: true });
    expect(out).not.toContain("s: send to");
  });

  it("omits the send hint when showSendHint is false (e.g. focus is on an agent card)", () => {
    const out = composeFooterHints({
      surface: "web",
      replyAgent: "claude",
      showSendHint: false,
    });
    expect(out).not.toContain("s: send to");
  });

  // Regression guard: the TUI string is much longer and includes keys
  // that aren't bound on the webapp today. If the surface switch ever
  // regresses, this assertion catches the leak before the legend
  // appears in production.
  it("never emits any TUI-only key labels", () => {
    const cases = [
      composeFooterHints({ surface: "web" }),
      composeFooterHints({ surface: "web", replyAgent: "claude", showSendHint: true }),
      composeFooterHints({ surface: "web", replyAgent: "claude", showSendHint: false }),
    ];
    for (const out of cases) {
      expect(out).not.toContain("Enter");
      expect(out).not.toContain("e:");
      expect(out).not.toContain("c:");
      expect(out).not.toContain("y:");
      expect(out).not.toContain("Space");
      expect(out).not.toContain("Tab");
      expect(out).not.toContain("[/]");
      expect(out).not.toContain("q:");
    }
  });
});
