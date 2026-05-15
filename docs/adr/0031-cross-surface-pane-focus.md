# Cross-surface pane focus — Esc/Enter replaces Tab/Shift-Tab

> **Status:** Cross-surface keybinding. The TUI's `sidebarFocused` boolean retires; both surfaces adopt a unified `paneFocus: "sidebar" | "diff"` Tour-session slice. `Tab`/`Shift-Tab` are hard-removed on the TUI; the webapp gains keyboard sidebar navigation for the first time. Supersedes the TUI half of the prior Tab keymap; complements ADR 0028 (footer) and ADR 0030 (cursor-vs-global key conventions).

The TUI's `Tab` (toggle pane focus) and `Shift-Tab` (force sidebar focus) are retired. Both surfaces adopt the same semantic on the same keys: `Esc` toggles pane focus (with modal-unwind taking precedence), `Enter` activates the focused sidebar row (file → select + flip to diff; folder → toggle fold, no flip). The webapp realises pane focus via the W3C ARIA tree-widget pattern (roving-tabindex). Pane focus becomes the second Tour-session focus slice alongside Cursor, both pure-data and surface-realised through downstream effects.

## Why

The TUI has shipped a pane-focus model since before the unified cursor (`sidebarFocused` boolean, `Tab` to toggle, `Shift-Tab` to force sidebar). The webapp has shipped without one — its sidebar is mouse-click-only, and the cursor-keymap explicitly notes "the webapp has no footer line so an offscreen-card miss is mitigated by auto-recall" (`src/web/client/cursor-keymap.ts:79`). Two consequences fall out:

- **Webapp has no keyboard sidebar navigation at all.** Users who never reach for the mouse have no way to walk the file tree.
- **TUI muscle memory doesn't transfer.** Users who learn Tour in the TUI press `Tab` on the webapp and get browser-native focus cycling — a different feature than the one they wanted.

The obvious fix — override `Tab` on the webapp — is the wrong answer. `Tab` is the load-bearing key for the web's keyboard-navigation contract (WCAG 2.1.1 Keyboard, 2.4.3 Focus Order). Overriding it strands screen-reader users, motor-impaired users, and any keyboard user who needs to walk past Tour's UI to a browser-chrome control. The webapp already shipped `aria-live` for silent failures in ADR 0028; we won't undo that a11y win for muscle-memory parity.

The alternative — bind pane focus on a different key on the webapp while leaving the TUI on `Tab` — preserves a11y but cements asymmetry across surfaces forever. With cursor, layout, footer, and now pane focus all being cross-surface Tour concepts, the keymap divergence is no longer defensible.

This ADR aligns both surfaces on a key (`Esc`) that's already pane-agnostic on both (today it cancels composer / closes picker — modal-unwind only) and extends its meaning to "leave current context." `Enter` gains the parallel meaning "commit current context." `Tab` returns to its native browser semantics on the webapp; on the TUI it's removed because the underlying concept it routed (single-bit pane focus) now has a better key.

## Decisions

### Pane focus is a Tour-domain concept, lives in `core/`

`paneFocus: "sidebar" | "diff"` becomes a Tour-session slice in `core/tour-session.ts`, sibling to `cursor`. The reducer owns transitions (`paneFocus.setSidebar`, `paneFocus.setDiff`, `paneFocus.toggle`); both surfaces dispatch the same actions and read the same slice.

The webapp's DOM focus is a downstream effect of `paneFocus`, not a parallel source of truth. When the reducer flips `paneFocus.setSidebar`, the webapp's Tour-session adapter calls `.focus()` on the selected sidebar row; when it flips back to diff, the adapter calls `.blur()`. The cursor follows the same pattern (Tour state → render effect); pane focus is the second slice to use it.

Alternatives rejected:
- **DOM focus as source of truth on the webapp; TUI keeps its own boolean.** Forces the webapp's keymap to read `document.activeElement` and ancestor-walk; cross-surface tests can't share a fixture; architecture diverges. Q1 grilling.
- **Surface-local state, no `core/` slice.** Same divergence problem, plus `core/footer-hints.ts` (ADR 0028) needs to know pane focus to render the pane-aware legend; surface-local state means duplicate plumbing.

### `Esc` toggles pane focus; modal-unwind takes precedence

Esc has one consistent meaning: "pop the current context one level outward."

- Composer open → close composer (existing).
- Picker open → close picker (existing).
- Else, `paneFocus === "diff"` → flip to sidebar (new).
- Else, `paneFocus === "sidebar"` → flip to diff (new).

The modal-unwind precedence is unchanged from today; Esc's new behaviour only fires when no modal is open. Esc-from-diff is a no-op today on both surfaces, so promoting it is additive, not breaking.

### `Enter` activates the focused sidebar row; cross-row-kind unified

Enter has one consistent meaning: "activate the focused row in the current context."

