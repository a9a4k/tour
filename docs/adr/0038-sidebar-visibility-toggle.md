# Sidebar visibility toggle with Esc auto-unhide-and-focus

Tour's sidebar (folder tree of changed files) consumes ~200–300px of horizontal space that users in linear-reading or comment-walking modes don't need. Adding a hide affordance unlocks the focused-reading mode at max diff width, but it creates a state-space question: how does visibility interact with the existing PaneFocus slice (ADR 0031)?

## Why

The decision space has three plausible base models:

1. **Pure-visibility toggle.** Hide/show, focus is strictly orthogonal. Cheap to reason about, but `Esc` (currently "toggle paneFocus") becomes a no-op or a two-keystroke flow when sidebar is hidden — paying for orthogonality with friction on the single most common keyboard intent after hiding ("I want to navigate to a different file now").
2. **Snapshot/restore.** Hiding snapshots prior paneFocus; unhiding restores it. Adds a state slice (`paneFocusBeforeHide`) for a marginal payoff — the only sequence where it changes behavior is "focus sidebar → hide → unhide," an oddly indirect flow.
3. **Visibility + auto-focus on the toggle key.** The `B` keybinding / button click unhides AND grabs sidebar focus. Conflates "show me the tree" with "let me use the tree" — steals focus from a diff the user may be actively reading, especially bad for mouse users who don't expect a button click to change keyboard focus.

The chosen model is a hybrid that costs less than any of these while serving more user intent:

- **Toggle (button or `B` key) is pure-visibility.** Doesn't grab focus. Mouse users can glance at the tree without losing diff focus; keyboard users opt in to navigation explicitly.
- **`Esc` is the unified "give me sidebar" command.** When `!sidebarVisible`, Esc unhides AND sets `paneFocus = "sidebar"` in one transition — slotting between the existing modal-unwind branches and the existing pane-flip toggle.

This keeps each input device's primary gesture cheap (mouse click on the button stays a single, focus-preserving action; keyboard Esc is one keystroke from anywhere to "navigate to a file"), without growing the state machine beyond one new boolean slice and one new Esc-precedence clause.

## Considered Options

