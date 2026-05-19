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
//
// PRD #397 / ADR 0038: `C: collapse replies` is retired in favour of
// per-Thread collapse. The contextual label flips by the cursored
// Card's collapse state — `C: collapse` when the Thread is expanded
// (or off-card), `C: expand` when collapsed. The webapp diff-mode
// legend gains the same hint.

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

  // Issue #390 / ADR 0021 addendum: the request-reply hint is now
  // `R: request reply` (no agent name on the label), case-shifted from
  // bare `r: reply` to mark "different actor" — same letter, same
  // verb-family, different actor. The agent name lives on the header
  // chip, not on the legend.
  //
  // Issue #406 / ADR 0038 amended: `Enter: expand` is now contextual
  // (interactive-row / card-collapsed only). Pass
  // `enterHintCursor: "interactive"` to assert the prior layout.
  it("inserts `R: request reply` between `r: reply` and `Enter: expand` (no agent name on the label)", () => {
    const out = composeFooterHints({
      surface: "tui",
      replyAgent: "codex",
      showSendHint: true,
      enterHintCursor: "interactive",
    });
    const r = out.indexOf("r: reply");
    const requestReply = out.indexOf("R: request reply");
    const enter = out.indexOf("Enter: expand");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(requestReply).toBeGreaterThan(r);
    expect(enter).toBeGreaterThan(requestReply);
    expect(out).not.toContain("send to");
    expect(out).not.toContain("s: send");
    expect(out).not.toContain("R: request reply codex");
  });

  // Issue #337 / ADR 0029 + ADR 0030: lock the new labels in the TUI
  // legend so the keybinding cutover can't drift back to the pre-cutover
  // shape (`a: comment`, `c: collapse`, `t: picker`). `includes` is
  // case-sensitive so the lowercase "c: collapse" check does not match
  // the new "C: collapse replies" label.
  it("uses the post-cutover TUI labels (`c: comment`, `C: collapse`, `T: picker`); the retired `C: collapse replies` label is gone", () => {
    const out = composeFooterHints({ surface: "tui" });
    expect(out).toContain("c: comment");
    expect(out).toContain("C: collapse");
    expect(out).toContain("T: picker");
    expect(out).not.toContain("a: comment");
    expect(out).not.toContain("c: collapse");
    expect(out).not.toContain("t: picker");
    // PRD #397 / ADR 0038: the global `C: collapse replies` verb is
    // retired. The new label is per-Thread and contextual.
    expect(out).not.toContain("C: collapse replies");
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

  it("diff-mode legend shows the current sidebar visibility action while keeping `Esc: sidebar`", () => {
    const visible = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      sidebarVisible: true,
    });
    expect(visible).toContain("B: hide sidebar");
    expect(visible).toContain("Esc: sidebar");

    const hidden = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      sidebarVisible: false,
    });
    expect(hidden).toContain("B: show sidebar");
    expect(hidden).toContain("Esc: sidebar");
  });

  it("diff-mode legend retains today's other persistent hints", () => {
    // Issue #406 / ADR 0038 amended: `Enter:` is now contextual on the
    // cursor; pass `enterHintCursor: "interactive"` to retain
    // `Enter: expand` for the regression guard. `C:` is now contextual
    // on the bundle: `C: collapse all` (any expanded) /
    // `C: expand all` (all collapsed); the substring `C: collapse`
    // still matches `C: collapse all`.
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      enterHintCursor: "interactive",
    });
    expect(out).toContain("j/k: move");
    expect(out).toContain("h/l: side");
    expect(out).toContain("n/p: nav");
    expect(out).toContain("c: comment");
    expect(out).toContain("r: reply");
    expect(out).toContain("d: delete");
    expect(out).toContain("Enter: expand");
    expect(out).toContain("e: expand all");
    expect(out).toContain("C: collapse");
    expect(out).toContain("y: yank");
    expect(out).toContain("o: open");
    expect(out).toContain("Space: page");
    expect(out).toContain("L: layout");
    expect(out).toContain("B: hide sidebar");
    expect(out).toContain("T: picker");
    expect(out).toContain("[/]: width");
    expect(out).toContain("q: quit");
  });

  // ADR 0036 Slice D / issue #388: `d: delete` slots into the lowercase-
  // cursor cluster between `r: reply` and the conditional `R: request reply`
  // (issue #390 relabel + rebind) when present.
  it("`d: delete` slots after `r: reply` in the diff-mode TUI legend", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "diff" });
    const r = out.indexOf("r: reply");
    const d = out.indexOf("d: delete");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThan(r);
  });

  it("`d: delete` is absent in the sidebar-mode TUI legend (verb is card-only)", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    expect(out).not.toContain("d: delete");
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

  it("diff-mode legend inserts `R: request reply` when the send hint is visible (no agent name interpolated)", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toContain("R: request reply");
    expect(out).not.toContain("send to claude");
    expect(out).not.toContain("R: request reply claude");
  });

  it("sidebar-mode legend emits the documented pane-relevant string", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    expect(out).toBe(
      "j/k: file  ·  h/l: fold  ·  Enter: activate  ·  e: expand all  ·  y: yank  ·  o: open  ·  L: layout  ·  B: hide sidebar  ·  T: picker  ·  Esc: diff  ·  q: quit",
    );
  });

  it("sidebar-mode legend omits diff-only keys (`n/p`, `c`, `r`, `R`, `C`, `Enter: expand`, `Tab`, `Space`, `[/]`)", () => {
    const out = composeFooterHints({ surface: "tui", paneFocus: "sidebar" });
    expect(out).not.toContain("n/p:");
    expect(out).not.toContain("c: comment");
    expect(out).not.toContain("r: reply");
    expect(out).not.toContain("R: request reply");
    expect(out).not.toContain("C: collapse");
    expect(out).not.toContain("Enter: expand");
    expect(out).not.toContain("Tab:");
    expect(out).not.toContain("Space: page");
    expect(out).not.toContain("[/]: width");
  });

  it("sidebar-mode legend gates the send-hint conditional off (R: request reply only appears in diff mode)", () => {
    const sidebarWithSend = composeFooterHints({
      surface: "tui",
      paneFocus: "sidebar",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(sidebarWithSend).not.toContain("R: request reply");
    const diffWithSend = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(diffWithSend).toContain("R: request reply");
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
  // Issue #406 / ADR 0038 amended: the global `C:` verb is now
  // `collapse all` / `expand all` (was the per-cursor `collapse` /
  // `expand` flip). With `anyThreads` undefined the back-compat
  // default emits `C: collapse all`.
  it("emits the diff-mode webapp legend with `Esc: sidebar` when showSendHint is false", () => {
    expect(composeFooterHints({ surface: "web" })).toBe(
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply  ·  y: yank  ·  o: open  ·  C: collapse all  ·  L: layout  ·  T: picker  ·  Esc: sidebar",
    );
  });

  it("web diff-mode legend flips the B hint when the sidebar is hidden and keeps `Esc: sidebar`", () => {
    const visible = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      sidebarVisible: true,
    });
    expect(visible).toContain("B: hide sidebar");

    const out = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      sidebarVisible: false,
    });
    expect(out).toContain("B: show sidebar");
    expect(out).toContain("Esc: sidebar");
  });

  it("inserts `R: request reply` after `r: reply` when reply-agent is configured (no agent name on the label)", () => {
    const out = composeFooterHints({
      surface: "web",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toBe(
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply  ·  R: request reply  ·  y: yank  ·  o: open  ·  C: collapse all  ·  L: layout  ·  T: picker  ·  Esc: sidebar",
    );
  });

  it("omits the send hint when replyAgent is unset (even if showSendHint is true)", () => {
    const out = composeFooterHints({ surface: "web", showSendHint: true });
    expect(out).not.toContain("R: request reply");
    expect(out).not.toContain("send to");
  });

  it("omits the send hint when showSendHint is false (e.g. focus is on an agent card)", () => {
    const out = composeFooterHints({
      surface: "web",
      replyAgent: "claude",
      showSendHint: false,
    });
    expect(out).not.toContain("R: request reply");
    expect(out).not.toContain("send to");
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
      // `Space: page`, `[/]: width`, `q: quit`, `Tab` are all forbidden.
      // PRD #356 / issue #358 added webapp `y: yank` parity, so `y: yank`
      // is no longer TUI-only. PRD #349 / issue #353: `o: open` is bound
      // on both surfaces now, so it's allowed too.
      expect(out).not.toContain("Enter:");
      expect(out).not.toContain("e: expand all");
      expect(out).not.toContain("Space");
      expect(out).not.toContain("Tab");
      expect(out).not.toContain("[/]");
      expect(out).not.toContain("q: quit");
    }
  });

  // PRD #349 / ADR 0032 / issue #353: `o: open` slots into the webapp
  // legends in both pane modes (web parity for the TUI's `o`).
  it("diff-mode web legend includes `o: open` between `r: reply` and `L: layout`", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "diff" });
    expect(out).toContain("o: open");
    const r = out.indexOf("r: reply");
    const o = out.indexOf("o: open");
    const layout = out.indexOf("L: layout");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(o).toBeGreaterThan(r);
    expect(layout).toBeGreaterThan(o);
  });

  it("sidebar-mode web legend includes `o: open` before `L: layout`", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).toContain("o: open");
    const o = out.indexOf("o: open");
    const layout = out.indexOf("L: layout");
    expect(o).toBeGreaterThanOrEqual(0);
    expect(layout).toBeGreaterThan(o);
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
    expect(out).toContain("y: yank");
    expect(out).toContain("L: layout");
    expect(out).toContain("T: picker");
  });

  it("diff-mode web legend inserts `R: request reply` when the send hint is visible (no agent name interpolated)", () => {
    const out = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(out).toContain("R: request reply");
    expect(out).not.toContain("send to claude");
    expect(out).not.toContain("R: request reply claude");
  });

  it("sidebar-mode web legend emits the documented pane-relevant string", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).toBe(
      "j/k: file  ·  h/l: fold  ·  Enter: activate  ·  y: yank  ·  o: open  ·  L: layout  ·  T: picker  ·  Esc: diff",
    );
  });

  it("sidebar-mode web legend omits diff-only keys (`n/p`, `c`, `r`, `R`)", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).not.toContain("n/p:");
    expect(out).not.toContain("c: comment");
    expect(out).not.toContain("r: reply");
    expect(out).not.toContain("R: request reply");
  });

  it("sidebar-mode web legend gates the send-hint conditional off", () => {
    const sidebarWithSend = composeFooterHints({
      surface: "web",
      paneFocus: "sidebar",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(sidebarWithSend).not.toContain("R: request reply");
    const diffWithSend = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    expect(diffWithSend).toContain("R: request reply");
  });

  it("sidebar-mode web legend includes `Esc: diff` as the pane-toggle hint", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).toContain("Esc: diff");
  });

  // PRD #356 / issue #358: webapp `y` yank parity with the TUI. The
  // legend gains `y: yank` in BOTH pane modes (read-only — ADR 0031's
  // auto-flip rationale doesn't apply).
  it("diff-mode web legend places `y: yank` after `r: reply`", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "diff" });
    const r = out.indexOf("r: reply");
    const y = out.indexOf("y: yank");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThan(r);
  });

  it("diff-mode web legend places `y: yank` after `R: request reply` when the send hint is visible", () => {
    const out = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      replyAgent: "claude",
      showSendHint: true,
    });
    const requestReply = out.indexOf("R: request reply");
    const y = out.indexOf("y: yank");
    expect(requestReply).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThan(requestReply);
  });

  it("sidebar-mode web legend includes `y: yank` (PRD #356 — y is read-only, works in both panes)", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "sidebar" });
    expect(out).toContain("y: yank");
  });
});

