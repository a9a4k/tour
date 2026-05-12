// The bottom-bar key-action hint surfaced by the TUI app shell. The
// `a` action is labelled "comment" (issue #183, PRD #181) to align with
// the verb every collaborative code-review tool reaches for; the
// keybinding itself is unchanged and `tour annotate` plus the
// "Annotation" domain noun are untouched.
//
// `s send to {agent}` (issue #184, PRD #181) is surfaced conditionally —
// only when the focused card is a human Annotation, `--reply-agent` is
// set, AND the lock is free. When the lock is held tour-wide the hint
// stays in the footer but is rendered muted; pressing `s` is a no-op
// with a one-line footer status driven by App.tsx, not by this constant.
export interface FooterHintOptions {
  replyAgent?: string;
  showSendHint?: boolean;
}

export function composeFooterHints(opts: FooterHintOptions = {}): string {
  const send =
    opts.showSendHint && opts.replyAgent
      ? `  ·  s: send to ${opts.replyAgent}`
      : "";
  return (
    `j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply${send}  ·  Enter: expand  ·  S+Enter: expand all  ·  c: collapse  ·  Space: page  ·  L: layout  ·  t: picker  ·  Tab: pane  ·  q: quit`
  );
}

// Back-compat export: the bare constant is the default footer (no Send
// hint, used by call sites that don't know about reply-agent state).
export const TUI_FOOTER_HINTS = composeFooterHints();
