# Webapp footer mirrors TUI — status surface + key legend

> **Status:** Cross-surface. Records the design for adding a permanent footer to the webapp, parametrising `composeFooterHints` so the TUI keeps the original string and the webapp gets the bound-keys subset. Action-preview content (ADR 0022) stays TUI-only.

The webapp gains a one-line muted footer at the bottom of the page chrome, mirroring the TUI's footer **shape** (always-visible, muted, prepend-status-onto-legend) but not its **content** (verbatim string would lie on 7 unbound keys). The TUI footer is unchanged.

## Why

The webapp ships today with **no** footer. `src/web/client/cursor-keymap.ts:79` calls out the load-bearing consequence: `r` / `s` cross-axis misses (e.g. `s` on a row, `s` on a non-human card, `s` while the reply-lock is held) are silent no-ops — the user presses a key and nothing happens, with no surface to explain why. Auto-recall mitigates the off-screen-card variant only; the wrong-row-kind variant has no mitigation today.

Two webapp UX holes converge on the same fix:

- **(b) transient status** — `s` no-op reasons, annotation-create network failures, and other "the action didn't fire and you can't tell" cases need a surface. Today they're swallowed.
- **(c) keybinding teaching** — webapp users without a TUI session won't know `n`/`p`/`a`/`r`/`s`/`L`/`t` exist. Today the only discovery path is reading the source or stumbling onto a press.

The natural web idioms — toast for (b), `?`-modal for (c) — solve each in isolation, but at the cost of (i) two new component families to maintain, (ii) discoverability of `?` itself, and (iii) divergence from the TUI's mental model that already binds these jobs to one strip. The TUI's persistent-footer pattern compresses (b)+(c) onto one DOM node with no layout shift and zero discoverability tax. The cost on the webapp is ~28px of permanent vertical real estate, which on a 900px viewport is 3% and orders of magnitude cheaper than the same row on a 30-row terminal.

## Decisions

### Adopt a permanent footer on the webapp, not a toast + `?`-modal pair

Toast surfaces transient status well but composes poorly with a persistent legend (different lifetimes, different positions, two surfaces to learn). `?`-modal teaches keys on demand but loses self-teaching on first paint and gives no home for (b). One muted strip handles both jobs in the same shape the TUI already proved.

Alternatives rejected:
- **Toast-only for (b), no legend.** Doesn't address (c). Power-user keys stay undiscoverable.
- **`?`-modal-only for (c), no surface for (b).** Status still silent.
- **Both: toast + modal.** Two component families, two discoverability problems, no shared mental model with the TUI.

### Render webapp-bound-keys subset, not the verbatim TUI string

Seven TUI keys (`Enter`, `e`, `c`, `y`, `Space`, `Tab`, `[`/`]`, `q`) aren't bound on the webapp. Showing them in the legend would actively mis-teach — users would press them, nothing would happen, and the trust the footer is supposed to build would invert. The webapp legend ships exactly the eight keys `cursor-keymap.ts` dispatches: `j/k · h/l · n/p · a · r · s · L · t`, with `s: send to {agent}` conditional on `--reply-agent` + cursor-on-human-card + lock-free (same predicate the TUI uses).

Alternatives rejected:
- **Verbatim TUI string.** Lies on 7 keys. The string-identity goal is shape parity, not content parity.
- **Bind the missing keys on the webapp first.** Scope creep for what is fundamentally a chrome-only change.

### Status prepends onto the legend, auto-dismiss ~2s

Same shape as `src/tui/app.tsx:769`: `status ? \`${status}  ·  ${legend}\` : legend`. Status fires on `s` no-op reasons (lock held, wrong author kind) and on annotation-create failures (network errors currently swallowed to console). Success cases stay implicit — the watcher repaint is the confirmation, and an extra "Comment added" line is noise.

