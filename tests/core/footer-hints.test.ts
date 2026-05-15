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
// Issue #337 / ADR 0029 + ADR 0030: the TUI legend reads `c: comment`,
// `C: collapse replies`, `T: picker` after the keybinding cutover. The
// webapp legend keeps its slice-1 form (`a: comment`, `t: picker`) until
// the Stage A webapp slice lands.

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

  // Issue #337 / ADR 0029 + ADR 0030: lock the new labels in the TUI
  // legend so the keybinding cutover can't drift back to the pre-cutover
  // shape (`a: comment`, `c: collapse`, `t: picker`). `includes` is
  // case-sensitive so the lowercase "c: collapse" check does not match
  // the new "C: collapse replies" label.
  it("uses the post-cutover TUI labels (`c: comment`, `C: collapse replies`, `T: picker`)", () => {
    const out = composeFooterHints({ surface: "tui" });
    expect(out).toContain("c: comment");
    expect(out).toContain("C: collapse replies");
    expect(out).toContain("T: picker");
    expect(out).not.toContain("a: comment");
    expect(out).not.toContain("c: collapse");
    expect(out).not.toContain("t: picker");
  });
});

// PRD #343 / ADR 0031 / issue #345: the TUI legend is now pane-aware.
// Sidebar mode swaps to a shorter sidebar-relevant string; diff mode
// drops the retired `Tab: pane` and adds `Esc: sidebar`. The
// `paneFocus` parameter already lives on the signature (slice 1); this
// slice cashes it in.
describe("composeFooterHints (core, surface: tui) — pane-aware legend (PRD #343)", () => {
  it("paneFocus 'diff' is the default — no paneFocus emits the diff-mode legend", () => {
    expect(composeFooterHints({ surface: "tui" })).toBe(
      composeFooterHints({ surface: "tui", paneFocus: "diff" }),
    );
  });

  it("diff-mode legend drops `Tab: pane` and adds `Esc: sidebar`", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "diff" });
    expect(out).not.toContain("Tab: pane");
    expect(out).not.toContain("Tab:");
    expect(out).toContain("Esc: sidebar");
  });

  it("diff-mode legend retains today's other persistent hints", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "diff" });
    expect(out).toContain("j/k: move");
    expect(out).toContain("h/l: side");
    expect(out).toContain("n/p: nav");
    expect(out).toContain("c: comment");
    expect(out).toContain("r: reply");
    expect(out).toContain("Enter: expand");
    expect(out).toContain("e: expand all");
    expect(out).toContain("C: collapse replies");
    expect(out).toContain("y: yank");
    expect(out).toContain("o: open");
    expect(out).toContain("Space: page");
    expect(out).toContain("L: layout");
    expect(out).toContain("T: picker");
    expect(out).toContain("[/]: width");
    expect(out).toContain("q: quit");
  });

  // PRD #349 / ADR 0032 / issue #352: `o: open` slots adjacent to
  // `y: yank` — both are "side-effect on cursor's file."
  it("diff-mode legend places `o: open` next to `y: yank`", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "diff" });
    const y = out.indexOf("y: yank");
    const o = out.indexOf("o: open");
    expect(y).toBeGreaterThanOrEqual(0);
    expect(o).toBeGreaterThan(y);
    // No other persistent hint between y and o.
    const between = out.slice(y + "y: yank".length, o);
    expect(between).toBe("  ·  ");
  });

  it("sidebar-mode legend places `o: open` next to `y: yank`", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    const y = out.indexOf("y: yank");
    const o = out.indexOf("o: open");
    expect(y).toBeGreaterThanOrEqual(0);
    expect(o).toBeGreaterThan(y);
    const between = out.slice(y + "y: yank".length, o);
    expect(between).toBe("  ·  ");
  });

  it("diff-mode legend inserts `s: send to {agent}` when the send hint is visible", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toContain("s: send to claude");
  });

  it("sidebar-mode legend emits the documented pane-relevant string", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    expect(out).toBe(
      "j/k: file  ·  h/l: fold  ·  Enter: activate  ·  e: expand all  ·  y: yank  ·  o: open  ·  L: layout  ·  T: picker  ·  Esc: diff  ·  q: quit",
    );
  });

  it("sidebar-mode legend omits diff-only keys (`n/p`, `c`, `r`, `s`, `C`, `Enter: expand`, `Tab`, `Space`, `[/]`)", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    expect(out).not.toContain("n/p:");
    expect(out).not.toContain("c: comment");
    expect(out).not.toContain("r: reply");
    expect(out).not.toContain("s: send to");
    expect(out).not.toContain("C: collapse replies");
    expect(out).not.toContain("Enter: expand");
    expect(out).not.toContain("Tab:");
    expect(out).not.toContain("Space: page");
    expect(out).not.toContain("[/]: width");
  });

  it("sidebar-mode legend gates the send-hint conditional off (s: send only appears in diff mode)", () => {
    const sidebarWithSend = composeFooterHints({
      surface: "tui",
      paneFocus: "sidebar",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(sidebarWithSend).not.toContain("s: send to");
    const diffWithSend = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(diffWithSend).toContain("s: send to claude");
  });

  it("sidebar-mode legend includes `Esc: diff` as the pane-toggle hint", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    expect(out).toContain("Esc: diff");
  });
});

