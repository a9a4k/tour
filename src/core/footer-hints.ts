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
// on a human Annotation card AND the reply-lock is free (caller passes
// `showSendHint: true`). See ADR 0022 / issue #184 for the TUI side;
// ADR 0028 / issue #330 for the webapp parity.
//
// Issue #337 / ADR 0029 + ADR 0030: the TUI legend now reads
// `c: comment`, `C: collapse replies`, `T: picker` (replacing
// `a: comment`, `c: collapse`, `t: picker`). The webapp legend keeps
// its slice-1 form (`a: comment`, `t: picker`) until the Stage A
// webapp slice lands.

export type FooterSurface = "tui" | "web";

export interface ComposeFooterHintsOptions {
  surface: FooterSurface;
  replyAgent?: string;
  showSendHint?: boolean;
}

export function composeFooterHints(opts: ComposeFooterHintsOptions): string {
  const send =
    opts.showSendHint && opts.replyAgent
      ? `  ·  s: send to ${opts.replyAgent}`
      : "";
  if (opts.surface === "tui") {
    return (
      `j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply${send}  ·  Enter: expand  ·  e: expand all  ·  C: collapse replies  ·  y: yank path  ·  Space: page  ·  L: layout  ·  T: picker  ·  Tab: pane  ·  [/]: width  ·  q: quit`
    );
  }
  return `j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply${send}  ·  L: layout  ·  t: picker`;
}
