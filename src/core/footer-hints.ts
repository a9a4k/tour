// Cross-surface keybinding legend composer for the footer hint strip.
// Both the TUI and the webapp render a one-line muted legend at the
// bottom of their viewport; this module owns the vocabulary so the
// shared keys (`j/k`, `h/l`, `n/p`, `c`, `r`, `s`, `L`, `T`) cannot
// drift between surfaces.
//
// `surface: "tui"` emits the full key list (16 keys today). `surface:
// "web"` emits only the subset that is actually bound on the webapp
// today — adding webapp bindings later grows the web legend without
// touching the TUI string.
//
// The `s: send to {agent}` hint is surfaced conditionally on both
// surfaces — only when `--reply-agent` is configured AND the cursor is
// on a human Comment card AND the reply-lock is free (caller passes
// `showSendHint: true`). See ADR 0022 / issue #184 for the TUI side;
// ADR 0028 / issue #330 for the webapp parity.
//
// Issues #337 (TUI) + #338 (webapp) / ADR 0029 + ADR 0030: both
// legends now read `c: comment` / `T: picker`; the TUI also adds
// `C: collapse replies`. The pre-cutover form (`a: comment`,
// `c: collapse`, `t: picker`) is fully retired.

import type { PaneFocus } from "./pane-focus-state.js";

export type FooterSurface = "tui" | "web";

export interface ComposeFooterHintsOptions {
  surface: FooterSurface;
  replyAgent?: string;
  showSendHint?: boolean;
  // PRD #343 / ADR 0031 / issue #345: pane-aware legend. The TUI swaps
  // between a sidebar-relevant subset and the full diff-mode legend per
  // `paneFocus`. Sidebar mode drops diff-only keys (`n/p`, `c`, `r`,
  // `s`, `C`, `Enter: expand`, `Space: page`, `[/]: width`) and adds
  // `Esc: diff` as the pane-toggle hint; diff mode drops the retired
  // `Tab: pane` and adds `Esc: sidebar`. Default is `"diff"` so call
  // sites that don't pass `paneFocus` still get a sensible legend.
  // Webapp keeps today's slice-1 form regardless of `paneFocus` —
  // slice 3 (issue #346) cashes in the webapp half.
  paneFocus?: PaneFocus;
}

export function composeFooterHints(opts: ComposeFooterHintsOptions): string {
  const paneFocus: PaneFocus = opts.paneFocus ?? "diff";
  if (opts.surface === "tui" && paneFocus === "sidebar") {
    // Sidebar-mode legend (PRD #343 / ADR 0031 / issue #345). Shorter
    // than the diff-mode legend — only sidebar-navigable keys and the
    // pane-agnostic Tour-wide actions (e/y/L/T/q). The send-hint
    // conditional is gated off here: `s` is a cursor-target action
    // that only fires when paneFocus = diff.
    return (
      `j/k: file  ·  h/l: fold  ·  Enter: activate  ·  e: expand all  ·  y: yank  ·  L: layout  ·  T: picker  ·  Esc: diff  ·  q: quit`
    );
  }
  const send =
    opts.showSendHint && opts.replyAgent
      ? `  ·  s: send to ${opts.replyAgent}`
      : "";
  if (opts.surface === "tui") {
    return (
      `j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply${send}  ·  Enter: expand  ·  e: expand all  ·  C: collapse replies  ·  y: yank path  ·  Space: page  ·  L: layout  ·  T: picker  ·  Esc: sidebar  ·  [/]: width  ·  q: quit`
    );
  }
  return `j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply${send}  ·  L: layout  ·  T: picker`;
}