Alternatives rejected:
- **Replace, not prepend.** Hides the legend at the moment a confused user most needs it.
- **Two-line stack.** Layout shift on every status fire, exactly when the user is mid-press.
- **Surface successes too.** Visible repaint already confirms; an extra line is noise that habituates the user to ignore the strip.

### Render as a flex sibling at the column-root, not `position: fixed`

`position: fixed; bottom: 0` requires a `padding-bottom` hack on the diff scroll container or the last diff row hides under the footer. A flex sibling at the bottom of the App's column-flex root has no overlap problem, no z-index choreography, and matches the TUI's OpenTUI root-box layout exactly — the footer is the last child of the column, the diff is the flex-grow sibling above it.

### Wrap on narrow viewports (web); TUI keeps `height={1}` clip

Webapp viewports below ~1100px wrap the legend to a second line. Truthful display beats single-line consistency — clipping would reintroduce the same "lying footer" failure mode the bound-keys subset just closed.

The TUI footer keeps its current `height={1}` + silent clip-at-right behaviour. The asymmetry is intentional:

- TUI vertical budget is ~30–50 rows; one extra footer row is 3–5% of screen vs. 3% on the web for the same row count.
- TUI users are repeat-power-users; they learn the 8 shared keys in one session.
- TUI's footer prepends the **action preview** (`r: reply to "<title>"`, ADR 0022) before the legend — the load-bearing content sits at the left and survives any clip; the legend tail clips from the right.

The webapp has no action preview line (Q1: auto-recall covers the only mitigation case that mattered), so the legend is the footer's primary content and must stay truthful.

### Lift `composeFooterHints` to `core/footer-hints.ts`, parametrise by surface

```ts
composeFooterHints({ surface: "tui" | "web", replyAgent, showSendHint })
```

Same posture as `core/file-tree.ts` / `core/diff-rows.ts`: pure data composition consumed by both renderers. The shared keys (`j/k`, `h/l`, `n/p`, `a`, `r`, `s`, `L`, `t`) stay locked together — if `r` gets relabelled, both surfaces flip atomically. Surface-only keys (TUI's `Enter`/`e`/`c`/`y`/`Space`/`Tab`/`[/]`/`q`) live behind the `surface` switch.

The TUI's existing `composeFooterPreview` (action preview, off-screen suffix) stays TUI-only and stays in `src/tui/footer-hints.ts` since the webapp has no equivalent path.

## Consequences

- Webapp's silent `s` no-op family (`cursor-keymap.ts:79`) gains a surface; the cross-axis miss reasons are user-readable for the first time.
- Webapp users get self-teaching key discovery on first paint — no `?`-modal to find, no docs to read.
- Diff viewport on the webapp loses ~28px of permanent vertical space, growing to ~56px when the legend wraps below ~1100px viewport width.
- `core/footer-hints.ts` becomes the canonical key-label vocabulary; renames there cascade to both surfaces atomically.
- TUI footer behaviour is unchanged. No regression risk on the existing surface.
- Action-preview content stays TUI-only (the webapp keeps auto-recall as its off-screen-card mitigation per `cursor-keymap.ts:79`'s existing decision; ADR 0022's footer-preview rule remains scoped to the TUI).

## Small contracts pinned

- **A11y.** Render the footer as `<footer>`; wrap the status slot in `<span aria-live="polite" aria-atomic="true">`. The legend slot is static and is not announced. Closes the silent-failure surface for screen-reader users, who can't see the auto-recall scroll or the watcher repaint either.
- **Rapid-fire status.** Last-write-wins, no queue — same shape as the TUI's `setFooterStatus` (`useState<string | null>`). Repeat fires reset the ~2s auto-dismiss timer. `aria-live="polite"` coalesces announcements at the screen-reader layer; no app-level queue.
- **Picker / composer pass-through.** Footer stays painted and unchanged while the tour picker is open (picker carries its own hint line; scrim sits above the footer). Footer stays painted and unchanged while the inline composer is open; the status slot can still fire (e.g. submit error). Matches the TUI's behaviour on both modals.
