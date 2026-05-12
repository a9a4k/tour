# Web row renderer replaces @pierre/diffs's renderer

> **Status:** Supersedes the webapp half of ADR 0001 (Pierre as web renderer) and the webapp half of ADR 0013 (Pierre owns the chevron UI + expansion state). ADR 0001's Pierre-as-parser claim stands. ADR 0007 (TUI row renderer) is unchanged — this ADR is its webapp parallel.

The webapp renders the diff via a Tour-owned **row renderer (web)** that walks `core/diff-rows.ts`'s `PlannedRow[]` directly into DOM (per-row `<div>` using CSS subgrid). `@pierre/diffs` continues to parse via `parsePatchFiles`; its React renderer, worker pool, embedded stylesheet, and annotation-slot framework are no longer used. Both surfaces now consume the same row planner and the same `core/expansion-state.ts` reducer; the renderer-internal asymmetry from ADR 0001 collapses to a thin DOM-vs-OpenTUI split.

## Why

ADR 0001 accepted Pierre on the grounds that its annotation-slot framework was a real positioning/layout win we'd otherwise have to recreate. That framework no longer rents us anything: PRDs #151 / #154 / #158 each added a Tour adapter on top of Pierre — a gap-row overlay (474 LOC), an expansion-state bridge reaching into a `protected` field (87 LOC), a DOM-walking cursor reconciling Pierre's actual DOM with the planner's prediction (~150 LOC inside `cursor-rows.ts`), a `domTick` + `MutationObserver` retriggering the walker on async paint, and seven CSS-string blobs working around Pierre's grid template, sticky header, comment affordance, cursor outline, plus-button placement, gap-row positioning, and dynamic range tint. The cursor walks our DOM, the gap rows are our DOM, the expansion state is our state in a Pierre-bridged mirror, and the visual chrome is our CSS overriding Pierre's. The only Pierre-owned thing left is the act of rendering the row itself — and that act is the cause of the async-paint reconciliation pile.

## Decisions

### Row stream is the source of truth

The web renderer walks `PlannedRow[]` row-by-row, mirroring the TUI's row renderer (ADR 0007). Annotation cards are first-class entries in the row stream (`kind: "card"`), not slot-filled via callback. The cursor walks `core/flat-rows.ts` directly, not the rendered DOM. The planner → render pipeline replaces the planner → Pierre-prediction → Pierre-DOM → walk-DOM loop.

### Per-row `<div>` with CSS subgrid

Each row is a real DOM element using `grid-template-columns: subgrid`, inheriting columns from the file-level grid. Annotation cards sit between rows as plain `<div>` siblings (`grid-column: 1 / -1` full-width, or side-anchored in split). Replaces Pierre's one-big-`<pre>`-grid + slot-host pattern; gives every row a stable element for cursor outline / range tint / click handler / scroll-into-view, with column alignment guaranteed by the file grid rather than hand-maintained CSS variables.

### Hidden-context expansion is Tour-owned end-to-end

Gap rows render natively as planner-emitted `kind: "interactive"` rows. Click and `Enter` both dispatch to `core/expansion-state.ts` — the same reducer the TUI uses. Pierre's `expandHunk` API and the expansion-state bridge both go away. ADR 0013's webapp half is fully superseded: that promise ("Pierre owns the chevron UI, click handlers, expansion state; Tour writes no expansion code on the webapp") was already partially dead when `c20a263` reverted Pierre's `expandUnchanged` and `b2aaca0` shipped the gap-row overlay; this ADR completes the supersession by also owning the state.

### Cursor outline is a prop, not a DOM mutation

`isCursor` flows as a React prop into each row component. `React.memo` keeps cursor moves at two row re-renders per keystroke. Replaces today's `useEffect` mutating `data-tour-cursor` across shadow roots — a pattern forced by Pierre owning the row, no longer needed. `AnnotationCard` already uses the prop pattern (`isCurrent`); rows now match.

### Syntax highlighting is main-thread Shiki, lazy per file

A fixed common-language grammar set (TypeScript, JavaScript, JSON, Markdown, Bash, YAML, CSS, HTML, Python, Rust, Go) is bundled eagerly; each `FileBlock` tokenizes its content via a `useMemo` triggered when an `IntersectionObserver` (`rootMargin: 200px`) reports the block near the viewport. Tokens are memoized per file per session. No worker pool, no async paint cascade, no binary-build glue for the worker entry. Theme is single, matching `core/theme.ts`'s GitHub Dark palette; future light theme is a token-table extension, not a renderer change.

### No virtualization

Every row in the row stream renders as a real React element. The classifier collapses files that would force virtualization (lockfiles, generated, vendored). Typical Tours stay under ~500 changed lines across <20 files — React reconciles that scale comfortably. Adding virtualization later is hard because sticky headers, scroll-anchor preservation, the IO-based highlight loader, and `?ann=` deep-link centring would all need redesigning around it; deferring until proven necessary is the simpler default.

### Theme reuses `core/theme.ts`

The web row renderer's CSS module imports from `core/theme.ts` directly, same shape as `cursor-css.ts` and `annotations.ts`. No new tokens. Pierre's `WorkerPoolContextProvider` and `themeType` plumbing go away. Light/dark is not a regression risk — Tour ships single-theme dark today; `themeType: 'dark'` was the only deployed value.

### Pierre's parser stays