- In diff, cursor on interactive row → `primary-action` (expand hidden context; existing).
- In sidebar, focused row is a file → select-file (commit + flip to diff; existing).
- In sidebar, focused row is a folder → **toggle fold (new; replaces the prior no-op)**.

Folder-row Enter is purely additive across both surfaces — today it's a no-op. The new behaviour aligns with the W3C ARIA tree-widget convention (Enter on a parent node toggles expand) and removes the dead spot in Enter's contract.

Alternatives rejected:
- **Keep folder-row Enter as no-op.** Leaves Enter's contract ("activate this row") inconsistent across row kinds.
- **Folder-row Enter drills into the folder's first file.** Less obvious; the existing `l`/→ already covers expand; the existing `n`/`p` covers cross-folder navigation.

### `Tab` / `Shift-Tab` hard-removed on the TUI

The TUI's `Tab` (toggle) and `Shift-Tab` (force sidebar) are deleted from the keymap. Esc covers the toggle. Shift-Tab's "force sidebar" semantic is covered by Esc from diff. Pre-1.0 semver license (Tour's CONTEXT.md packaging entry: "minor=breaking") applies; one CHANGELOG bullet documents the migration.

Alternatives rejected:
- **One-release alias.** Defensible for soft landing, but Tab as a permanent alongside Esc muddies the semantic — Tab is symmetric toggle, Esc is contextual pop. Two mental models for one job; pick one. Pre-1.0 semver lets us pick cleanly.
- **Permanent Tab alias.** Same problem, forever.

The webapp gains no Tab binding (it never had one) and Tab on the webapp continues to walk the browser's native focus order, including walking *past* the sidebar in a single step via the roving-tabindex (next decision).

### Webapp realizes pane focus via roving-tabindex (ARIA tree pattern)

Exactly one sidebar row carries `tabindex="0"` at any time — the currently-selected row. All other rows carry `tabindex="-1"`. When `paneFocus.setSidebar` fires, the adapter calls `.focus()` on the row with `tabindex="0"`; when selection moves via `j`/`k`, the adapter moves `tabindex="0"` to the new row and `.focus()`'es it.

Three properties fall out:
- **Browser `Tab` walks the sidebar as one tab stop, not N tab stops.** Users pressing `Tab` skip past the file tree in one step — matching how the W3C ARIA Authoring Practices Guide specifies tree widgets.
- **Screen readers announce the focused row.** Native DOM focus carries `aria-label` / `role="treeitem"` semantics to assistive tech.
- **Mouse-click on a sidebar row dispatches `paneFocus.setSidebar` AND moves `tabindex="0"` to the clicked row AND `.focus()`'es it.** Mouse and keyboard converge on the same end state.

Alternatives rejected:
- **Container `tabindex="0"` + `aria-activedescendant`.** Weaker SR support, more bespoke plumbing for the same outcome.
- **No DOM focus, pure Tour-internal state.** Loses SR announcement entirely.

### Footer legend becomes pane-aware

`composeFooterHints` (ADR 0028) gains a `paneFocus` parameter. The function emits distinct legend strings per pane on each surface — sidebar mode shows sidebar-relevant keys only (`j/k: file · h/l: fold · Enter: activate · e: expand all · y: yank · L: layout · t: picker · Esc: diff · q: quit` on TUI; webapp's subset of the same). Diff mode shows today's diff legend (minus the retired `Tab: pane`, plus `Esc: sidebar`).

This extends ADR 0028's "the footer doesn't lie" principle: a static legend would either lie in sidebar mode (showing diff-only keys that don't fire) or in diff mode (showing sidebar-only keys), and the sidebar legend is genuinely shorter, so swapping is also a UX simplification.

### Initial `paneFocus` is conditional, driven by the existing seed effect

On tour load:
- Tour has Comments → `paneFocus = "diff"`; cursor seeds at the first Comment via the existing `initialCursor` helper.
- Tour has no Comments → `paneFocus = "sidebar"`; cursor stays null; sidebar selection materializes at the first file row.

The TUI rule (`src/tui/app.tsx:568-584`) already implements the cursor side of this; the new ADR formalises the pane-focus side and brings it to the webapp. Tours-in-progress (agent created the Tour but hasn't commented yet) now give webapp users a usable sidebar-focused entry point where today nothing is highlighted.

### Auto-flip rule: action's target pane drives the flip

An action auto-flips `paneFocus` to the pane that owns its target; pane-internal and pane-agnostic actions don't flip.

| Action | Auto-flip target |
|---|---|
| `Enter` on file row in sidebar | diff (commit) |
| `Enter` on folder row in sidebar | none (toggle is sidebar-internal) |
| `n` / `p` (Comment jump) | diff |
| Click on diff row / card | diff |
| Click on sidebar row | sidebar |
| `t` / `L` / `e` / `y` / `q` (pane-agnostic) | none |
| `l` / `h` (fold controls) in sidebar | none (sidebar-internal) |
| `j` / `k` in either pane | none (motion within pane) |
| `Esc` | toggles to opposite pane |

Diff-only actions (`c` / `r` / `s` — comment / reply / send) stay silently gated when `paneFocus === "sidebar"`. Pressing `c` from sidebar mode is a no-op; the user must Esc to diff first and use the cursor explicitly. Auto-flipping and firing would lose track of where the Comment landed.

### Cursor and sidebar-selection preserved across pane-focus flips

`paneFocus` is purely routing state. The diff cursor and the sidebar's selected-row index are independent slices, untouched by `paneFocus.setSidebar` / `paneFocus.setDiff`. Concrete invariant: cursor on file-A:42 → Esc → walk `j` four times in sidebar to file-E → Esc → cursor still on file-A:42, sidebar selection still on file-E.

Re-entering sidebar mode lands on the last-known sidebar selection. This matches the TUI's existing Tab-toggle behaviour (Q3 grilling) and avoids the "every trip to the sidebar resets the scan position" failure mode.

## Consequences

- The TUI's `sidebarFocused: useState<boolean>` at `src/tui/app.tsx:241` retires. All read sites (8 today) switch to reading `paneFocus` from the Tour-session store.
- The TUI keymap loses two entries (`Tab`, `Shift-Tab`) and gains contextual semantics on `Esc` and folder-row `Enter`.
- The webapp gains a full sidebar keyboard navigation surface (5 actions: `j`/`k`/Enter/`l`/`h`), DOM focus management via roving-tabindex, and a sidebar-mode pane border indicator.
- `composeFooterHints` grows a `paneFocus` parameter; both surfaces re-render the legend on pane-focus flips. ADR 0028's prepend-status pattern is unchanged; status fires onto whichever legend is active.
- The empty-tour webapp experience changes from "nothing highlighted, no keyboard entry point" to "sidebar focused, ready for `j`/`k`."
- Pre-1.0 semver covers the `Tab` removal; CHANGELOG documents the migration in one bullet.
- Tour-session adapter on the webapp grows `focusSidebarRow(rowId)` and `blurSidebar()` methods. The TUI adapter doesn't need analogous methods — border-color flips are pure render driven by the slice.
- Cross-surface tests gain a `paneFocus` dimension; the slice's reducer rules are tested once in `tests/core/tour-session.test.ts` and the surface adapters realise them.
- Action-preview content (ADR 0022's `r: reply to "<title>"` footer line) stays TUI-only; the webapp continues to use auto-recall scroll-into-view for off-screen cards. No change to ADR 0022.

## PRD #356 addendum

Recorded after PRD #356 / issues #357 and #358 landed the context-aware `y` yank.

### Sidebar-mode action gating is a *state-change* rule, not a *lowercase* rule

The original ADR gated lowercase-cursor actions `c` / `r` / `s` silently in sidebar mode and justified the gating with "auto-flipping and firing would lose track of where the Comment / reply / send lands." The phrasing read like a blanket rule for all lowercase-cursor bindings — but the rationale is actually narrower: an action gets gated when auto-firing in the wrong pane risks losing user context. Actions that don't risk losing context (because they don't create, mutate, or land anything) face no such concern.

PRD #356 introduced `y` as the first read-only lowercase-cursor binding: pressing `y` in sidebar mode yanks the selected file row's path; pressing `y` in diff mode yanks the cursored line or — fallback — the cursored file's path. Neither pane mutates Tour state, creates an artifact, or fires an effect whose landing place matters; the only output is a transient footer flash plus the system clipboard. There is nothing to "lose track of." Gating `y` in sidebar mode would be a usability tax with no underlying invariant to protect.

The dispatchers consequently place `y`'s dispatch *above* the paneFocus branching on both surfaces, while `c` / `r` / `s` stay inside the diff-mode branch. The auto-flip table's "pane-agnostic" row (which already listed `y`) governs only the flip side of the contract; this addendum makes the *gating* side explicit too.

### Rule for future lowercase-cursor bindings

When introducing a new lowercase-cursor binding, ask: *would auto-firing this action in the non-cursor pane risk losing user context?*

- **Yes** — the action mutates Tour state, creates an artifact, fires an effect whose landing place matters, or otherwise has lasting consequences whose target the user must explicitly choose. Gate it silently in the opposite pane mode, following the `c` / `r` / `s` pattern. The user Esc's to the right pane before the action fires.
- **No** — the action only reads or flashes (no Tour-state mutation; clipboard writes count as read-only because the user explicitly invoked the yank and the clipboard isn't Tour state). Let it fire in both pane modes, following the `y` pattern. Place its dispatch above the paneFocus branching in the keymap.

The test is sharper than "is the action lowercase?" and sharper than "is the action cursor-targeted?" Both `c` and `y` are lowercase cursor-targeted bindings; the difference is whether their effect has a landing place the user might lose.