// Issue #406 / ADR 0038 amended: `Shift+C` is now the global toggle —
// the legend `C:` verb flips on the bundle's collapse state, not the
// cursored Card's. `C: collapse all` (any Thread expanded) /
// `C: expand all` (all Threads collapsed) / omitted (zero Threads).
// `Enter:` is now contextual on the cursor: `Enter: expand`
// (interactive row OR card-collapsed), `Enter: collapse` (card-
// expanded), omitted (plain diff row).
describe("composeFooterHints — `C:` global collapse-all / expand-all flip (issue #406)", () => {
  it("TUI diff-mode legend reads `C: collapse all` when allThreadsCollapsed is false / undefined", () => {
    const undefinedOut = composeFooterHints({ surface: "tui", paneFocus: "diff" });
    expect(undefinedOut).toContain("C: collapse all");
    expect(undefinedOut).not.toContain("C: expand all");
    const falseOut = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      allThreadsCollapsed: false,
    });
    expect(falseOut).toContain("C: collapse all");
    expect(falseOut).not.toContain("C: expand all");
  });

  it("TUI diff-mode legend flips to `C: expand all` when allThreadsCollapsed is true", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      allThreadsCollapsed: true,
    });
    expect(out).toContain("C: expand all");
    expect(out).not.toContain("C: collapse all");
  });

  it("Web diff-mode legend mirrors the TUI flip", () => {
    const expanded = composeFooterHints({ surface: "web", paneFocus: "diff" });
    expect(expanded).toContain("C: collapse all");
    expect(expanded).not.toContain("C: expand all");
    const collapsed = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      allThreadsCollapsed: true,
    });
    expect(collapsed).toContain("C: expand all");
    expect(collapsed).not.toContain("C: collapse all");
  });

  it("Both surfaces omit the `C:` hint entirely when anyThreads is false (Shift+C is a labelled no-op then)", () => {
    const tui = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      anyThreads: false,
    });
    expect(tui).not.toContain("C: collapse");
    expect(tui).not.toContain("C: expand");
    const web = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      anyThreads: false,
    });
    expect(web).not.toContain("C: collapse");
    expect(web).not.toContain("C: expand");
  });

  it("Sidebar legends drop the hint entirely regardless of bundle state (Shift+C is diff-pane only)", () => {
    const tuiSidebar = composeFooterHints({
      surface: "tui",
      paneFocus: "sidebar",
      allThreadsCollapsed: true,
    });
    expect(tuiSidebar).not.toContain("C: collapse");
    expect(tuiSidebar).not.toContain("C: expand");
    const webSidebar = composeFooterHints({
      surface: "web",
      paneFocus: "sidebar",
      allThreadsCollapsed: true,
    });
    expect(webSidebar).not.toContain("C: collapse");
    expect(webSidebar).not.toContain("C: expand");
  });
});