`@pierre/diffs` remains a dependency for `parsePatchFiles` only; the package moves from `devDependencies` to `dependencies` to match its new runtime-only role. Renderer / worker / CSS subpaths are no longer imported and tree-shake out. The parser boundary in `core/diff-model.ts` is the single-file isolation point for a future swap, exactly as ADR 0001 promised.

### Migration shape: one PR, cold cutover, no flag

The new renderer is built on a long-lived branch, lands in one PR on a release boundary, and replaces Pierre's renderer + deletes the adapter layers in the same merge. A flag would keep adapter code alive during the flag's lifetime, negating the cleanup; an incremental on-`main` rollout is what produced the current adapter pile in the first place. Parity tests (canonical Tours rendered through both renderers, output compared) act as the merge gate.

## Considered Options

- **Keep Pierre as-is.** Rejected: adapter cost is monotonically increasing — every cross-cutting webapp feature lands as a new Pierre adapter, the inverse of ADR 0001's "renderer swap is bounded" promise.
- **Drop Pierre entirely (parser too).** Deferred: migration's win is renderer-side; the parser has been the stable, unproblematic part. Swap is a future ADR if Pierre churns or archives, bounded to `core/diff-model.ts`.
- **Slot-host pattern in the new renderer** (`lineAnnotations` + `renderAnnotation` callback). Rejected: reintroduces the planner-predicts-vs-renderer-realises split under Tour's name, perpetuating the cursor reconciliation problem we're deleting.
- **Web Worker Shiki pool.** Rejected: re-introduces async paint cascade (the cause of `domTick` + `MutationObserver` + DOM-walking cursor) and binary-build worker-entry glue. Sync main-thread is fast enough at Tour's scale.
- **Server-side Shiki bake into bundle.** Rejected: grows bundle ~3×, bakes one theme in, moves work to bundle build with no obvious win for the local-renderer use case.
- **One big CSS grid for the whole file** (Pierre's shape). Rejected: a row stops being a DOM element; cursor outline, range tint, click handler all have to fan out to multiple cells.
- **Pure per-row grid without subgrid.** Rejected: column alignment becomes hand-maintained via CSS variables; fragile when line numbers cross digit boundaries.
- **Eager tokenize all files on mount.** Rejected: deep-link to a middle file via `?ann=` pays ~150ms tokenizing files the user may never scroll to before seeing the target annotation. Lazy via IO with `rootMargin: 200px` cuts this to ~20ms for the target file only; tokenize cost is hidden behind scroll motion for incidental files.
- **`data-tour-cursor` attribute mutation** (today's web pattern). Rejected: forced by Pierre owning the row; React prop is the natural shape once we own the row, and aligns rows with cards (`isCurrent` is already prop-driven).
- **Feature flag for migration.** Rejected: both renderers in the codebase means both adapter trees stay alive, negating the deletion.
- **Incremental on `main`.** Rejected: every "piece" of the Tour-owned path that's landed so far had to coexist with Pierre's `FileDiff`, which forced the adapters in the first place. The remaining work is a single move, not decomposable.

## Consequences

- **Deletes** (approximate LOC): `gap-row-overlay.ts` (474), `pierre-expansion-bridge.ts` (87), the DOM-walking half of `cursor-rows.ts` (~150), most of `dom-walk.ts`'s shadow-DOM helpers (~80), the `useEffect` cursor-overlay mutation path in `cursor-overlay.ts`, the `domTick` + `MutationObserver` block in `App.tsx`, the R1/R2 race-mitigation block (`pendingAnchorRef` + `onPostRender` re-fire), the seven CSS-string blobs in `App.tsx`, the Pierre worker bundling in `web/server.ts` and `src/web/client/main.tsx`'s `WorkerPoolContextProvider`. Net delete ≈ 800 LOC.
- **Adds** (approximate LOC): web row renderer (~500), Shiki integration with IntersectionObserver + per-file memoization (~150), CSS module referencing `core/theme.ts` (~150), expansion-state wiring in `App.tsx` (~30), parity test harness (~200). Net add ≈ 1000 LOC.
- **Net diff: ~+200 LOC, structurally simpler architecture.** The dominant win is shape: one row planner consumed by two row renderers, one expansion reducer per surface, one cursor walker per surface. The line-count is near-flat; what changes is that every line traces to a Tour-defined responsibility instead of a Pierre adapter.
- **Build:** binary-build glue for Pierre's worker entry (`a58e5e6`, `8a67584`) goes away; compiled binary loses Pierre's worker + Shiki worker subpath payload.
- `@pierre/diffs` moves from `devDependencies` to `dependencies`. Bundled surface shrinks to `parsePatchFiles` and `FileDiffMetadata` only.
- Theme support stays single-theme dark. Light theme remains a future extension at the `core/theme.ts` level.
- **Reversibility:** bounded but expensive. Re-adopting Pierre's renderer would mean re-introducing the adapter trees this PR deletes — a re-migration in the other direction, not a revert. The hedge is the parser boundary in `core/diff-model.ts` staying narrow: if Pierre's parser becomes unmaintained, swap to a Tour-owned or alternative parser is one-file scope.
- **CLI and bundle JSON shape are unchanged.** Agents writing annotations, the bundle's per-side `oldContent` / `newContent`, the `tour.toml` schema — none of these are touched. Migration is renderer-internal.
- CONTEXT.md's "Diff engine" entry advances to v2 with Pierre's parser-only role explicit.
