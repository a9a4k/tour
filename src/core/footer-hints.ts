// Cross-surface keybinding legend composer for the footer hint strip.
// Both the TUI and the webapp render a one-line muted legend at the
// bottom of their viewport; this module owns the vocabulary so the
// shared keys (`j/k`, `h/l`, `n/p`, `c`, `r`, `R`, `L`, `T`) cannot
// drift between surfaces.
//
// `surface: "tui"` emits the full key list (16 keys today). `surface:
// "web"` emits only the subset that is actually bound on the webapp
// today — adding webapp bindings later grows the web legend without
// touching the TUI string.
//
// The `R: request reply` hint is surfaced conditionally on both
// surfaces — only when `--reply-agent` is configured AND the cursor is
// on a human Comment card AND the reply-lock is free (caller passes
// `showSendHint: true`). Issue #390 / ADR 0021 addendum: the verb was
// "send to {agent}" on key `s` until that label kept reading as
// "message my current Claude session" — agent name dropped from the
// legend, role-framed verb, and `s → R` (shift-r) parallel with bare
// `r: reply` (same letter, case-shifted = same action, different
// actor).
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
  // PRD #343 / ADR 0031 / issue #345 + #346: pane-aware legend on both
  // surfaces. Sidebar mode drops diff-only keys (`n/p`, `c`, `r`, `R`,
  // and any TUI-only `C`, `Enter: expand`, `Space: page`, `[/]: width`)
  // and adds `Esc: diff` as the pane-toggle hint; diff mode adds
  // `Esc: sidebar` and (on TUI) drops the retired `Tab: pane`. Default
  // is `"diff"` so call sites that don't pass `paneFocus` still get a
  // sensible legend.
  paneFocus?: PaneFocus;
}

export function composeFooterHints(opts: ComposeFooterHintsOptions): string {
  const paneFocus: PaneFocus = opts.paneFocus ?? "diff";
  if (opts.surface === "tui" && paneFocus === "sidebar") {
    // Sidebar-mode legend (PRD #343 / ADR 0031 / issue #345). Shorter
    // than the diff-mode legend — only sidebar-navigable keys and the
    // pane-agnostic Tour-wide actions (e/y/o/L/T/q). The send-hint
    // conditional is gated off here: `R` is a cursor-target action
    // that only fires when paneFocus = diff. PRD #349 / ADR 0032 /
    // issue #352: `o: open` slots next to `y` since both are
    // "side-effect on cursor's file."
    return (
      `j/k: file  ·  h/l: fold  ·  Enter: activate  ·  e: expand all  ·  y: yank  ·  o: open  ·  L: layout  ·  T: picker  ·  Esc: diff  ·  q: quit`
    );
  }
  if (opts.surface === "web" && paneFocus === "sidebar") {
    // Sidebar-mode web legend (PRD #343 / ADR 0031 / issue #346). Mirrors
    // the TUI's sidebar-mode subset minus the TUI-only keys (`e`, `q`):
    // the webapp doesn't bind those today. PRD #356 / issue #358 added
    // webapp `y: yank` in BOTH pane modes (read-only — ADR 0031's
    // auto-flip rationale doesn't apply). PRD #349 / ADR 0032 / issue
    // #353: `o: open` slots in next to `y` (both are "side-effect on
    // cursor's file"). Send-hint gated off here for the same reason as
    // the TUI sidebar branch.
    return (
      `j/k: file  ·  h/l: fold  ·  Enter: activate  ·  y: yank  ·  o: open  ·  L: layout  ·  T: picker  ·  Esc: diff`
    );
  }
  // Issue #390: the agent name is intentionally NOT interpolated into the
  // legend label. The header chip (webapp + TUI) carries the configured
  // agent name; the legend just says what the action does. Same letter as
  // bare `r: reply`, case-shifted to mark "different actor" (the
  // configured reply-agent runs the request in a separate session).
  const send = opts.showSendHint && opts.replyAgent ? `  ·  R: request reply` : "";
  if (opts.surface === "tui") {
    // PRD #349 / ADR 0032 / issue #352: `o: open` slots next to
    // `y: yank path` — both are "side-effect on cursor's file."
    //
    // ADR 0036 Slice D / issue #388: `d: delete` slots into the lowercase-
    // cursor cluster between `r: reply` and `R: request reply`. Card-only
    // gesture — the App-side handler routes `d` on a row to a labelled no-op
    // (`noop-delete-on-row`), matching the existing `r`/`R` pattern. The
    // hint is unconditional in the legend (same convention as `r: reply`);
    // gating the verb on cursor context happens at the dispatcher.
    return (
      `j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply  ·  d: delete${send}  ·  Enter: expand  ·  e: expand all  ·  C: collapse replies  ·  y: yank  ·  o: open  ·  Space: page (Shift: up)  ·  L: layout  ·  T: picker  ·  Esc: sidebar  ·  [/]: width  ·  q: quit`
    );
  }
  // Web diff-mode legend (PRD #343 / ADR 0031 / issue #346): today's
  // subset + `Esc: sidebar` as the pane-toggle entry-point. PRD #356 /
  // issue #358: `y: yank` slots next to `r: reply` in the lowercase-
  // cursor section — symmetric to the TUI legend. PRD #349 / ADR 0032 /
  // issue #353: `o: open` follows `y` so the cursor-target action
  // cluster stays adjacent.
  return `j/k: move  ·  h/l: side  ·  n/p: nav  ·  c: comment  ·  r: reply${send}  ·  y: yank  ·  o: open  ·  L: layout  ·  T: picker  ·  Esc: sidebar`;
}