describe("composeFooterHints (core, surface: web)", () => {
  // PRD #343 / ADR 0031 / issue #346: the web diff-mode legend gains
  // `Esc: sidebar` as the pane-toggle entry-point. The 8 prior keys
  // are unchanged.
  it("emits the diff-mode webapp legend with `Esc: sidebar` when showSendHint is false", () => {
    expect(composeFooterHints({ surface: "web" })).toBe(
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply  ·  L: layout  ·  T: picker  ·  Esc: sidebar",
    );
  });

  it("inserts `s: send to {agent}` after `r: reply` when reply-agent is configured", () => {
    const out = composeFooterHints({
      surface: "web",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toBe(
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply  ·  s: send to claude  ·  L: layout  ·  T: picker  ·  Esc: sidebar",
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
      // The web diff legend's `Esc: sidebar` is the only `Esc` token
      // it should ever contain; TUI's `Enter: expand`, `e: expand all`,
      // `y: yank path`, `Space: page`, `[/]: width`, `q: quit`, `Tab`
      // are all forbidden.
      expect(out).not.toContain("Enter:");
      expect(out).not.toContain("e: expand all");
      expect(out).not.toContain("y: yank");
      expect(out).not.toContain("Space");
      expect(out).not.toContain("Tab");
      expect(out).not.toContain("[/]");
      expect(out).not.toContain("q: quit");
    }
  });
});

// PRD #343 / ADR 0031 / issue #346: the web legend is pane-aware too.
// Sidebar mode swaps to a shorter sidebar-relevant string; diff mode
// keeps today's web legend plus `Esc: sidebar`.
describe("composeFooterHints (core, surface: web) — pane-aware legend (PRD #343)", () => {
  it("paneFocus 'diff' is the default — no paneFocus emits the diff-mode legend", () => {
    expect(composeFooterHints({ surface: "web" })).toBe(
      composeFooterHints({ surface: "web", paneFocus: "diff" }),
    );
  });

  it("diff-mode web legend includes `Esc: sidebar`", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "diff" });
    expect(out).toContain("Esc: sidebar");
  });

  it("diff-mode web legend retains today's other persistent hints", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "diff" });
    expect(out).toContain("j/k: move");
    expect(out).toContain("h/l: side");
    expect(out).toContain("n/p: nav");
    expect(out).toContain("c: comment");
    expect(out).toContain("r: reply");
    expect(out).toContain("L: layout");
    expect(out).toContain("T: picker");
  });

  it("diff-mode web legend inserts `s: send to {agent}` when the send hint is visible", () => {
    const out = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toContain("s: send to claude");
  });

  it("sidebar-mode web legend emits the documented pane-relevant string", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).toBe(
      "j/k: file  ·  h/l: fold  ·  Enter: activate  ·  L: layout  ·  T: picker  ·  Esc: diff",
    );
  });

  it("sidebar-mode web legend omits diff-only keys (`n/p`, `c`, `r`, `s`)", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).not.toContain("n/p:");
    expect(out).not.toContain("c: comment");
    expect(out).not.toContain("r: reply");
    expect(out).not.toContain("s: send to");
  });

  it("sidebar-mode web legend gates the send-hint conditional off", () => {
    const sidebarWithSend = composeFooterHints({
      surface: "web",
      paneFocus: "sidebar",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(sidebarWithSend).not.toContain("s: send to");
    const diffWithSend = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(diffWithSend).toContain("s: send to claude");
  });

  it("sidebar-mode web legend includes `Esc: diff` as the pane-toggle hint", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).toContain("Esc: diff");
  });
});