describe("composeFooterHints — `Enter:` cursor-contextual flip (issue #406)", () => {
  it("TUI diff-mode emits `Enter: expand` on an interactive-row cursor", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      enterHintCursor: "interactive",
    });
    expect(out).toContain("Enter: expand");
    expect(out).not.toContain("Enter: collapse");
  });

  it("TUI diff-mode emits `Enter: collapse` when the cursor is on an expanded Card", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      enterHintCursor: "card-expanded",
    });
    expect(out).toContain("Enter: collapse");
    expect(out).not.toContain("Enter: expand");
  });

  it("TUI diff-mode emits `Enter: expand` when the cursor is on a collapsed Card", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      enterHintCursor: "card-collapsed",
    });
    expect(out).toContain("Enter: expand");
    expect(out).not.toContain("Enter: collapse");
  });

  it("TUI diff-mode omits the `Enter:` hint when the cursor is on a plain diff row (Enter is a no-op there)", () => {
    const out = composeFooterHints({
      surface: "tui",
      paneFocus: "diff",
      enterHintCursor: "row",
    });
    expect(out).not.toContain("Enter: expand");
    expect(out).not.toContain("Enter: collapse");
  });

  it("Web diff-mode mirrors the TUI flip for Card cursors", () => {
    const expandedCard = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      enterHintCursor: "card-expanded",
    });
    expect(expandedCard).toContain("Enter: collapse");
    expect(expandedCard).not.toContain("Enter: expand");
    const collapsedCard = composeFooterHints({
      surface: "web",
      paneFocus: "diff",
      enterHintCursor: "card-collapsed",
    });
    expect(collapsedCard).toContain("Enter: expand");
    expect(collapsedCard).not.toContain("Enter: collapse");
  });

  it("Web diff-mode omits the `Enter:` hint by default (back-compat — webapp didn't surface Enter on its legend pre-#406)", () => {
    const out = composeFooterHints({ surface: "web", paneFocus: "diff" });
    expect(out).not.toContain("Enter:");
  });
});
