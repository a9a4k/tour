# Tour-session runtime — impure half of the Tour-session triple

> **Status:** Records the architecture introduced by PRD #278. Extends the pure-state foundation laid by PRDs #207 (foundation), #229 (cursor + expansion slices), #234 (composer + folds + layout slices), and #242 (Tour-session view). Supersedes the parallel-`useEffect` intent-listener pattern those PRDs left in `tui/app.tsx` and `web/client/App.tsx`; the runtime is now the single home for impure intent realization. Does not affect ADRs 0010 / 0015 / 0017 / 0021 / 0022 / 0023 / 0024 / 0025 — each one's invariants stand.

The Tour-session aggregate becomes a **triple**: reducer (pure state) + view (pure projection) + runtime (impure executor). Each renderer ships a **Tour-session adapter** implementing the runtime's substrate seam. Surfaces shrink to wiring + JSX; the intent listener, watcher subscription, post-submit eager refetch, and parallel cursor-revalidation effects collapse into the runtime.

## Why

PRDs #207 / #210 / #211 / #229 / #234 / #242 each landed a slice of the Tour-session aggregate, building from the picker reducer through to the per-namespace memoised view. Each shrank App.tsx by lifting some piece of state or derivation into `core/`. But the slices stopped short of the impure half — the actual realization of emitted intents and reactions to tour events. That code stayed in two parallel `useEffect` blocks (one per surface), reimplementing the same workflow with substrate-specific calls.

By the time PRD #242 (Tour-session view) landed, the two `App.tsx` files were 1799 / 2112 lines and still growing — the TUI had absorbed a third `expansion.seedFromOrphans` dispatch site without anyone noticing, an `useRef` cluster (six refs) had appeared to mitigate stale-closure inside the intent listener, the TUI eagerly re-fetched the bundle post-submit while the webapp waited for SSE, and `revalidateCursor` had two divergent implementations (inline `deriveTourSessionView` vs ref-based `validateCursor`). The CONTEXT.md claim "surfaces shrink to adapters" was directionally true but not literal: the surfaces were drivers, not adapters.

Lifting the impure half completes the triple. The runtime owns every cross-async workflow CONTEXT.md pins ("watcher reload arrives mid-composer," "cursor re-validates after fold toggle," "post-submit scroll into view"). Surfaces become genuine adapters — they translate input events into `store.dispatch(...)`, expose platform primitives via `TourSessionAdapter`, and render the view. Nothing else.

## Decisions

### The triple: reducer + view + runtime

`core/tour-session.ts` is the **reducer** (pure state machine, no IO). `core/tour-session-view.ts` is the **view** (pure projection from `(bundle, state)`, no IO). `core/tour-session-runtime.ts` is the **runtime** (impure executor, IO via the adapter). The three together are the Tour-session aggregate; each has one job.

The runtime depends on the reducer's `TourSessionStore` (for `onIntent` subscription and `dispatch`) and on a `TourSessionAdapter` interface. It depends on nothing else from the surface — no React, no DOM, no OpenTUI imports. Tests drive the runtime through a fake adapter; that's the test surface, not the surfaces themselves.

### Adapter as the seam

`TourSessionAdapter` exposes only what differs between renderers: `fetchBundle`, `fetchReplyLock`, `writeAnnotation`, `requestReply`, `subscribeTourEvents`, three `scrollTo*` methods, `revealFileInSidebar`, `mirrorTourUrl`, `mirrorAnnUrl`. Each surface ships one adapter. URL-mirror methods are permanent no-ops in the TUI.

The seam earns its keep: two genuinely different substrates (TUI: in-process callbacks + OpenTUI scroll + `TourWatcher` + no-op URL; web: HTTP fetch + DOM scroll + SSE + `window.history`). Same shape as the `ShippedAdapter` pattern in `src/agents/` — one interface, multiple concrete adapters, runtime knows none of them by name.

### Watcher subscription belongs in the runtime

The TUI's `TourWatcher` and the webapp's `EventSource` were producers of the same event vocabulary (`annotation-changed` / `reply-in-flight` / `reply-cleared`). The runtime is the natural consumer. The adapter's `subscribeTourEvents` normalizes both transports into one `TourEvent` union; the runtime handles each event identically across surfaces. The runtime re-subscribes on tour-switch via a single store-state subscription — no per-surface `useEffect` keyed on `bundle.tour.id`.

Supersedes the parallel `useEffect` pattern from PRDs #207 / #210 / #211.

