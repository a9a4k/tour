# TUI sticky file-header above the diff scrollbox

> **Status:** TUI-only. Records the design introduced by issue #307. The web has equivalent behaviour via `position: sticky` on `.tour-file-header` — left untouched here. The same brief calls out a separate web bug (`overflow: hidden` on `.tour-file-outer` defeats sticky) tracked as a follow-up issue.

The TUI diff pane gains a single always-visible "active file" header row above the scrollbox. The row names the file the viewport is currently inside, derived from scroll position. The per-card `<FileHeader>` row is removed; each card's filename now lives inline in its top border via the box `title` prop, so the upcoming file's name previews as its labeled border scrolls into view.

## Why

In the TUI, each file card's first child used to be a `<FileHeader>` row showing the file label and per-file Expand-all (`↕`) chrome (ADR 0025, amended #297 / #298). The header scrolled with the content — once a card was taller than the viewport, the user was reading mid-file with no on-screen filename. The breadcrumb in `TopHeaderTui.selectedPath` tracks the *sidebar-selected* file, not the actively-scrolled file, so mouse-wheel scrolling past the cursor left the user with no "what file am I in" cue.

GitHub's webapp solves this with `position: sticky` on `.tour-file-header`. OpenTUI has no sticky-equivalent layout primitive — the missing parity has to be synthesised from scroll position.

## Decisions

### Derive `activeFile` from `(scrollTop, cardOffsets)` — pure function, surface-side wiring

`src/tui/active-file.ts` exports two pieces: the pure `deriveActiveFile(scrollTop, cards) → fileName | null` and the impure `collectFileCardOffsets(scrollBox, fileNames) → FileCardOffset[]`. The split mirrors `buildRowYResolver` (issue #303): the substrate-walking half lives near the scrollbox, the derivation rule lives in isolation so it can be unit-tested without spinning up OpenTUI.

The derivation rule — **last card whose top edge is at or above the viewport top** — matches GitHub's "previous-file stays sticky until the next reaches the top" semantics. Two edge fallbacks: above the first card's top → first card; below the last card's bottom → last card. Empty file list → `null`. The seven cases (empty / above-first / inside-first / in-gap / inside-middle / inside-last / below-last) are pinned by unit tests against a synthetic `FileCardOffset[]` so the rule can't drift without a failing test.

`collectFileCardOffsets` walks the scrollbox's renderable tree the same way `buildRowYResolver` does (DFS from `sb.content`, `updateFromLayout()` per node so culled subtrees report fresh Yoga positions, screen-y → content-y translation via `screenY - viewport.y + scrollTop`). Returns offsets in the input `fileNames` order so the derivation upstream doesn't have to re-sort.

### Drop the in-card `<FileHeader>`; use box `title` for per-card labeling

Stacking two filename rows (sticky pane-top + in-card) would burn one row of usable content height per card and create a visual stutter as the in-card label scrolled past the sticky one. Two options:

- **Keep the in-card `<FileHeader>` and add the pane-top header on top.** Two filenames per file at boundary crossings, plus one row of permanent content-height loss per card. Rejected.
- **Drop the in-card `<FileHeader>` entirely and label each card via the box `title` prop.** The card's top border becomes the filename slot — same pattern the sidebar (` Files `) and diff pane (` Diff `) outer boxes already use. The upcoming file's name previews as its labeled border scrolls into view, without consuming a content row. Chosen.

The pre-#307 in-card chrome (file label + Expand-all `↕`) was two responsibilities co-located on one row. Splitting them: filename → card-border `title`, Expand-all → pane-top header's `↕` cell. The `FileHeader` component itself is unchanged — same props, same render — only its container moves from per-card to pane-top.

### Pane-top header retargets to whatever file is currently active

The active-file header's `fileName` / `label` / `hasMultipleHiddenGaps` / `onExpandAll` all reflect the *currently scrolled-into file* — not cursor, not sidebar selection. Clicking the `↕` dispatches `expansion.expandFileAll` for the active file. The ≥ 2-hidden-gaps gate (ADR 0025 amended #298) is preserved and recomputed against the active file's metadata + expansion state on every render.

The keyboard `e` binding stays decoupled — it targets the *cursor's* file (via `RowAnchor.file` / `CardAnchor.annotation.file`, with sidebar fallback), unchanged from ADR 0025. Mouse `↕` clicks dispatch against the *scroll position*, keyboard `e` dispatches against the *cursor*. Two surfaces, two anchors — both intentional. Mouse: "I see this file's chrome, click on it." Keyboard: "expand the file I'm reading via the cursor."

**Reachability trade vs. the pre-#307 multi-card chrome.** Pre-#307, every visible card carried its own `↕`, so a viewer could click Expand-all on any file whose card-top was on screen — multiple buttons simultaneously reachable. The flip side, which ADR 0025 #297 / #298 already had to paper over: once the user scrolled into a tall card, *that* file's `↕` scrolled off with the header and became unreachable from chrome until the user scrolled back up (`e` was the explicit workaround). Post-#307 inverts the reachability matrix: the common case (Expand-all for the file you're reading) is always one click away on the pane-top chrome, the rare case (Expand-all for a different visible card without scrolling) loses its chrome surface but is still keyboard-reachable via cursor-move + `e`. The common case wins; the rare case keeps a path.

### Real-time updates via 50ms scroll poll

OpenTUI doesn't surface a scroll event on the scrollbox renderable (no `onScroll` callback in `ScrollBoxRenderable`'s public API, no documented frame-tick event on the renderer). The scroll-driven re-render paths Tour relies on today (cursor-driven motion → `store.dispatch(...)` → React render, programmatic scroll-into-view → same, layout reflow → same) cover keyboard and programmatic scrolls but miss two cases:

- **Free mouse-wheel scroll.** OpenTUI handles the wheel directly on `ScrollBoxRenderable.onMouseEvent`; mutates `sb.scrollTop` without dispatching anything React-visible.
- **Smooth-scroll tweens (issues #294 / #299).** `smooth-scroll.ts` mutates `sb.scrollTop` per OpenTUI frame via the Timeline engine — again no React dispatch per frame, the render only re-runs when the dispatching keystroke landed.

The fix is a `setInterval(50ms)` tick inside a `useEffect`. The tick reads `sb.scrollTop`, re-collects card offsets, runs `deriveActiveFile`, and calls `setActiveFile` with a same-ref short-circuit (so unchanged scroll positions don't force a React render). 50ms ≈ 20Hz, well under the user-perceived "snap-flip" threshold for boundary crossings, and the work per tick is O(files) at most — a DFS over a handful of scrollbox children. The interval tears down on unmount.

Alternatives considered:
- **Compute `activeFile` purely during render and rely on React-driven re-renders.** Misses free mouse-wheel and tween updates. The brief explicitly calls out mouse wheel as a case that must update — rejected.
- **Attach `onMouseScroll` to the scrollbox via the JSX prop bridge.** The OpenTUI `<scrollbox>` accepts the renderable's event setters as props, but the scrollbox's own `onMouseEvent` handler consumes the wheel before the prop callback fires — wiring `onMouseScroll` either competes with OpenTUI's internal scroll plumbing or never sees the wheel. Rejected as fragile.
- **Subscribe to the renderer's frame callback.** OpenTUI's `CliRenderer` extends `EventEmitter` but the frame loop doesn't emit a public event. Reaching into private state to hook in would be a layering violation. Rejected.

### File card box ids stay `file-card-${name}` (unchanged)

Existing scroll machinery (`scrollChildIntoView`, smooth-scroll, scroll-into-view) targets file cards by the `file-card-${name}` id. The active-file tree walk piggybacks on the same id — adding a new id alongside would be churn for no gain. The id is the layout-invariant handle for "this file's card" across both the scroll-into-view path and the active-file derivation.

## Consequences

- The TUI gains a "what file am I in" affordance that survives free mouse-wheel scrolling — closes the prior gap where the cursor's file (sidebar-selected file) could differ from the on-screen file with no visual cue.
- Each file card loses one row of header chrome and gains a labeled top border. Card height drops by 1; the diff body that used to start at `card.top + 2` (border + header) now starts at `card.top + 1` (border with inline label). Cumulative effect across N files: N rows of content height returned to the viewport.
- The 50ms scroll poll is the only ongoing per-frame work introduced. Measured cost: a single tree walk over file-card children (10s of nodes at worst) + a small loop in `deriveActiveFile`. Negligible vs. OpenTUI's render loop.
- Surface parity with the web's existing sticky-header behaviour is now intentional. The webapp's separate sticky bug (`overflow: hidden` on `.tour-file-outer`) is tracked as a follow-up.
- Issue #311 retired the `TopHeaderTui.selectedPath` cursor-file path row as redundant: the sidebar row-highlight remains the sole surface for cursor location, and the pane-top header introduced here is now the sole surface for the scroll-active file.
- Issue #314 retired the `FileSeparator` rule row introduced by #263 — its premise (single outer `┌─ Diff ─┐` box with no per-file borders) was undone here when each file card gained its own labeled `borderStyle="single"` frame; the inter-card horizontal rule duplicated the boundary cue the frames already carry. Card `marginBottom={1}` remains the sole source of inter-card breathing room.

## References

- ADR 0024 — Web row renderer (per-card `<FileHeader>` lineage on the web side; web sticky behaviour is via CSS not a separate component).
- ADR 0025 — Directional hunk expand buttons (amended #297, #298 — per-file Expand-all chrome rule, ≥ 2 hidden gaps gate; reused here on the pane-top header).
- Issue #307 — sticky file-header above diff scrollbox.
- `src/tui/active-file.ts` — pure derivation + impure tree walker.
- `tests/tui/active-file.test.ts` — derivation rule pinned across the seven cases.
