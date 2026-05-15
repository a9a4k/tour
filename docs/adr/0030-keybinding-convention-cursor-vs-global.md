# Keybinding convention — lowercase = cursor-target, capital = global

> **Status:** Cross-surface. Codifies the lowercase / capital letter distinction observed by `L`, `C`, `T` so future keybinding decisions have a non-arbitrary letter. Applies to both the TUI keymap (`src/tui/keymap.ts`) and the webapp keymap (`src/web/client/cursor-keymap.ts`). Symbols and universal terminal/vim conventions sit on an orthogonal third axis and are exempt.

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