### Reducer absorbs orphan-window seeding

`tour.switched` and `bundle.refreshed` now derive the expansion-slice seed from `bundle.files[*].orphanWindows`. The explicit `expansion.seedFromOrphans` action stays in the union (preserves test paths + future direct dispatch) but no surface call site remains. This is the only reducer change required by the runtime introduction; the rest of the impure work stays on the runtime side.

### Eager post-submit refetch is dropped

The TUI's post-`composer.submitted` chain (re-fetch bundle, seed orphans, dispatch `bundle.refreshed`) is removed. The watcher path delivers the same refresh within a few ms — the eager refetch was a pre-watcher-maturity workaround that introduced an asymmetric race against the SSE/FS event. The runtime + watcher path is now the single reload trigger across surfaces.

Adapter-side compensation: the TUI's `scrollToCard` retries against the DOM until the freshly-written card appears (bounded retry budget — covers the watcher latency without an explicit refetch).

### `selectedFile` does NOT move into the store

The TUI's sidebar is row-indexed (`selectedRowIdx` over a flat `VisibleRow[]` stream); the webapp's is file-path-indexed (`selectedFile`). The asymmetry is structural — collapsing it requires restructuring TUI's sidebar keyboard model (`sidebarFocused`, j/k routing). The adapter keeps `revealFileInSidebar(file)` as a surface-level concern. PRD #234 punted this for the same reason; the runtime introduction does not change the math. Revisit only if/when TUI sidebar restructures.

### `send-to-agent` joins the runtime

A new reducer action `send-to-agent { tourId, annotationId }` is the entry point for the `s` keystroke (TUI) and the **Send to {agent}** click (webapp). The action holds no state — it defends in depth (cursor must be on a `CardAnchor`; reply-lock must not be held) and emits an `(scrollCursorTarget, requestReply)` intent pair. The runtime routes `requestReply` to `adapter.requestReply` (fire-and-forget; the watcher's lock events drive the in-flight pill).

Mirrors `composer.submit` → `submitAnnotation` exactly. Preserves ADR 0021's explicit-dispatch invariant: only user action reaches `send-to-agent`.

## Considered alternatives

**A1 — per-intent operations on the adapter.** Each adapter method does the full workflow end-to-end (`adapter.loadAndSwitchTour(id)` rather than `adapter.fetchBundle(id)`). Rejected: A1 fails the deletion test — the workflow logic stays on the surface (in the adapter implementation) and duplicates across surfaces. The whole point is to concentrate orchestration; A2 (fine-grained primitives) is the only shape that earns the seam.

**Subsuming the keymap dispatcher too.** Tempting to absorb `tui/keymap.ts` + `web/client/cursor-keymap.ts` (the third candidate in the architecture review). Rejected for this PRD's scope — the keymap is its own deepening opportunity with different trade-offs (the TUI carries a sidebar-focus context the webapp doesn't have). Filed separately.

**Optimistic merge of new annotations into the bundle.** Tempting to dispatch the just-written annotation into `state.bundle.annotations` from the reducer's `composer.submitted` branch and let the watcher event be confirmation-only. Rejected for now — adds reducer complexity in exchange for visibility latency the watcher path already keeps in the low-ms range. Revisit only if watcher latency proves visible.

**Splitting slice 2 into "scaffold only" + "watcher migration."** Rejected — the watcher migration is what validates the adapter's event shape. A scaffold-only slice would land an unused interface and be re-touched a day later.

## Migration

Landed in seven slices (PRD #278 issues #281–#287), in dependency order:

1. **Reducer fold** (`tour.switched` / `bundle.refreshed` seed expansion).
2. **Runtime scaffold + adapter interface + watcher subscription.**
3. **`loadTour` intent** moves into the runtime.
4. **`submitAnnotation` intent** moves; TUI eager refetch deleted.
5. **`revalidateCursor`** moves; two divergent impls collapse.
6. **Scroll / mirror / reveal intents** move; TUI stale-closure refs deleted.
7. **`send-to-agent` action + `requestReply` intent + `adapter.requestReply`.**

Each slice was independently shippable and decreased both `App.tsx` files monotonically. Combined reduction: −507 LOC across the two surfaces (TUI 1799 → 1526; web 2112 → 1878). The remaining `App.tsx` size is surface wiring (cursor-follow scroll, sidebar selectedRowIdx mirror, lazy materialization, keymap handlers, JSX) — not intent-listener glue.