- **Pure-visibility only (no Esc extension).** Forces a two-keystroke flow (`B` then `Esc`) for the most common keyboard intent after hiding. Rejected — the "Esc and visibility are strictly orthogonal" benefit is academic; Esc already has multi-effect contextual behavior (composer-close, picker-close, delete-confirm-close), and one more precedence rule is cheap.
- **Snapshot/restore.** Rejected per the framing above. The Esc-auto-unhide-and-focus rule covers the return-to-sidebar intent more directly, without adding a slice.
- **Auto-focus on `B` / button unhide.** Rejected — conflates "show me" with "let me use it," steals focus asymmetrically across input devices.
- **Asymmetric mixed model** (`B` auto-focuses, button doesn't). Rejected — same logical action does different things depending on input device. Hard to document.
- **Persist across page reload (localStorage).** VSCode does this, but Tour's whole UI-state model (Cursor, PaneFocus, Layout, Folds, Composer, Picker, Reply-lock) is per-renderer-instance in-memory. Adding one slice that disobeys would be a foreign body. Visible-by-default on reload is the safest landing for newcomers; per-session hiding is enough for power users. Rejected for v1; revisit if real use exposes the friction.
- **Pure-visibility selected, plus Esc-auto-unhide-and-focus.**

## Decisions

### `sidebarVisible` is a new tour-session slice

Lives in `core/tour-session.ts` next to PaneFocus. `boolean`, default `true`. Reducer owns `sidebarVisible.set(boolean)` and `sidebarVisible.toggle()`. Per-renderer-instance, in-memory only — no on-disk presence, no cross-surface sync, gone on renderer exit / page reload. Matches the persistence model of Cursor / PaneFocus / Layout (ADR 0031).

### Invariant: `!sidebarVisible ⇒ paneFocus === "diff"`

Enforced by the toggle action. When hiding while `paneFocus === "sidebar"`, the reducer snaps `paneFocus` to `"diff"` in the same transition. Unhiding does **not** auto-restore prior focus — the slice is not snapshotted on hide.

### Toggle action is pure-visibility

The top-header button and the `B` keybinding dispatch the same action and have identical effect: flip `sidebarVisible`, snap `paneFocus` to `"diff"` if invalidated. No focus grab on unhide.

### Esc precedence extends by one rule

The Esc dispatch precedence in `core/tour-session-runtime.ts` (and the TUI's `dispatchKey`) becomes:

1. composer open → close composer
2. picker open → close picker
3. delete-confirm open → close delete-confirm
4. **`!sidebarVisible` → set `sidebarVisible = true` AND `paneFocus = "sidebar"`** *(new)*
5. otherwise → toggle `paneFocus`

The new rule sits between modal-unwind and pane-flip. It does not consume Esc when the sidebar is already visible (rule 5 retains its full reach in the common case).

### Preserved across tour-switch; reset on reload

Like Layout (PRD #36), `sidebarVisible` is preserved when the user switches between tours via the picker — a user in focused-reading mode stays in focused-reading mode across tours. Sidebar-row-selection and folder fold state also survive hide/unhide (they live in separate slices already preserved across paneFocus flips). Page reload / renderer restart resets to `true`, matching every other tour-session UI slice.

### Cross-surface mirror, no sync

Both surfaces ship the affordance, neither syncs the state to the other.

- **Webapp.** Icon button in the top header, far-left, before the hamburger. Primer's `SidebarCollapseIcon` (when visible) / `SidebarExpandIcon` (when hidden) via the existing `web/client/icons.ts` shim. Sidebar `<aside>` is removed from the layout grid when hidden; diff column expands to fill.
- **TUI.** Bordered cell in the same far-left position before the hamburger; `[⇤]` (visible) / `[⇥]` (hidden) glyphs. Sidebar column's flex allotment drops to 0 when hidden; diff column fills the freed width.

The state is not synced between TUI and webapp instances — each renderer-instance carries its own per ADR 0031's no-cross-surface-sync rule for tour-session UI state.

### Keybinding: capital `B`

Capital `B` is the keybinding on both surfaces. Lowercase `b` is bound to half-page-up (PRD #138, vim convention) and can't be reclaimed. Capital `B` slots into the existing view-state capital cluster (`L`: layout, `T`: picker, `C`: collapse-all-threads, `R`: send-to-agent) — five capitals for global view chrome, lowercase letters for cursor-domain actions (ADR 0030). The capital also lands on Cmd+B muscle memory imported from VSCode / Cursor / Linear / Notion / Slack.

### Diff pane reflows to full width when hidden

The sidebar column is removed from the layout (not visibility-hidden in place). Snap transition on both surfaces; no animation (TUI has no real motion idiom; matching the cheaper path on the webapp keeps the two surfaces visually equivalent).

## Consequences

- Footer-hint composer (`composeFooterHints` in `core/footer-hints.ts`) gains a `sidebarVisible` parameter and emits `B: hide sidebar` (visible) / `B: show sidebar` (hidden). The diff-mode legend's existing `Esc: sidebar` text remains correct in both states — Esc semantically means "go to sidebar" regardless of visibility.
- ADR 0031's PaneFocus contract is unchanged in spirit. Cursor and sidebar-row selection still preserve across all paneFocus flips. The Esc precedence list grows by one branch (rule 4 above).
- Action-target-driven auto-flip rules (CONTEXT.md Pane focus entry) survive: clicking a sidebar row still flips to sidebar (only fireable when visible), `n`/`p` still flips to diff (no change when already there). No new auto-flip rule is needed.
- `n`/`p` Comment-jump with sidebar hidden continues to update the (invisible) ancestor folder chain in the tree state, so a subsequent unhide shows the expected tree shape. No auto-unhide on `n`/`p` — comment navigation is a diff-pane gesture, not a navigation-intent signal.
- The webapp's `revealFileInSidebar` adapter method becomes a state-only mutation when hidden (selection and fold state update; no visible DOM effect). Unchanged signature.
- Tour-bundle / Comment / event-sourced persistence (ADR 0036) is not touched. Visibility is pure UI state.
- Empty-tour and single-file edge cases: the toggle is functional and meaningful in all of them. Even a one-file tour can benefit from reclaimed diff width.
