# Composer submit: `Enter` on both surfaces

> **Status:** Cross-surface. Aligns the webapp composer with the TUI composer (issue #394) on a single submit gesture: bare `Enter` submits, `Shift+Enter` inserts a newline. Webapp retains `Cmd/Ctrl+Enter` as an indefinite alias. The `Ctrl+S` placeholder noted by ADR 0030's amendment (Tier 3, "composer submit (under review separately)") is resolved here — not bound for the composer; the Tier 3 "text-input commit" slot remains reserved for future contexts where `Enter` is genuinely taken by other behavior.

The TUI shipped Enter-submits / Shift+Enter-newline under issue #394. The webapp shipped `Cmd/Ctrl+Enter` submits with bare `Enter` falling through to the textarea's default newline. Both surfaces now use bare `Enter` to submit. The webapp keeps its prior chord as a costless alias; the TUI's `Ctrl+J` newline fallback (for legacy terminals that can't report `Shift+Enter`) does not cross to the web.

## Why

Two surfaces, one composer, two different submit keys was a real cost — every user crossing surfaces re-learned which keystroke meant "send." The question was which direction to unify, not whether to. Three reasoning anchors drove the choice.

### Terminals constrain the submit key; browsers don't

`Cmd+Enter` is unreportable in most terminals — the chord doesn't reach the application. `Ctrl+Enter` reaches only Kitty-protocol terminals (Ghostty, WezTerm, modern Kitty); on legacy terminals it collapses to bare `Enter` and the symmetry it claims to provide silently breaks. The TUI can express bare `Enter` reliably; it cannot express the webapp's prior gesture. Asymmetric capability collapses the symmetry options: unification can only move toward what terminals can express, not the other way around.

### Real human comments are chat-shaped, not document-shaped

First-pass inspection of `.tour/*/annotations.jsonl` suggested 32% of "human" comments were composed multi-line — heavy markdown with `## headings`, code fences, paragraph breaks. That data shape would have favored chord-submit: every paragraph break in a 900-char body becomes an accidental-send near-miss under Enter-submits.

Filtering out the 2026-05-10 mis-attribution bug window — when every multi-line "human" comment was unmistakable agent voice (`## TUI Space-freeze: root cause + fix`, `## Webapp lag: the spread that wasn't free`) — revealed the real signal. 13 of 13 genuine human comments are single-line, ≤100 chars, chat-shaped:

```
"what about pnpm and yarn?"
"explain why it was deleted?"
"should we remove open by default?"
"guided traversal or guided walkthrough?"
```

The Slack / Claude Code analogy that issue #394 invoked for the TUI is the right reference frame for the real-human-author workload. Enter-submits costs nothing on the common case; the `Shift+Enter` escape hatch covers the rare multi-paragraph case. Long-form agent output is produced via the CLI, not typed in the composer, so the submit key does not affect it.

### `Ctrl+S` would solve a problem we don't have

ADR 0030's amendment reserved `Ctrl+S` under Tier 3 ("text-input commit") with the explicit hedge "composer submit (under review separately)." That justification only stands when `Enter` is taken by some other behavior in the composer. Once we commit to Enter-submits, that condition fails: `Enter` is *exactly* the submit key, not something we need a chord to work around. The Tier 3 slot remains reserved for future text-input contexts where the conflict is real (a command palette, an inline search modal with submit semantics) — it is not bound for the composer.

## Considered Options

- **Move webapp to Enter-submits (selected).** Aligns with the TUI's shipped pattern; matches the chat-shaped human workload; webapp keeps its prior `Cmd/Ctrl+Enter` as a costless alias.
- **Move both surfaces to `Ctrl+S` (the ADR 0030 placeholder).** Would unify on a neutral chord that reaches both surfaces. Rejected: forces the TUI to undo a recently-shipped, deliberate decision (#394) to solve a webapp asymmetry, and `Ctrl+S` collides with terminal flow control (XOFF) absent an `IXON`-disable preamble — a known gotcha for terminal apps to live with for a non-existent payoff.
- **Move both surfaces to `Ctrl+Enter`.** Reportable on Kitty-proto terminals only; legacy terminals collapse to bare `Enter` and break the symmetry the option claims to deliver. Rejected.
- **Leave the asymmetry; document it.** Cheap, but the cross-surface cost is real and re-paid by every user every time they switch contexts. Rejected.

## Decisions

### Webapp: `Enter` submits, `Shift+Enter` inserts a newline, `Cmd/Ctrl+Enter` is an indefinite alias

`src/web/client/App.tsx`'s `Composer` keydown handler:

- `Enter` (no modifiers) → submit if `body.trim().length > 0`; no-op otherwise.
- `Shift+Enter` → default textarea behavior (insert newline). No special handler needed.
- `Cmd+Enter` / `Ctrl+Enter` → submit. Alias retained for users with carryover muscle memory from GitHub / Linear / pre-this-ADR Tour.
- `Esc` → cancel (unchanged).

The alias is indefinite. It costs one extra branch in the handler and zero user-facing surface area; removing it would punish reflex without buying any clarity.

### Webapp: no `Ctrl+J` binding

The TUI binds `Ctrl+J` (the `0x0A` LF byte, distinct from Enter's CR) as a universal-terminal newline fallback because legacy terminals can't report `Shift+Enter`. Browsers always can. The webapp does not bind `Ctrl+J` — it collides with Chrome / Edge / Firefox's "Open Downloads" shortcut, and `Shift+Enter` covers the user need with no collision.

A user crossing from webapp to TUI needs `Ctrl+J` (their terminal might be non-Kitty-proto). A user crossing from TUI to webapp can always reach `Shift+Enter`. The asymmetry favors the user.

### Composer hint copy mirrors the TUI footer hint

A muted-text hint sits directly below the textarea on the webapp Composer:

```
Enter: submit · Shift+Enter: newline · Esc: cancel
```

The TUI variant remains:

```
Enter: submit · Shift+Enter / Ctrl+J: newline · Esc: cancel
```

Same structure, same separator, same key order. The `Ctrl+J` clause is the only honest difference between the two — a surface-specific terminal fallback that the web doesn't need.

The hint sits below the textarea, not in the placeholder — placeholders disappear on focus, which is the exact moment the user is about to press a key.

### ADR 0030: `Ctrl+S` reservation reframed, not removed

ADR 0030's Tier 3 table no longer lists `Ctrl+S` as an example of "text-input commit." The use case stays declared; no key is currently bound to it. A cross-reference to this ADR is added in the amendment block. The reservation is cheap; future surfaces (command palette, inline search) can claim `Ctrl+S` without revisiting Tier 3.

## Consequences

- Cross-surface muscle memory is one keystroke (`Enter`), not two. Users crossing from TUI to webapp or vice versa do not re-learn the submit gesture.
- Existing webapp users with `Cmd/Ctrl+Enter` reflex are not punished; the alias keeps working.
- New webapp users discover the gesture from the inline hint (always visible, present on focus) rather than from a placeholder that disappears on focus.
- The agent-comment workload (long markdown, code fences) is unaffected because agents do not press keys — agent comments arrive via the CLI, where stdin / file input has no "submit key" question.
- `Ctrl+S` remains reserved in ADR 0030 Tier 3 but not bound, available for the next text-input context that genuinely needs it.
- A latent data-integrity smell surfaced during the analysis: the 2026-05-10 author-misattribution window in `.tour/*/annotations.jsonl`. Filed separately; not a dependency of this ADR.

## Small contracts pinned

- **`Enter` submits on both surfaces.** The same keystroke means the same thing in TUI and web. The webapp composer does not behave like a generic textarea on this key.
- **`Shift+Enter` inserts a newline on both surfaces.** The TUI additionally accepts `Ctrl+J` as a legacy-terminal fallback; the web does not.
- **`Cmd/Ctrl+Enter` is a webapp-only alias for submit, indefinitely.** It is not promoted to the canonical gesture; the inline hint does not advertise it.
- **`Ctrl+S` is reserved for future text-input commit contexts.** Not bound today. Not the composer's submit gesture.
