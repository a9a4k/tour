# Keybinding convention — lowercase = cursor-target, capital = global

> **Status:** Cross-surface. Codifies the lowercase / capital letter distinction observed by `L`, `C`, `T` so future keybinding decisions have a non-arbitrary letter. Applies to both the TUI keymap (`src/tui/keymap.ts`) and the webapp keymap (`src/web/client/cursor-keymap.ts`). Symbols and universal terminal/vim conventions sit on an orthogonal third axis and are exempt.
>
> **Amended (2026-05-17):** see the [Addendum](#addendum-three-tier-framework-and-different-actor-sub-shape-2026-05-17) for the three-tier framework (bare / Shift / Ctrl + symbols), the "different actor" sub-shape that admits `R` (request reply) under Tier 2, and the `?` / `/` symbol reservations. The original two-bucket statement below is preserved for context; the addendum is the live rule.

Tour's keybindings split cleanly into two buckets by **scope of effect**, not by mnemonic or by frequency. Lowercase letters bind actions on the cursor's current target (row, card, file). Capital letters (Shift+letter) bind actions on Tour-wide state that operates regardless of cursor position. Symbol keys and universal conventions (`/`, `?`, `q`, `[`, `]`, `Enter`, `Space`, `Tab`, `Ctrl+C`) are orthogonal to this rule — they follow terminal heritage and aren't constrained by it.

## Why

Until this ADR the keymap evolved decision-by-decision. `L` (Shift-L) for layout toggle was introduced by ADR 0012 because the lowercase `l` was needed for cursor-side-right. `C` (added alongside ADR 0029) collapses replies in every Thread and earned its capital by collision with `c` for comment. `T` (added alongside ADR 0029) opens the picker and earned its capital because it's the third action that operates globally on view state.

Three exemplars is enough to observe a pattern. Without a written convention, the fourth global action that arrives will be picked ad-hoc and the pattern will become invisible to future contributors. With a written convention, every new binding has a one-question test: "does this action need a cursor target to make sense?" — and a clear answer.

The alternative — vim's looser "capital = stronger variant" convention — was considered and rejected for Tour. Vim's `D` (`d$`), `J` (join), `R` (replace mode) are *related but different* verbs, not "the global version of lowercase". Tour's actions are simpler and split more cleanly on scope, so the stricter rule fits.

## Considered Options

- **No convention; pick letters ad-hoc.** Status quo until this ADR. Rejected: invisible pattern + arbitrary future choices.
- **Capital = stronger / wider variant (vim convention).** Loose. Rejected: every new binding needs a "what counts as stronger?" interpretation, and Tour's actions don't have the verb-variant relationship vim's do.
- **Capital = global, lowercase = cursor-target (selected).** Sharp test, applies to every state-mutating letter binding without ambiguity.
- **Capital = irreversible / destructive.** A different cut. Rejected: Tour has no destructive actions today, so the rule would be vacuous; meanwhile the cursor-vs-global cut is real now.

## Decisions

### Two buckets for letter bindings; symbols are orthogonal

> **Lowercase letter** — action operates on the cursor's current target (row, card, file).
> **Shift+letter (capital)** — action operates globally on Tour state, independent of cursor.
> **Symbols & convention keys** — `/`, `?`, `:`, `[`, `]`, `Enter`, `Space`, `Tab`, `q`, `Ctrl+C` follow universal terminal/vim heritage. Exempt from the lowercase/capital rule.

### Exemplars after ADR 0029

| Key | Action | Scope | Why this letter |
|---|---|---|---|
| `c` | open composer | cursor row | cursor-target → lowercase; `c` for comment matches industry (Gerrit) |
| `r` | open reply composer | cursor card | cursor-target → lowercase |
| `s` | send to agent | cursor card | cursor-target → lowercase |
| `e` | expand hidden context in cursor's file | cursor's file | cursor-target → lowercase (per-file ≠ global) |
| `y` | yank file path | cursor's file | cursor-target → lowercase |
| `n` / `p` | nav next / prev comment | cursor moves | cursor-target → lowercase |
| `L` | toggle layout (split ↔ unified) | Tour-wide | global → capital |
| `C` | toggle replies-collapse (every Thread) | Tour-wide | global → capital |
| `T` | open picker (switch Tour) | Tour-wide | global → capital |

`e` deserves a note: it operates per-file, but the file is the cursor's file. The rule's test ("does this action need a cursor target to make sense?") answers yes — on a degenerate cursor (null, folder-selected in sidebar) the action is a labelled no-op. So `e` is cursor-target, lowercase. If a future binding adds **global** expand-all-files (a different action), it gets `E`.

### No "UI-modal opener" exemption category

An earlier draft of this rule exempted picker, help, and search modals as "UI-modal openers, lowercase by convention". This category was rejected. Picker switches the entire Tour — global state by any honest definition. Once one modal opens lowercase, every future modal claims the exemption and the rule erodes. Cleaner: picker is global, gets capital, follows the rule. Future help/search modals use symbol keys (`?`, `/`) per universal convention, which sits on the orthogonal third axis.

### Lowercase/capital pairs are a free bonus, not a requirement

`c` (comment) and `C` (collapse replies) sit on the same letter — both are useful, both have natural mnemonics, the capital reads as "act on all replies in every thread", the lowercase reads as "add a comment here". This pairing is a happy accident, not a rule. Future bindings shouldn't contort letter choice to create pairs.

### Applies symmetrically to both surfaces

The TUI keymap (`src/tui/keymap.ts`) and the webapp keymap (`src/web/client/cursor-keymap.ts`) follow the same rule. The shared `core/footer-hints.ts` legend reflects both. Surface-specific bindings (TUI-only `Enter`/`Space`/`Tab`/`[/]`/`q`/`b`) are symbol keys, exempt, and don't violate the rule.

## Consequences

- Future keybinding decisions have a one-question test. No more "what letter feels right?" choices.
- Pattern is self-evident from the footer legend: lowercase cluster (`c r s e y n p t` → now `c r s e y n p`) maps to cursor work, capital cluster (`L C T`) maps to view-state switches. New users infer the convention by reading the legend.
- The capital cluster predicts shape of future bindings: global "filter to my comments" → `F`; global "sidebar visibility toggle" → `S`; global "mark all read" → `M`. Each is foreseeable without revisiting this ADR.
- One subsequent binding (`t → T`) shipped in lockstep with ADR 0029 to satisfy the rule retroactively. No further retroactive moves are required — every other letter binding already fits.
- The rule does not constrain symbol keys. `?` for help, `/` for search, `:` for command mode remain free conventions for future use.

## Small contracts pinned

- **The rule applies to state-mutating letter bindings only.** Navigation that moves the cursor (`j/k/h/l/n/p`) is "cursor-targeted" by definition — every key the user presses moves the cursor or operates on its target.
- **Universal terminal conventions win over the rule.** `q` (quit) is lowercase by every TUI convention; the rule does not promote it to `Q`. `Ctrl+C` ditto. The exemption is named explicitly in the rule statement; future readers don't need to re-derive it.
- **Frequency is not part of the test.** `L` (toggle layout, rare) and a hypothetical `F` (filter, frequent) both earn capitals if they're global. Frequency informs *whether to bind a key at all*; scope informs *which letter*.
- **The rule does not retroactively rebind anything already shipped under it.** `L`, `C`, `T` (after ADR 0029) all already fit. Lowercase bindings already shipped (`c r s e y n p`) all already fit. No churn debt.

## Addendum: Three-tier framework and "different actor" sub-shape (2026-05-17)

Pre-1.0 audit before wider release. Two gaps surfaced in the original rule:

1. **`R` (request reply)** shipped under issue #390 / ADR 0021 addendum as the case-shifted partner of `r`. It operates on the cursor's card — not Tour-wide — and so violates the original Tier 2 test as written. The issue #390 commit honestly called it a "same letter, different actor" pairing, which is the vim "stronger / wider variant" convention the original ADR explicitly rejected. The doc said one thing and we shipped another.
2. **Ctrl-tier had no documented convention.** Three bindings (`Ctrl+C` quit, `Ctrl+D` debug, `Ctrl+S` composer submit) with three ad-hoc rationales. The next chord would be picked without a rule.

### The amended rule — three tiers + symbols

Every letter binding lands in exactly one tier. Symbols are orthogonal and follow terminal / web heritage.

**Tier 1 — Bare lowercase letter: cursor verb.** Operates on what the cursor points at. Degenerate cursor (null, folder-selected, no card under cursor) is a labelled no-op. Highest-frequency Tour verbs land here — one keystroke, no chord. Motion (`j k h l n p`) is cursor-targeted by definition.

**Tier 2 — Shift + letter: broader stroke.** Same kind of work as a Tier-1 verb, applied at broader scope **or** delegated to a different actor. Two legal sub-shapes:

| Sub-shape | One-line test | Examples |
|---|---|---|
| Wider scope | "Same verb, every X" or pure view-state toggle | `C` collapse every thread (vs `c` add comment), `L` layout, `T` picker |
| Different actor | "Same verb, performed by someone else" | `R` request reply — you ask, the configured reply-agent performs the reply in a separate session |

The "different actor" sub-shape is sharp — not vague "stronger variant." It exists to legitimise the `r` / `R` pair shipping in issue #390 and to bound what future capitals can claim. A new capital that isn't "wider scope" must answer "who's the other actor?"; if there isn't one, the letter belongs on a different axis.

**Tier 3 — Ctrl + letter: chord-required, out-of-band.** Never primary navigation, never a primary content verb. Three legal use cases:

| Use case | Rationale | Today's bindings |
|---|---|---|
| Process control | Universal terminal heritage | `Ctrl+C` quit |
| Dev / debug | Out-of-band; not in the user-facing legend | `Ctrl+D` debug overlay |
| Text-input commit | Where `Enter` is taken by other behavior | *reserved, no current binding* — ADR 0041 chose bare `Enter` for the composer on both surfaces, so the slot stays available for future text-input contexts (command palette, inline search modal) where `Enter` is genuinely taken |

Tier 3 is intentionally a small surface. If the next proposed binding doesn't fit one of the three use cases, it doesn't belong here.

### Symbols — orthogonal, terminal/web heritage

Not subject to the tier rules. Reserved slots:

| Symbol | Use | Status |
|---|---|---|
| `Esc` | close-modal → pane toggle | shipped |
| `Enter` | activate / confirm | shipped |
| `Space` / `Shift+Space` | half-page down / up | shipped |
| `[` `]` | sidebar width | shipped |
| `Home/End/PgUp/PgDn` | viewport jump | shipped |
| `q` | quit | shipped — universal TUI convention, exempt from Tier 1 |
| `?` | help / cheatsheet | **reserved — do not bind elsewhere** |
| `/` | search / filter | **reserved — do not bind elsewhere** |

Reservations cost nothing in code and prevent a regrettable rebind later. `?` and `/` are reflexes users carry in from every other TUI / web tool; burning them on unrelated actions would be a one-way door.

The `q` exemption is now inline in the rule statement, not a footnote: universal terminal heritage wins over Tier 1, and the only letter this applies to is `q`.

### Considered and rejected during this amendment

- **Rebind `R` to a different letter** so the original Tier 2 ("Tour-wide only") rule could hold unchanged. Rejected: `R` is already shipping, the same-letter-different-actor mnemonic is the most natural reading, and admitting one bounded sub-shape is cheaper than burning user muscle memory.
- **Reserve a command palette (`Ctrl+K`) and command mode (`:`).** Rejected: Tour has ~20 verbs and a persistent footer legend. Palettes earn their slot at hundreds-of-verbs scale; command mode earns its slot when typed commands take args that single keys can't carry. Neither applies pre-1.0. Revisit if the verb corpus grows past what the legend can hold.
- **Reserve `g` + letter as a "go to" prefix.** Rejected: Tour's nav surface is the sidebar + `n` / `p`, with no distinct jump targets that don't already have a key.
- **Add `?` cheatsheet overlay now.** Rejected: the footer legend already lists every user-facing binding. A `?` popover would duplicate the bottom-of-screen string in a panel. Reserved the symbol; deferred the feature until the legend can't carry the full vocabulary.

### One-question test for a new binding

Ask in order, stop at the first yes:

1. Does the action target what the cursor points at? → **Tier 1** (bare lowercase).
2. Is it the same kind of work as a Tier-1 verb, but wider scope or different actor? → **Tier 2** (Shift + letter).
3. Does it need to coexist with text input, control the process, or surface a dev overlay? → **Tier 3** (Ctrl + letter).
4. Does terminal / web heritage already own a symbol for it (`?`, `/`, `Esc`, `Enter`, `Space`, brackets, `q`)? → use the symbol.
5. None of the above? → you're proposing a new tier; that needs its own ADR.

### Exemplars after the amendment

| Key | Action | Tier | Sub-shape |
|---|---|---|---|
| `c` `r` `d` `e` `y` `o` `n` `p` | comment / reply / delete / expand-file / yank / open / nav | Tier 1 | — |
| `j` `k` `h` `l` | motion | Tier 1 | (motion by definition) |
| `L` `C` `T` | layout / collapse-all / picker | Tier 2 | wider scope |
| `R` | request reply | Tier 2 | different actor |
| `Ctrl+C` | quit | Tier 3 | process control |
| `Ctrl+D` | debug overlay | Tier 3 | dev / debug |
| `q` `Esc` `Enter` `Space` `[` `]` `?` `/` | (various) | Symbols | terminal / web heritage |

The Tier 3 "text-input commit" slot is declared but unbound — see ADR 0041 for the composer-submit decision that resolved the earlier `Ctrl+S` hedge.

No rebinds. Every letter currently shipping fits cleanly under one of the three tiers or the symbol axis.
