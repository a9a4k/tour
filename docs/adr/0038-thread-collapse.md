# Per-Thread collapse on `Enter`; global toggle on `Shift+C`

> **Status:** Retires the global `Shift+C` (collapse-all-replies) gesture introduced as a TUI prop and replaces it with a per-Thread minimize action on both surfaces. References ADR 0029 (Comment vocabulary), ADR 0030 (Tier 1 lowercase / Tier 2 capital convention), ADR 0036 (event-sourced persistence — informs the cascade-delete drop rule), and ADR 0037 (per-Reply cursor stops — informs the validator clause).
>
> **Amended (issue #406, 2026-05-17):** the per-Thread binding moved from `Shift+C` to `Enter` on a Card; `Shift+C` is now the global "collapse all / expand all" toggle. Sections below mark the amended rules inline.

The previous `Shift+C` hid every Thread's Replies at once, leaving every parent Card at full height. The actual user need is "I'm done with this one — hide it from view"; this ADR replaces the global verb with GitHub's per-Thread minimize gesture so a reviewer can scroll past resolved Threads cheaply while keeping the active ones expanded.

Issue #406's amendment then split the gesture across two scopes: `Enter` for per-Thread (matching org-mode `TAB` and the sidebar's existing `Enter: toggle-folder`), and `Shift+C` for the global "collapse all / expand all" toggle (matching ADR 0030's exemplar table where `C` = collapse-all, and aligning with the local + Shift-modified global pairing in Reddit Enhancement Suite, IntelliJ, VS Code, etc.).

## Why

Threads with replies dominate the diff stream. Once an agent or human posts even one Reply, the Card stretches to a third of the page. The global `repliesCollapsed: boolean` hid the Replies but kept the parent at full height; the visual savings were marginal and the affordance was all-or-nothing. Reviewers walking a Tour with 10–20 active Threads want to mark individual ones as "absorbed" and keep scrolling.

Two options:

1. **Per-Thread collapse, single `collapsedThreads: Set<string>`.** The unit of collapse is the Thread (parent + Replies). `Shift+C` toggles the cursored Card; engagement actions auto-expand; destructive cascade actions force expand-first; watcher-delivered events never auto-expand.
2. **Per-Reply collapse + auto-collapse-on-reply heuristic.** Each Reply is independently hideable; Threads collapse themselves when they receive a Reply (treating Replies as a "done" signal).

(2) was rejected. Tour has no resolution state (CONTEXT.md), so a Reply doesn't signal "Thread is done" — auto-collapsing on Reply would lose visibility of the freshly-landed agent answer the user *wants* to read. Per-Reply collapse is also more surface area than the user need warrants: the existing pain is whole-Thread noise, not Reply-specific clutter.

## Decisions

### Collapse is explicit, per-Thread, never automatic

The unit is the Thread (top-level Comment + its Replies). Reply nodes themselves are not independently collapsible. No auto-collapse-by-default-when-Thread-has-replies heuristic. The global `Shift+C` is retired with no replacement collapse-all gesture in v1 — revisit only if per-Thread proves insufficient.

### `Enter` per-Thread; `Shift+C` global toggle; chevron on the Card header

**Amended (issue #406).** `Enter` on a Card toggles collapse on the cursored Thread on both TUI and webapp. When the cursor isn't on a Card, `Enter` keeps its existing semantics: interactive row → `primary-action`; diff row → no-op; sidebar folder row → fold toggle; sidebar file row → select-file. A Reply-cursor normalises to the Thread root via `threadRootIdOf` (same path the validator's cursor-on-Reply projection uses).

`Shift+C` is the global "collapse all / expand all Threads" toggle. Direction is computed at the App-side handler: any Thread currently expanded → `thread.collapseAll`; every top-level Thread already in `collapsedThreads` → `thread.expandAll` (mixed states resolve toward "hide everything", the more common intent). Zero top-level Threads → labelled footer no-op.

The webapp Card header keeps its clickable chevron — `▾` when expanded, `▸` when collapsed. Click moves the cursor onto the Card (consistent with click-to-position rules) and toggles the collapse. TUI Card-header chevron click stays unchanged.

The original (pre-#406) shape was `Shift+C` for per-Thread with no global gesture; both halves of the issue #406 redesign — moving local to `Enter` and binding global to `Shift+C` — reuse existing keys without inventing a new chord namespace.

### Action-axis rule

Modifying actions auto-expand the Thread; destructive cascading actions force expand-first; external events never expand.

| Action | On collapsed Thread |
|---|---|
| `r` (reply) | Pre-dispatch `thread.expand(id)`, then open composer. |
| `R` (send-to-agent) | Pre-dispatch `thread.expand(id)`, then dispatch `requestReply`. |
| `d` (delete) | No-op; footer hint `d: — (Thread collapsed, expand to delete)`. |
| Future `edit` / `resolve` | Pre-dispatch `thread.expand(id)`, then act. |
| Watcher: reply lands | No state change. `💬 N` ticks up. |
| Watcher: lock pill activates | No state change. Pill renders on the one-liner. |
| Watcher: Thread cascade-deleted | Drop id from `collapsedThreads`. |

The principle generalises beyond `r`/`R`/`d`. Future per-node verbs from ADR 0037's roadmap (`edit`, `resolve`, reply-to-a-reply) inherit the same dispatch pattern: modifying → auto-expand; destructive-cascading → force expand-first.

The rationale for asymmetry: opening a reply composer below hidden context is the wrong picture (the user is re-engaging anyway, so making the existing Replies visible is correct). But silently cascade-deleting Replies the user can't see is dangerous — surface the destruction first.

### Cursor validator projects Reply → parent on collapse

`CardAnchor.commentId` was broadened by ADR 0037 to address any node in the Thread (parent or Reply). When the cursored node is a Reply *and* the parent Thread is in `collapsedThreads`, the cursor validator projects the anchor to the parent's id. Generalised principle: **project to the most-specific live stop in the same lineage.** The parent remains a live stop (the Card row is still in the flat-row stream); the Reply id is not (the one-liner doesn't render its Replies). Projecting preserves the user's "I'm on this Card" intent without showing a phantom cursor anchored at a hidden node.

### Cursor and stops

A collapsed Thread is a single cursor stop on both `j`/`k` (step) and `n`/`p` (jump). Per-Reply stops from ADR 0037 exist only inside expanded Threads. `n`/`p` jumping onto a collapsed Card does **not** auto-expand — navigation is not modification.

### State shape and lifecycle

Single slice on the Tour-session reducer:

```ts
collapsedThreads: Set<string>; // top-level Comment ids
```

Reducer actions: `thread.collapse(id)`, `thread.expand(id)`, `thread.toggle(id)`. Each emits `revalidateCursor` when the cursor is non-null (defence in depth for the validator clause — same posture as `folds.*`).

**Amended (issue #406).** Two bulk actions for the global `Shift+C` toggle: `thread.collapseAll` populates the set with every top-level Comment id in the current bundle (no-op when the bundle isn't resolved or every id is already present); `thread.expandAll` empties the set (no-op when already empty). The App-side handler picks the direction from the current state — it doesn't live on the reducer because the predicate ("any Thread expanded?") needs the bundle's top-level set and the current `collapsedThreads` size, both of which the App layer already has at hand. Both bulk actions emit `revalidateCursor` for the same defence-in-depth reason as the single-Thread variants.

Lifecycle:

| Event | Behaviour |
|---|---|
| Watcher-driven bundle reload | Preserve (with cascade-delete prune below) |
| Tour switch | Clear (matches `collapsedFolders`) |
| Webapp page reload | Reset to all-expanded (in-memory, no localStorage) |
| Layout toggle (`L`) | Preserve |
| Reply-lock change | No effect on slice (paints pill only) |
| Cascade-deleted Thread | Drop id from the set |

Cascade-delete is enforced at `bundle.refreshed`: the reducer intersects `collapsedThreads` with the set of top-level Comment ids in the inbound bundle. A Thread that vanishes (parent and all replies deleted) drops out of the user's hide-set automatically.

No URL persistence — collapse is per-renderer-session, matching the existing folder-fold posture.

### Footer hints

**Amended (issue #406).** The legend's `Enter` and `C` verbs both flip contextually:

- `Enter:` flips by the cursor — `Enter: expand` (interactive row OR collapsed Card), `Enter: collapse` (expanded Card), omitted (plain diff row, no-op there).
- `C:` flips by the bundle — `C: collapse all` (any Thread expanded), `C: expand all` (every Thread already collapsed), omitted (zero Threads — `Shift+C` is a labelled footer no-op).

The retired pre-#406 labels (`C: collapse replies`, per-cursor `C: collapse` / `C: expand`) are gone from both legends. Sidebar-mode legends drop both hints entirely — `Enter` keeps its `Enter: activate` (file → select; folder → toggle) and `Shift+C` is diff-pane only.

### Counts (unchanged)

Sidebar per-file `[N]` badge counts all top-level Comments; top-header `[← N/M →]` pill walks all top-level Comments. Collapse is a view filter, not a data signal; counts must not depend on it.

### Deferred / not extracted

`projectAnchorOnCollapse` was considered as a standalone `core/thread-collapse.ts` module. Rejected: it's one clause / a small helper function and reads more honestly co-located with `validateCursor` in `core/cursor-state.ts`. Extracting it would fragment the validator across files for no testability gain. The two helpers (`projectAnchorOnCollapse`, `pruneCollapsedThreads`) live next to their callers (the validator and the `bundle.refreshed` reducer branch).

## Consequences

- The `repliesCollapsed: boolean` prop is removed from `CommentCard` / `DiffRows` and from the TUI App's local `useState`. The CommentCard renders a one-liner when `collapsed: true` (a derived prop computed from the per-card `collapsedThreads.has(root.id)`).
- The TUI keymap returns `toggle-thread-collapse` for `Enter` on a Card (issue #406; previously `Shift+C`) and `toggle-all-threads-collapse` for `Shift+C` in the diff pane. Both wire into App-side handlers; `toggle-thread-collapse` dispatches `thread.toggle` against the cursored Card's root id (resolved through `findThreadByNode` so a Reply-cursor still targets the right Thread); `toggle-all-threads-collapse` dispatches `thread.collapseAll` or `thread.expandAll` based on the current `collapsedThreads` membership of the bundle's top-level ids.
- The webapp's `cursor-keymap.ts` carries the same two arms: `Enter` on a Card → `toggle-thread-collapse`; `Shift+C` (diff mode) → `toggle-all-threads-collapse`. The App-side handlers mirror the TUI's dispatch shape.
- Action seams in both surfaces (`r`/`R` on the cursored Card) pre-dispatch `thread.expand` before opening the composer / dispatching the agent reply.
- The TUI `d` handler refuses on a collapsed Thread with the documented footer hint. The keymap's `noop-delete-on-stub` case continues to handle the existing ADR 0036 stub case; the new collapse case is a per-Thread predicate applied after the keymap's card-only gate.
- ADR 0037's per-Reply cursor stops continue to work inside expanded Threads. When a Thread collapses while the cursor sits on a Reply, the validator promotes the anchor to the parent's id so the visible cursor stays on the same Card.
- Reducer tests cover `thread.collapse / expand / toggle / collapseAll / expandAll`, the lifecycle rules, and the cascade-delete prune. Validator tests cover the Reply → parent projection on collapse and the unchanged behaviour when the Thread is expanded. Renderer-only changes (the one-liner JSX, the chevron click) are not under unit-test coverage, matching the existing posture for `CommentCard.tsx`.
