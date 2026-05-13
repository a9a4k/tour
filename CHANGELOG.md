# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-05-12

### Breaking changes

- **Reply-agent dispatch is now explicit, not implicit.** Previously, the
  renderer's watcher auto-fired a reply-agent dispatch on every new
  human-authored Annotation when `--reply-agent <name>` was set. Now,
  dispatch only happens when the user presses `s` on a focused human
  Annotation in the TUI, or clicks **Send to {agent}** on a human card
  in the webapp. The watcher's role narrows to state observation only
  (annotations.jsonl → bundle re-render; .reply-lock.json → in-flight
  pill + affordance disabled state). The new `POST /api/tours/:id/
  request-reply` endpoint maps the four dispatch result kinds to HTTP
  status codes (202 dispatched / 409 busy / 404 invalid-annotation /
  400 no-reply-agent). Reverses the auto-dispatch portion of ADR 0010;
  see ADR 0021 for rationale (paid-LLM-inference economics — every
  silent over-dispatch under the old model was real money).

  Issue: #184 · PRD: #181 · ADR: 0021

- **Bare `tour` picks the best surface for your environment.** Previously,
  `tour` (no subcommand) always launched the TUI. It now starts the
  webapp and prints its URL when a browser is reachable (desktop
  linux/darwin with a TTY, `open` or `xdg-open` on PATH, no SSH session)
  and falls back to the TUI otherwise (ssh, piped/non-TTY stdout,
  windows, no opener). The URL is Cmd/Ctrl-clickable in modern
  terminals — bare `tour` does **not** auto-open the browser, so
  re-running the command does not stack tabs. Users who want the
  browser launched automatically run `tour serve --open` explicitly,
  which is unchanged. `tour tui` is also unchanged. The first-run
  banner (no tours present) still prints unchanged.

  The deciding criterion is annotation fidelity: the webapp renders
  markdown + mermaid, the TUI shows raw source. New users on a desktop
  now get the higher-fidelity surface by default.

  Issue: #175 · PRD: #174

### Changed

- **Cutover: App.tsx swaps to `<FileBlock>`; Pierre adapter pile deleted
  (PRD #212 slice 7).** The webapp's diff body no longer mounts Pierre's
  `<FileDiff>` / `<MultiFileDiff>`. App.tsx now maps each parsed file to
  a `<FileBlock>` (#218) walking the planner's `PlannedRow[]`, wires
  `useState(ExpansionState)` from `core/expansion-state.ts` (orphan-
  windows seeded on bundle load; both surfaces now share the reducer),
  dispatches expansion via `onDispatchExpand`, mirrors clicks via
  `onRowClick`, and emits a single `<style>{FILE_GRID_CSS}</style>` at
  the diff pane root. Cursor outline is the `.is-cursor` className flow-
  ing through `<FileBlock>` → row components — no more `data-tour-cursor`
  attribute mutation. The Pierre worker pool, `WorkerPoolContextProvider`,
  and worker-bundling entry-point are removed from the binary build;
  `@pierre/diffs` stays only for `parsePatchFiles` and moves from
  `devDependencies` to `dependencies` to match its new runtime-only role.
  `shiki` is now a direct dependency.

  Deletions: `gap-row-overlay.ts`, `pierre-expansion-bridge.ts`,
  `cursor-overlay.ts` (DOM-mutation cursor + placement IO),
  `cursor-rows.ts` (Pierre shadow-DOM walker), `dom-walk.ts`,
  `plus-button-overlay.ts` (mouse `+` affordance — keyboard `a` still
  opens the composer), `click-anchor.ts`, `annotations.ts` (Pierre
  `lineAnnotations` + range-tint CSS injection), `cursor-css.ts`, the
  seven App-level CSS-string blobs, the `pendingAnchorRef` + R1/R2
  race mitigation, the wheel/touch/keydown cancel listeners,
  `BASE_DIFF_OPTIONS`, the legacy `<FileBlock>` and `CopyPathButton`
  in App.tsx. Test suite drops `parity-render.test.ts` (#219), its
  parity fixtures, the DOM-mutation overlay tests, and `annotations`,
  `click-anchor`, `cursor-css`, `plus-button-overlay`, `cursor-rows`,
  `cursor-overlay`, `gap-row-overlay`, `pierre-expansion-bridge` tests.

  Issue: #220 · PRD: #212 · ADR: 0024

### Added

- **TUI thins composer + folds + layout through the Tour-session store
  (issue #237).** The TUI's local `useState`s for `composer`,
  `collapsedOverrides`, `collapsedFolders`, `layout`, and the post-submit
  `pendingScrollAnnotationId` are gone — all reads route through
  `sessionState`, all mutations dispatch through the store. Keymap +
  click rewiring: `a` / `r` dispatch `composer.open { target }` with a
  `ComposerTarget` (top-level: file+side+line range; reply: parent id);
  composer keystrokes dispatch `composer.setBody { body }` on every
  change; Enter / submit dispatch `composer.submit`; Esc dispatches
  `composer.close`. Folder Enter / `c`-on-folder dispatch
  `folds.toggleFolder`; file-level `c` dispatches `folds.setOverride`;
  `Shift-L` and the top-header Split/Unified buttons dispatch
  `layout.set`. The intent listener gains two cases:
  `submitAnnotation { tourId, target, body }` calls
  `props.writeAnnotation` (mapping reply targets to their parent
  Annotation looked up from the live bundle) then dispatches
  `composer.submitted { annotation }` on success or
  `composer.failed { error }` on failure;
  `scrollToAnnotation { annotationId }` consumed via a ref +
  `plannedRowsByFile`-keyed useEffect that retries until the
  bundle-refresh re-render mounts the new card (matches the prior
  pendingScroll flow's correctness without the useState). The `loadTour`
  intent handler's hand-rolled composer / folds / overrides resets are
  deleted — the reducer's `tour.switched` cascade is the single home for
  every reset; only the sidebar `selectedRowIdx` reset remains in the
  surface (sidebar selection is out-of-scope per PRD #234). The
  watcher-reload-preserves-draft property — verifiable manually by
  editing an annotation in `.tour/<id>/` while a TUI composer is open —
  now passes as a tested property of the reducer (slice-3 foundation
  fixture). `src/tui/composer-submit.ts` is deleted in favor of the
  reducer's `composer.submit → submitting` no-op-on-resubmit guard plus
  the intent-driven write path; `composer-state.ts` helpers refactored
  to return `ComposerTarget` directly.

  Issue: #237 · PRD: #234

- **Webapp composer + folds + layout routed through the Tour-session store
  (issue #238).** The webapp no longer owns local `useState`s for
  `composerTarget`, `composerError`, the textarea `value`,
  `collapsedFolders`, `collapsedOverrides`, or `layout` — all five slices
  read from `sessionState` and mutate via `store.dispatch(...)`. The
  `<Composer>` textarea is now a controlled component reading
  `state.composer.body` and dispatching `composer.setBody` on every
  keystroke; the slice's tagged-union state machine collapses the
  webapp's three-`useState` composer split into one source of truth, and
  the watcher-reload-doesn't-eat-the-draft invariant is now a tested
  property of the reducer rather than a React-reconciliation accident.
  Keymap + click + segmented-control callsites route through
  `composer.open` / `composer.close` / `composer.submit` /
  `composer.setBody`, `folds.toggleFolder` / `folds.setOverride` /
  `folds.clearOverride`, and `layout.set`; the intent listener realises
  `submitAnnotation` (HTTP POST to `/api/tours/:id/annotations` + dispatch
  `composer.submitted` / `composer.failed`) and `scrollToAnnotation`
  (DOM `scrollIntoView({ block: "center" })`). The `loadTour` flow's
  hand-rolled `setComposerTarget(null)` / `setComposerError(null)` /
  `setCollapsedOverrides({})` / `setCollapsedFolders(new Set())` calls
  are gone — `tour.switched` in the reducer owns those resets. The only
  remaining surface-side reset is `selectedFile` (sidebar position,
  derivable from cursor, explicitly out of scope per PRD #234).
  CONTEXT.md's **Tour-session** entry updated to confirm composer,
  folds, and layout are now authoritative slices.

  Issue: #238 · PRD: #234

- **Tour-session slice 3 foundation: composer + folds + layout slices
  land in the reducer (issue #236).** `TourSessionState` gains three new
  slices: `composer: ComposerSlice` (tagged-union state machine —
  `closed | open | submitting | errored` — with `target: ComposerTarget`
  carrying the parent annotation **id** for replies so the slice doesn't
  go stale when the bundle refreshes mid-composition), `collapsedFolders:
  Set<string>`, and `collapsedOverrides: Record<string, boolean>`. Eight
  composer actions (`composer.open`, `composer.close`, `composer.setBody`,
  `composer.submit`, `composer.submitted`, `composer.failed`,
  `composer.retry`, `composer.dismissError`) drive the state machine;
  four fold actions (`folds.toggleFolder`, `folds.setOverride`,
  `folds.clearOverride`, `folds.clearAll`) own the fold slices; the
  slice-1-leftover `layout.set { layout }` action wires up the existing
  `layout` field. Two new intents on the union: `submitAnnotation
  { tourId, target, body }` (emitted by `composer.submit` / `composer.retry`
  for the surface to realise via its existing `writeAnnotation` plumbing
  — in-process TUI / HTTP webapp — then dispatch `composer.submitted` or
  `composer.failed`), and `scrollToAnnotation { annotationId }` (emitted
  by `composer.submitted` so the freshly-created card scrolls into view;
  replaces the TUI's `pendingScrollAnnotationId` useState). The
  `tour.switched` reset cascade extends to clear composer (→ closed) and
  both fold slices (→ empty Set + empty Record); layout preserved per
  CONTEXT.md's pinned rule. `bundle.refreshed` does **not** touch the
  composer slice — the composer-survives-watcher-reload killer fixture
  passes as a pure-data property of the reducer rather than as a
  React-reconciliation accident. No surface wiring in this slice: both
  Apps continue to own their local useStates for composer / folds /
  layout; the store is exercised only by tests. TUI + webapp migrations
  land separately (siblings #237 + #238).

  Issue: #236 · PRD: #234

- **Webapp `<App>` integration smoke test (issue #235).** A new
  `tests/web/App.integration.test.ts` mounts the top-level `<App>`
  React component once in `happy-dom` against a small two-file bundle
  fixture (paired-change + pure-addition diff, one annotation,
  non-empty `oldContent` / `newContent` so the `tourStats` useMemo
  exercises the `planRows(... { expansion: emptyExpansion(), ... })`
  path) and asserts the rendered DOM contains the tour title, a
  `.tour-file-header` for each file, the `.tour-stats` indicator, and
  at least one `.tour-row`. Closes the silent-merge-regression hole
  exposed by the #232↔#233 merge: pre-existing unit / component /
  helper / CSS tests all passed while the live page rendered blank
  because nothing exercised the App-level integration path. Verified
  by temporarily removing `emptyExpansion` from the App's import block
  — the smoke test fails with `ReferenceError: emptyExpansion is not
  defined` at the exact site the merge regression broke.

  Issue: #235

- **TUI cursor + expansion routed through the Tour-session store
  (issue #231).** The TUI no longer owns `useState<Cursor | null>` or
  `useState<ExpansionState>` — both slices are read from `sessionState`
  and mutated via `store.dispatch(...)`. Keymap dispatchers (`j` / `k`
  / `n` / `p` / `h` / `l` / `Enter` / `Shift-Enter` / arrows / Home /
  End / Space / PageUp/Down / mouse click on diff row / mouse click on
  interactive row / mouse click on annotation card / mouse click on
  sidebar file) compute the new anchor via the existing pure helpers in
  `core/cursor-state.ts` and dispatch `cursor.set` (or `cursor.clear`
  when the target is null). Expansion handlers dispatch
  `expansion.expand` / `expansion.expandTop` / `expansion.expandBottom`
  / `expansion.expandFile` / `expansion.seedFromOrphans` in place of
  their direct `setExpansion(...)` callsites. The watcher-reload and
  composer-submit refresh paths dispatch `expansion.seedFromOrphans`
  before `bundle.refreshed` so the reducer's `revalidateCursor` intent
  fires against the freshly-seeded expansion slice. Tour-switch resets
  for cursor + expansion now come from the reducer's `tour.switched`
  branch; the surface only resets folds / overrides / sidebar row
  index. The intent listener realizes `revalidateCursor` (running
  `validateCursor` against the surface-derived flat-rows + files),
  `scrollCursorTarget` (via `scrollChildIntoView` / `centerChildInView`
  on the diff scrollbox), and `revealSidebarFile` (via `revealAndLocate`
  on the file tree); `mirrorAnnUrl` is ignored — the TUI has no URL.
  Observable behavior is unchanged. The webapp remains untouched and
  continues to use local `useState`s for cursor + expansion until
  issue #232 lands.

  Issue: #231 · PRD: #229

- **Webapp thins cursor + expansion through the Tour-session store
  (issue #232).** The webapp's local `useState<Cursor | null>` and
  `useState<ExpansionState>` are gone; the store is authoritative for
  both slices. Keymap (j/k/h/l/arrows/n/p), click handlers, popstate's
  URL-`?ann=` mirror, and the SSE-driven bundle refresh all dispatch
  `cursor.*` / `expansion.*` actions; the intent listener realizes
  `revalidateCursor` (via `validateCursor` against the freshly-recomputed
  flat-rows from the new bundle), `scrollCursorTarget` (RAF-deferred
  scrollIntoView on the matching row cell or annotation card),
  `revealSidebarFile` (sidebar selection + folder reveal + collapsed
  override), and `mirrorAnnUrl` (`history.replaceState` so back/forward
  steps over Tour switches, not over every keystroke). The cursor's
  Tour-switch reset cascade moves into the reducer's `tour.switched`
  branch; the surface no longer hand-rolls the reset. `core/cursor-
  state.ts`'s `validateCursor` is the single home for snap-policy
  truth — the prior `validateWebappCursor` helper in
  `src/web/client/cursor-validation.ts` is deleted, and its
  collapse-preservation discriminator is reconciled into the core
  helper. Behavioural change: folding the cursor's file now preserves
  the anchor instead of walking it to the next file in stream order;
  uncollapsing restores the cursor in place. CONTEXT.md's Tour-session
  entry drops the obsolete `expansion`-as-shadow-slice example.

  Issue: #232 · PRD: #229

- **Webapp tour title bar: GitHub-style tour-level diff-stats indicator
  (issue #233).** The tour title bar gains a compact `+N -M` text
  indicator sitting between the annotation-navigation widget
  (`SequencePill`) and the Split/Unified layout toggle. The totals
  aggregate additions and deletions across every file in the loaded
  bundle, regardless of UI / classifier collapse state — collapse is a
  per-viewing concern, not a stats concern. New pure helper
  `tourDiffStats(files)` sits alongside `countDiffStats` /
  `proportionSegments` in the `diff-stats` module; it walks each file's
  `PlannedRow[]` via the existing `countDiffStats` and sums the results,
  inheriting the per-row change-shape inspection for free (new-file
  rows `+1`, deleted-file rows `-1`, paired-change rows `+1 -1`).
  Memoized against `parsedFiles` + `modelFilesByName` so cursor moves,
  layout toggles, expansion-state changes, and annotation navigation do
  not re-walk the rows. Sides are independently omitted at zero so
  pure-addition / pure-deletion tours read cleanly (`+12` only, not
  `+12 -0`). Display-only — no click handler. Uses `fg.success` /
  `fg.danger` for the colored counts, monospace + tabular numerals so
  the numbers don't jitter as the reviewer navigates. No proportion bar
  at the tour level — the per-file bars carry the finer-grain
  proportion signal already. Closes the diff-stats arc: per-row glyph
  → per-file header (5-segment bar + count) → per-tour total (count
  only).

  Issue: #233 · PRD: #212

- **Tour-session slice 2 foundation: cursor + expansion slices land in
  the reducer (issue #230).** `TourSessionState` gains `cursor: Cursor |
  null` and `expansion: ExpansionState` slices, alongside four new
  cursor actions (`cursor.set`, `cursor.clear`, `cursor.setSide`,
  `cursor.materialize` for the lazy first-interaction landing) and five
  new expansion actions (`expansion.expand`, `expansion.expandTop`,
  `expansion.expandBottom`, `expansion.expandFile`,
  `expansion.seedFromOrphans`). Four new intents on the union —
  `revalidateCursor`, `scrollCursorTarget`, `revealSidebarFile`,
  `mirrorAnnUrl` — encode the cross-async side-effect contract.
  `bundle.refreshed` now emits `revalidateCursor` when the cursor slice
  is non-null so the surface (which owns the substrate-derived flat-
  rows) drains via the pure `validateCursor` helper from
  `core/cursor-state.ts`. `tour.switched`'s reset cascade now also
  clears cursor + expansion. No surface wiring yet — both Apps continue
  to own their local `cursor` / `expansion` `useState`s; the store is
  exercised only by tests. Cross-async killer fixture covers the
  watcher-reload-snaps-to-first-row case end-to-end as a synchronous
  fixture sequence.

  Issue: #230 · PRD: #229

- **Webapp file header: GitHub-style per-file diff stats (5-segment
  proportion bar + count, issue #228).** The per-file sticky header
  gains a per-file stats indicator in the right region, sitting
  between the (existing) classification reason tag and the (existing)
  copy-path button. The indicator has two parts rendered left-to-
  right: a 5-segment proportion bar (greens for additions, reds for
  deletions, the muted border token for unfilled), then colored
  `+N -M` count text (omitted per side when the count is zero).
  Counts are derived from the planner's `PlannedRow[]` via two pure
  helpers in a new `diff-stats` module — `countDiffStats` (addition /
  deletion / paired-change tallying, non-diff-row kinds excluded) and
  `proportionSegments` (rounding-corner-safe 5-segment mapping, floor
  of 1 on a minority side that's non-zero, ceiling of 5 when the
  other side is zero). Both wrapped in `useMemo` against `rows`.
  Non-interactive — no click handler on the indicator, the only DOM-
  level handler is on the surrounding header which routes to
  `onToggleCollapse` exactly as before. Collapsed files still render
  the stats (counts come from `rows`, not the rendered DOM). Bar
  segments are 8px squares with a 2px gap; count text uses a
  monospace stack with `font-variant-numeric: tabular-nums` so widths
  don't jitter across files. Reuses pre-existing `fg.success`,
  `fg.danger`, and `border.muted` tokens — no `theme.ts` change.

  Issue: #228 · PRD: #212 · ADR: 0024

- **Webapp split layout: neutral fill on the empty side of single-side
  diff rows (issue #227).** In split layout, pure-addition and
  pure-deletion rows now paint a subtle `theme.canvas.inset` fill on the
  three cells (gutter + symbol + code cell) of the side with no line
  number, so each row reads as "one side intentionally blank" rather
  than "content on one side, void on the other". CSS-only: keys on the
  pre-existing `data-line-number=""` attribute that `<Column>` emits
  when `lineNumber` is null, and uses adjacent-sibling selectors to
  extend the cue onto the matching symbol and cell. Scoped to
  `.tour-file-block[data-layout="split"]` so unified-layout rows are
  unaffected. The rule sits between the two-tone line-type backgrounds
  and the per-cell `.in-range` tint, with a `:not(.in-range)` qualifier
  so range-tinted cells keep their accent fill on the rare empty-side-
  in-range case. No prop-surface change to `<DiffRow>` / `<Column>`,
  `<FileBlock>`, the planner, or the annotation model. Three subtle
  depth layers now: empty side recedes (`canvas.inset`), context side
  sits at canvas level, tinted active cells sit "above" the page surface.

  Issue: #227 · PRD: #212 · ADR: 0024

- **Webapp file header: GitHub-style chrome — status icon, collapse
  chevron, copy-path button (issue #225).** The per-file sticky header
  now renders as a flex row with a left disclosure / identity region and
  a right actions / metadata region, matching the GitHub PR
  file-header pattern. The left region carries a collapse chevron
  (`ChevronDownIcon` when expanded, `ChevronRightIcon` when collapsed)
  immediately followed by the diff-status icon (reuses the existing
  `fileIcon(file.type)` helper from the sidebar — `FileAddedIcon` for
  added in `fg.success`, `FileRemovedIcon` for deleted in `fg.danger`,
  `FileMovedIcon` for renames in `fg.muted`, `FileDiffIcon` for
  modified in `fg.muted`), then the existing rename indicator and
  file path. The right region carries the existing classification
  reason tag and a new icon-only copy-path button (`CopyIcon` from
  `@primer/octicons-react`, re-exported via `./icons.ts`). Clicking
  the copy button writes `file.name` to the clipboard via
  `navigator.clipboard.writeText(...)` and stops propagation so it
  doesn't toggle collapse. The button carries `aria-label="Copy file
  path"`, is keyboard-activatable, and shows a subtle hover tint
  (`bg.neutralSubtle`). The header retains its sticky position and
  `canvas.subtle` background. Clipboard failures are swallowed
  silently — the button is best-effort.

  Issue: #225 · PRD: #212 · ADR: 0024

- **Webapp interactive rows: banner treatment for gap / boundary /
  collapsed-file expansion affordances (issue #224).** The
  `<InteractiveRow>` primitive (gap-mid-top, boundary-top,
  boundary-bottom, collapsed-file) now renders as a quiet full-width
  section-divider banner instead of a small button-y blob anchored in
  the leftmost subgrid column. Background uses
  `theme.bg.neutralSubtle.web` — deliberately distinct from the hunk
  header's `bg.accentSubtle` accent tint so the two banner families
  differentiate at a glance (hunk header = navigation marker;
  interactive row = expansion control). The glyph centers
  horizontally in `theme.fg.muted` with 6px vertical padding.
  Click + key semantics are unchanged — plain click expands
  `EXPANSION_STEP`, shift-click expands `Math.max(gapAbove,
  EXPANSION_STEP)`, Enter while cursored dispatches the same.
  Cursor-outline scope stays row-wide (interactive rows have no
  per-side meaning). Implementation mirrors the
  `<HunkHeaderBanner>` pattern: drop the subgrid inline style so the
  row spans 1 / -1 as a block, and let a `.tour-row-interactive` CSS
  rule override `.tour-row`'s `display: grid` + subgrid template.

  Issue: #224 · PRD: #212 · ADR: 0024

- **Webapp hunk headers: GitHub-style banner with parsed range +
  context segments (issue #223).** Hunk-header rows now render as a
  full-width section-divider banner instead of the prior single-glyph
  interactive row. The header string is parsed via the canonical
  `^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)\s*(.*)$` regex into a range
  segment (`@@ -a,b +c,d @@`, muted `fg.muted` color) and a context
  segment (everything after the second `@@`, `fg.default` color); a
  malformed header falls through to a single muted span of the raw
  string. The banner spans the full file-grid width (`grid-column:
  1 / -1`) with a subtle `bg.accentSubtle` tint, 6px vertical padding
  for section weight, and `cursor: pointer`. Expansion semantics are
  unchanged — plain click expands `EXPANSION_STEP`, shift-click
  expands `Math.max(gapAbove, EXPANSION_STEP)`, Enter while cursored
  dispatches the same. A new `<HunkHeaderBanner>` primitive sits
  alongside `<DiffRow>` / `<CardRow>` / `<InteractiveRow>` in
  `row-components`; `<FileBlock>`'s `renderHunkHeader` switches from
  `<InteractiveRow>` to the new primitive while preserving the
  `data-subkind` / `data-boundary-ref` attributes the App-level
  `scrollCursorIntoView` queries. The cursor-outline + range-tint
  decorations remain row-keyed (`.tour-row.is-cursor` selector list
  unchanged).

  Issue: #223 · PRD: #212 · ADR: 0024

- **Webapp diff rows: two-tone tinting + `+`/`-` symbol column (GitHub
  parity, issue #221).** Diff rows now match GitHub's visual signature:
  the line-number gutter + a new symbol cell carry a lighter green/red
  tint (`bg.successRange.web` / `bg.dangerRange.web`); the code cell
  carries a darker green/red tint sourced from two new theme tokens
  (`bg.successCell.web` / `bg.dangerCell.web`). A narrow `+`/`-`/blank
  symbol cell now sits between each line-number gutter and its code
  cell — `+` on addition / change-addition rows, `-` on deletion /
  change-deletion rows (and on the deletion side of paired change rows
  in split layout), blank on context rows to keep columns aligned. Line
  numbers are right-aligned, muted (`fg.muted`), and padded so they
  don't butt the gutter edges. File-grid templates flip from 4 / 2
  tracks to 6 / 3: split `auto auto 1fr auto auto 1fr`, unified
  `auto auto 1fr`. Card / composer side-anchoring updates accordingly:
  in split layout deletion cards span cols 1-3, addition cards span
  cols 4-end. No planner / row-primitive-prop / annotation-model
  changes — purely renderer-side. The cursor outline, range tint, and
  interactive rows continue to span the full track count via
  `grid-column: 1 / -1`.

  Issue: #221 · PRD: #212 · ADR: 0024

- **Parity test harness: render canonical Tours through both renderers
  + compare (PRD #212 slice 6).** New `tests/web/parity-render.test.ts`
  is the merge gate for the Pierre → Tour-owned web row renderer
  cutover (next slice). For every canonical fixture under
  `tests/web/parity-fixtures/` (single-small-file, many-files,
  hidden-context, orphan-window-annotations, file-renames,
  binary-files, classifier-collapsed, stacked-annotations,
  deep-link-ann, layout-split-and-unified, expansion-applied), the
  harness parses the patch via `parsePatchFiles`, computes the
  planner's `PlannedRow[]`, mounts the new `<FileBlock>` (#218) per
  file in happy-dom, renders Pierre's SSR HTML per file via
  `@pierre/diffs/ssr`'s `preloadFileDiff` / `preloadMultiFileDiff`,
  extracts normalized row sequences from both DOMs, and asserts (a)
  the new-renderer DOM equals the planner expected sequence row-for-
  row (full parity including annotations + interactive rows), and (b)
  the new-renderer's Pierre-visible projection equals Pierre's SSR
  diff-row backbone (skipped for fixtures whose Pierre-side semantics
  diverge by design — classifier-collapsed files, fixtures with
  expansion state, and fixtures supplying full file contents where
  Pierre's `MultiFileDiff` re-computes hunk boundaries). Normalization
  strips React-generated keys, shadow-DOM vs light-DOM container
  differences, class strings, and syntax-highlighting span colors;
  preserves row kind, line numbers per side, plain-text row content,
  hunk-header text, and annotation anchor row. After the cutover
  deletes Pierre, the harness deletes itself.

  Issue: #219 · PRD: #212 · ADR: 0024

- **`<FileBlock>`: per-file React component owning the grid, lazy
  highlight, planner walk, and row dispatch (PRD #212 slice 5).** New
  `src/web/client/FileBlock.tsx` exports a `React.memo`'d `<FileBlock>`
  that renders one file's diff via the Tour-owned path. Owns the
  sticky file header (rename pill + classification reason), the
  file-level grid container (`<div class="tour-file-block"
  data-layout>`), and the per-file planner walk that dispatches each
  `PlannedRow` to `<DiffRow>` / `<CardRow>` / `<InteractiveRow>` from
  #217. Calls `useLazyHighlight` (#215) twice — additions side on
  `file.newContent`, deletions side on `file.oldContent` — and routes
  the resulting token maps into `<DiffRow>`'s `tokensLeft` /
  `tokensRight` props. Hunk-header rows promote to `<InteractiveRow>`
  (`boundary-top` for hunkIndex 0, `hunk-separator` otherwise) so the
  `@@` row and the expansion affordance share one component;
  `gap-mid-top` / `boundary-bottom` route directly. `isCursor` flows
  from the `cursor` prop via type-aware matching: `RowAnchor` (file +
  side + lineNumber, or `interactive.subKind` + `boundaryRef` for
  gap-row family) for rows, `CardAnchor` (annotationId) for cards.
  Expansion clicks dispatch a discriminated `ExpandAction` to the
  parent — `{ kind: "expand", file, boundaryRef, direction, count }`
  for gap expansion, `{ kind: "expand-file", file }` for collapsed
  files. Composer rendering: when `composerAnchor` matches a diff row
  in this file, the parent-supplied `composerSlot` renders inline at
  that row's position via a `.tour-card`-positioned wrapper (same
  grid-column rules as `<CardRow>`). Collapsed state suppresses the
  grid body while keeping the header visible + toggleable. Unused at
  this slice's merge time; slice 6 swaps `<FileDiff>` /
  `<MultiFileDiff>` → the `<FileBlock>` list and deletes the Pierre
  adapter pile.

  Issue: #218 · PRD: #212 · ADR: 0024

- **`row-components`: `<DiffRow>`, `<CardRow>`, `<InteractiveRow>` —
  memo'd prop-driven row primitives for the Tour-owned web row renderer
  (PRD #212 slice 4).** New `src/web/client/row-components.tsx` exports
  three `React.memo`'d components, each a stateless leaf the new web
  renderer mounts via `core/diff-rows.ts`'s `PlannedRow[]`. `<DiffRow>`
  renders a single diff line (split-pair or unified-single), paints
  token HTML via `dangerouslySetInnerHTML` from the per-line maps
  `useLazyHighlight` supplies, falls back to plain text when tokens are
  absent, applies `.is-cursor` / `.in-range` className cues from props,
  and reports the clicked column's `side` to `onClick` for annotation-
  creation seeding. `<CardRow>` wraps the existing `AnnotationCard`
  with inline `grid-column` per Layout × Side (full-width unified,
  1/3 deletions / 3/-1 additions split) and passes through all card
  props (registerRef, reply composer target, send-to-agent, replyLock).
  `<InteractiveRow>` renders the gap-row family (hunk-separator chevron,
  gap-mid-top, boundary-bottom, collapsed-file); its click handler
  honors shift-modifier for full-gap expansion (`Math.max(gapAbove,
  EXPANSION_STEP)`) and the keydown handler activates on Enter while
  `isCursor` is true (mirrors the chevron-click action — same modifier
  rules apply). Cursor decoration is a prop on all three (the legacy
  `data-tour-cursor` attribute-mutation pattern retires at slice 6).
  Unused at this slice's merge time; slice 5's `<FileBlock>` consumes
  these components; slice 6 swaps `App.tsx`'s renderer reference and
  deletes the Pierre adapter pile.

  Issue: #217 · PRD: #212 · ADR: 0024

- **`useLazyHighlight` hook: IntersectionObserver-driven lazy
  tokenization for the web row renderer (PRD #212 slice 2).** New
  `src/web/client/use-lazy-highlight.ts` exposes
  `useLazyHighlight(ref, content, lang) → Map<lineNumber, html> | null`.
  Returns `null` until an `IntersectionObserver` with `rootMargin:
  "200px"` reports the block element near the viewport; once visible,
  awaits `ensureHighlighter()` (if not already resolved) and returns the
  token map from `tokenize(content, lang)`. Memoizes on `(content, lang)`
  — same args across re-renders return the same Map reference so
  downstream `React.memo` rows don't churn. The hook also holds the
  plain-text-fallback reference stable for unsupported languages (the
  underlying `syntax-highlight` module stopped caching that path in
  #214). Observer is disconnected on unmount and resilient to the
  pre→post-init transition: when the highlighter resolves, the hook
  re-tokenizes and swaps in the styled map. No existing rendering paths
  change — Pierre's `<FileDiff>` continues to run unchanged.

  Issue: #215 · PRD: #212 · ADR: 0024

- **`file-grid-css` module for the Tour-owned web row renderer.** New
  `src/web/client/file-grid-css.ts` exports `FILE_GRID_CSS`, the layout
  + visual-cue stylesheet the new web row renderer (PRD #212 slice 3)
  injects at the diff pane root. Owns: per-file `<div>` grid with split
  (4-column: gutter-L, code-L, gutter-R, code-R) and unified (2-column:
  gutter, code) templates flipped by `data-layout`; per-row `<div>`
  subgrid spanning all columns; `+` / `-` / `change-*` line-type
  backgrounds keyed on `data-line-type`; cursor outline keyed on a
  `.is-cursor` className (prop-driven, ADR 0024's "cursor outline is a
  prop" decision — replaces the legacy attribute-mutated selector);
  range tint via `.in-range`; sticky `.tour-file-header`; comment-
  affordance pointer on annotatable rows; side-anchored cards
  (`.tour-card[data-side]`, cols 1-2 deletions / 3-4 additions in
  split, full-width in unified). All colors source from `core/theme.ts`
  tokens — no new tokens, no duplicated hex literals. Unused at this
  slice's merge time; slices 4-6 wire it into `<FileBlock>` and swap
  in `App.tsx`.

  Issue: #216 · PRD: #212 · ADR: 0024

- **Foundation for the Pierre → Tour-owned web row renderer migration.**
  New `src/web/client/syntax-highlight.ts` deep module exposes
  `tokenize(content, lang) → Map<lineNumber, html>` over a singleton
  Shiki highlighter pre-loaded with the common-language set (TypeScript,
  TSX, JavaScript, JSX, JSON, Markdown, Bash, YAML, CSS, HTML, Python,
  Rust, Go) under `github-dark-default`. Memoized per `(content, lang)`;
  returns a stable empty Map for empty content; HTML-escapes the
  plain-text fallback for unsupported langs or pre-init calls.
  `detectLang(filename)` maps file extensions to bundled languages.
  Companion ADR 0024 documents the renderer-replacement migration; no
  existing rendering paths change in this slice — the old Pierre
  renderer continues to run.

  Issue: #212 · ADR: 0024

- **Tour-session reducer: `bundle.loaded` split into `bundle.refreshed`
  + `tour.switched`.** The single `bundle.loaded` action conflated two
  semantically distinct events: same-tour refresh (watcher / SSE
  `annotation-changed`) and tour-switch (`picker.commit` / `popstate` /
  auto-pick resolution). The reducer now exports two actions:
  `bundle.refreshed { bundle }` replaces the bundle slice in place
  (does NOT touch picker / replyLock / currentTourId / layout — the
  user is still on the same tour) and `tour.switched { tourId, bundle }`
  applies the CONTEXT-pinned Tour-switch reset cascade (replaces
  bundle, sets currentTourId, closes picker, resets replyLock to idle,
  preserves layout). A new `replyLock.loaded { replyLock }` action
  replaces the reply-lock slice for the watcher / SSE paths; a new
  `isBundleResolved(state)` selector unwraps the outer `RemoteData.ok`
  layer and returns the TourBundle (or null). Both Apps' local
  `useState`s for the bundle (and the TUI's local `replyLock`
  `useState`) are deleted — rendering reads bundle from
  `isBundleResolved(sessionState)` as the single source of truth. The
  store's bundle slice is now authoritative, unblocking slice 2
  (Cursor + Watcher) which depends on synchronous reducer transitions
  when the watcher fires. (#211 · PRD #207)
- **TUI Picker now routes through the Tour-session store (slice 1
  surface wiring, TUI side).** The TUI's `t` keystroke, `j`/`k` picker
  navigation, `Enter` commit, and `Esc`/`t` close all dispatch into
  the `TourSessionStore` from `core/tour-session.ts`. Picker state
  (`pickerOpen` / `pickerCursor` / `pickerTours` / `pickerCounts`)
  is no longer held in `tui/app.tsx` `useState`; reads come from the
  store via `useTourSession`. The initial Tour-list fetch dispatches
  `tourList.loading` → `tourList.loaded` / `tourList.failed`. An
  intent listener realizes `loadTour` (in-process bundle reload +
  CONTEXT-pinned cursor / folds / overrides / expansion resets;
  picker close + reply-lock idle come from the reducer's
  `bundle.loaded` cascade) and `scrollPickerRow` (OpenTUI
  `scrollChildIntoView` on the picker modal scrollbox); `mirrorUrl`
  is ignored (TUI has no URL). Webapp untouched. (#209 · PRD #207)
- **Webapp Picker is thin through the Tour-session store (slice 1).**
  `src/web/client/App.tsx` no longer holds `useState` for `pickerOpen`
  or `tourList`; a per-mount `TourSessionStore` (PRD #207 / slice 1)
  owns those slots and the App reads them via `useTourSession(store)`.
  Keymap (`t` / `j` / `k` / `Enter` / `Esc`), hamburger button, scrim
  click, and row click / hover all dispatch `picker.open` / `.close` /
  `.move` / `.commit` actions. The intent listener realizes
  `loadTour` (→ `fetch('/api/tours/:id')` → `bundle.loaded` /
  `bundle.failed`), `scrollPickerRow` (→ DOM `scrollIntoView`), and
  `mirrorUrl` (→ `history.pushState`). The mount-time `/api/tours`
  fetch dispatches `tourList.loading` / `.loaded` / `.failed`. The
  `popstate` listener dispatches `bundle.loading` + triggers the
  bundle fetcher rather than mutating local React state. CONTEXT-
  pinned Tour-switch reset rules for the slice-1 slots (picker
  closed, reply-lock reset, layout preserved) are sourced from the
  reducer's `bundle.loaded` branch; slots not yet in the reducer
  (cursor / folds / composer / sidebar selection) still reset in the
  webapp on `currentTourId` change pending later slices. The TUI is
  untouched. `picker.move`'s `delta` widened from `1 | -1` to
  `number` so row-click / row-hover can jump to the target idx with
  a single dispatch. (#210 · PRD #207)
- **Tour-session foundation module (slice 1: Picker).** New
  `core/tour-session.ts` lands the live state aggregate a single
  surface drives for one opened Tour as a pure `(state, action) →
  {state, intents}` reducer wrapped in a small `TourSessionStore`
  (`getState` / `subscribe` / `onIntent` / `dispatch`) and a
  `useTourSession(store)` React hook over `useSyncExternalStore`.
  Slice 1 exports the Picker, bundle, tourList, replyLock, layout,
  and `currentTourId` slots plus the `RemoteData<T>` discriminated
  union (`idle | loading | ok | err`) and its `map` / `withDefault`
  / `isOk` helpers, the `Action` / `Intent` discriminated unions,
  and selectors `isPickerOpen` / `pickerHighlighted` /
  `currentTourSummary`. Cursor / folds / composer / expansion
  slices are intentionally absent from this slice and land in
  subsequent slices on top of the same module. No surface wiring:
  `tui/app.tsx` and `web/client/App.tsx` are unchanged; both Apps
  continue to own their state as parallel `useState`. The
  CONTEXT-pinned Tour-switch reset rules (layout preserved;
  picker closed; reply-lock cleared) live in the reducer's
  `bundle.loaded` branch. (#208 · PRD #207)
- **Core seam for explicit reply-agent dispatch.** Two new pure entry
  points land in `core/` ahead of the dispatch-trigger flip (PRD #181):
  `requestReply(opts)` in `core/reply-runner.ts` is the single dispatch
  entry point both surfaces will converge on — it validates the
  annotation (must exist, be human-authored, and not yet have a Reply),
  atomically acquires `.reply-lock.json`, spawns the configured agent,
  captures stdout as the Reply Annotation, and releases the lock,
  returning a discriminated `{ kind: "dispatched" | "busy" |
  "invalid-annotation" | "no-reply-agent" }`. `canSendToAgent(...)` in
  `core/can-send-to-agent.ts` is the pure predicate consumed by both
  surfaces to decide visibility/enabled state of the per-card
  affordance. No surface or watcher wiring is changed in this slice —
  the watcher-driven auto-dispatch still works exactly as today. (#182)
- `tour serve` prints a one-line tip when exactly one shipped agent CLI
  (`claude`, `codex`, `gemini`, `opencode`, `pi`) is reachable on PATH
  and `--reply-agent` is not passed, suggesting the flag. Zero or
  multiple matches stay silent. The tip is informational only — the
  reply watcher remains inert unless `--reply-agent` is explicitly
  given (ADR 0010 inert-by-default invariant). (#176)

### Changed

- **`n` / `p` is a pure topLevel-order jump again; cursor row position is
  not consulted (issue #206 reverts #203).** Pre-revert, `n` / `p` from
  a `RowAnchor` ran a position-aware walk over `topLevel` and returned
  the first annotation at or after the cursor's stream position.
  Design review concluded that's a design overreach: `n` / `p` is the
  **jump** gesture (ADR 0023) — its job is to drive the `[N/M]` pill
  counter through `topLevel` (created_at) order, period. The cursor's
  row position is a separate track. Under the canonical model, from a
  `RowAnchor` `n` enters the annotation track at `topLevel[0]`, `p`
  enters at `topLevel[topLevel.length - 1]`, and subsequent presses
  walk the `topLevel` index. Reviewers who want the next annotation in
  reading order from a row press `k` (which honours stream order
  natively) — `n` / `p` and `j` / `k` are deliberately different
  gestures. The `files: ReadonlyArray<string>` parameter introduced by
  #203 is removed from `nextCard` / `prevCard` / `walkCards`; both call
  sites drop the `.map(f => f.name)` rigging. `CardAnchor` semantics
  (still walks `topLevel` by index, issue #197) and null-cursor
  semantics (still falls back to the `topLevel` edge) are unchanged.
  Stale `CardAnchor` (id not in `topLevel`) falls back to the
  `topLevel` edge again — same as a null cursor — reversing the
  null-return introduced by #203. The pill counter logic
  (`currentIdx = topLevel.findIndex(a => a.id === cursorCardId)`
  showing `— / M` from a `RowAnchor`) is unchanged. (#206)

- **`tour serve` reuses a running server when one already exists for the
  same working directory — even on a fallback port.** Before binding,
  the entry point now probes **every** port in the fallback range
  (`GET /__alive`). If any of them hosts a Tour server whose `cwd`
  matches, prints `Tour already running at http://127.0.0.1:<port>`
  and exits 0 — no second server is started. Other-cwd Tours and
  non-Tour processes are silently skipped during the walk (no surprise
  `EADDRINUSE` surfaces to the user); the first free port is bound.
  Explicit `--port N` keeps single-port semantics: reuse if a same-cwd
  Tour is at N, else the existing `port N is in use` error. The
  slice-1.5 fix probed only the preferred port and missed same-cwd
  Tours that had landed on a fallback. Stable URLs across re-runs; no
  process / watcher proliferation, regardless of which port the
  existing server happens to be on. (#178, #195)
- **`tour serve <id>` prints a deep URL.** When a positional tour-id is
  passed, the startup line now includes `/<id>` as a path component
  (e.g. `Tour server running at http://127.0.0.1:8687/<id>`) so the
  user can Cmd-click straight to that tour in a modern terminal.
  `tour serve` without a tour-id is unchanged (bare base URL). The
  port-collision fallback path also includes `/<id>` and reflects the
  actually-bound port. `--open` opens the deep URL too. (#179)
- **SPA reads tour-id from the URL path and annotation-id from the URL
  fragment.** Precedence is path → query → baked global for tour-id,
  fragment → query for annotation-id. Loading `/<tour-id>` always
  displays that tour regardless of what id the server's HTML carries —
  the probe-reuse case (Issue #178) no longer mis-routes the printed
  deep URL. Loading `/<tour-id>#<ann-id>` scrolls to the named
  annotation. Internal navigation (tour-picker, n/p cursor) now writes
  the new path + fragment shape; legacy `?tour=&ann=` URLs remain
  readable as a back-compat fallback. (#179)
- **TUI footer hint labels the `a` action as `comment`** (was
  `annotate`), aligning Tour's vocabulary with the universal
  convention used by every collaborative code-review tool. The webapp
  composer's affordance already read "Comment" / "Leave a comment".
  The `a` keybinding, the `tour annotate` CLI verb, the "Annotation"
  domain noun, the schema, and the Pierre `AnnotationSide` coupling
  are all unchanged. (#183)

### Fixed

- **Webapp diff-row code cells render as code again (issue #239).**
  Pre-Pierre-cutover, Pierre's `<FileDiff>` wrapped each diff line in a
  `<pre>` so the code cell inherited `font-family: monospace` +
  `white-space: pre`. The Pierre cutover (#220) replaced that wrapper
  with a Tour-owned `<span class="tour-row-code">` but didn't carry the
  CSS over — `.tour-row-code` had no rule in `file-grid-css.ts`, so the
  cell inherited the body's sans-serif stack and `white-space: normal`.
  Visible result: leading indentation collapsed, long lines wrapped
  mid-statement under one line number, characters had proportional
  widths. The Shiki token spans were correct; the wrapping container
  just wasn't told to treat its text as code. New `.tour-row-code` rule
  in `file-grid-css.ts` declares `font-family: ui-monospace,
  SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
  `white-space: pre` (Path A — long lines extend horizontally rather
  than wrap), `tab-size: 2`, and `font-size: 12px`. A companion
  `.tour-row-cell` rule adds `overflow-x: auto` + `min-width: 0` so the
  1fr code track can shrink below content size and the long-line
  overflow surfaces as a horizontal scrollbar at the cell instead of
  pushing the file-block past 100% width. Sits orthogonal to the
  existing line-type backgrounds, range tint, cursor outline, and
  empty-side neutral fill — all of which paint backgrounds or outlines,
  not text properties — so no other rule needed to change. Shiki's
  per-token inline `color: #…` styles continue to apply unchanged.

  Issue: #239

- **Webapp annotation range tint + 3px stripe scope to the annotated
  side in split layout (issue #226).** Before this fix, `<DiffRow>`
  received a single `isInRange: boolean` derived from
  `!!(row.leftTinted || row.rightTinted)`, dropped the side
  dimension, and painted the row-wide tint plus a stripe at the row's
  leftmost edge — visually misleading when the annotation lived on
  the additions (right) side. `<DiffRow>` now accepts `leftInRange?:
  boolean` + `rightInRange?: boolean`. Each side's `.tour-row-gutter`,
  `.tour-row-symbol`, and `.tour-row-cell` receive `.in-range` when
  that side is tinted; the leftmost tinted gutter additionally
  carries `.in-range-stripe` (the 3px accent stripe). Both-sides
  fallback preserves the row-leftmost stripe (deletions gutter wins).
  Unified layout collapses to a single tinted column with the stripe
  on the only gutter. Defensive fallback re-routes a side flag that
  points at a column without content to the side that carries a real
  `lineNumber`. The CSS module replaces the `.tour-row.in-range` rule
  with per-cell selectors (`.tour-row-gutter.in-range`,
  `.tour-row-symbol.in-range`, `.tour-row-cell.in-range`,
  `.tour-row-gutter.in-range-stripe`). (#226)

- **Webapp cursor outline no longer spans both columns in split layout
  (issue #222).** After the Pierre cutover (PRD #212 slice 7), the
  cursor outline was painted as `.is-cursor` on the diff row, which
  spans the full file-grid width. In split layout this drew the
  outline around both halves regardless of which side the cursor
  logically belonged to. `<DiffRow>` now accepts a `cursorSide?:
  Side` prop alongside `isCursor`, and emits `.is-cursor` on the
  cursored `.tour-row-cell` (not the row). `<FileBlock>` derives
  `cursorSide` from whichever side's `lineNumber` matched the
  cursor's anchor. `<InteractiveRow>` is unchanged — its outline
  stays full-width. The CSS rule keys on either `.tour-row.is-cursor`
  or `.tour-row-cell.is-cursor`. Falls back to the side carrying
  content when `cursorSide` disagrees (the addition-only /
  deletion-only edge case). (#222)

- **`syntax-highlight` no longer caches its pre-init fallback at the
  same key, so the first post-`ensureHighlighter()` call returns styled
  output (issue #214).** `tokenize()` cached every result, including the
  plain-text fallback returned when the Shiki highlighter had not yet
  initialised. Once a key was cached pre-init, no later post-init call
  at the same `(lang, content)` key returned the styled output —
  `useLazyHighlight`-driven calls that fired before
  `ensureHighlighter()` resolved would paint a file as plain text for
  the rest of the session. The fix is small: only cache the styled
  path. The fallback paint is cheap (split + escape) so recomputing on
  pre-init calls is sub-millisecond per file per render. A new
  `tokenize — init transition` regression test exercises the pre→post-
  init sequence without `resetForTests()` between calls. (#214)

- **`tour create` stdout is now the tour-id alone; the "Open with: tour
  tui &lt;id&gt;" hint moves to stderr (issue #205).** Previously the non-JSON
  path wrote both lines to stdout, so `TOUR_ID=$(tour create --head HEAD)`
  captured a two-line value and downstream `tour annotate "$TOUR_ID"` failed
  with a no-matching-prefix error because the prefix lookup saw the hint
  appended. The hint now goes to `console.error`, so it still reaches an
  interactive TTY (stderr defaults to the same terminal) but is excluded
  from `$()` substitution. `2>/dev/null` suppresses it cleanly without
  affecting the captured id. `--json` mode is unchanged: stdout carries
  the structured Tour object, stderr is empty. (#205)

- **`tour serve` dev mode discriminator no longer trips when
  `embedded-client.ts` is in a populated state (issue #204).** The
  dev-vs-binary discriminator inside `tour serve` was a truthy-check on
  the *content* of `EMBEDDED_CLIENT_JS` / `EMBEDDED_PIERRE_WORKER_JS` in
  `src/web/embedded-client.ts`. If the binary build pipeline was
  interrupted (Ctrl-C, crash, partial `git stash pop`, a stale checkout
  pulling the populated form) the file was left with real bundle strings
  but no flag distinguishing it from a real binary build, so any
  subsequent `tour serve` against that working tree silently fell into
  the compiled-binary fast-path and served the stale embedded bundle —
  the dev-mode auto-reload from #202 appeared broken with no log line or
  banner explaining why. The discriminator is now an explicit
  `EMBEDDED_BUILD_MODE: "dev" | "binary"` marker that the binary build
  pipeline flips atomically with populating the bundle strings;
  `scripts/build-binary.ts` restores both fields together (and now also
  on SIGINT/SIGTERM/uncaughtException, not just child exit). In dev mode
  the marker stays `"dev"` regardless of what's in the strings, so the
  cache falls through to the runtime Bun.build path. (#204)

- **`tour serve` no longer caches a stale client bundle across source
  edits (issue #202).** Dev-mode `tour serve` (running from
  `bun src/main.ts serve` or `npm run cli serve`) snapshotted the
  webapp client bundle on the very first `/client.js` request and held
  that snapshot for the lifetime of the process. Editing source and
  re-running `bun scripts/build-client.ts` kept serving the old bytes
  until the user killed and restarted serve — every hard browser
  reload returned the stale bundle silently, masking source-level
  fixes during live verification. The two-mode cache now sticks only
  on the immutable compiled-binary fast-path (`EMBEDDED_CLIENT_JS` /
  `EMBEDDED_PIERRE_WORKER_JS` are baked at compile time); in dev mode
  the bundle is rebuilt on every request, with concurrent calls
  coalesced into one in-flight `Bun.build` so a single page load
  fetching `/client.js` + `/pierre-worker.js` triggers one build, not
  two. Errors are also no longer sticky-cached — fixing a broken
  source file no longer requires a serve restart.

- **`tour create` defaults `--base` to the merge-base with HEAD's
  upstream on multi-commit branches (issue #201).** Previously the
  default was always `<head>^` (`HEAD` for `WIP`), which is correct for
  a single-commit branch but too narrow for a multi-commit one — only
  the last commit shows up in the Tour. Users worked around it by
  passing `--base origin/main`, which has the inverse failure mode:
  every commit that landed on main since the branch diverged appears
  as inverted deletions, burying the user's actual changes. The new
  default probes `<head>@{upstream}` (HEAD@{upstream} for `WIP`) and
  uses the merge-base only when it's strictly between `<head>` and
  `<head>^` (i.e. the branch is ≥2 commits ahead of upstream) —
  matching the scope GitHub uses for PR diffs. Detached HEAD, no
  configured upstream, single-commit branches, and any other
  resolution failure fall back to `<head>^` (or `HEAD` for `WIP`),
  unchanged from before. Explicit `--base <ref>` is honored verbatim
  in every case. `base_source` now records the resolved label
  (`merge-base(<tip>@{upstream})`, `HEAD^`, `HEAD`, or the user's
  literal flag) so `tour show` makes the choice visible.

- **`j`/`k` now steps onto Annotation cards instead of skipping them
  (PRD #192 / ADR 0023, supersedes ADR 0022's two-lane rule).** Pressing
  `j` from the diff row immediately above an Annotation card landed the
  cursor on the row AFTER the card, not the card itself — a `while
  (flatRows[next].kind === "card") next += step` loop in `moveCursor`
  filtered cards out of the row lane. The two-lane partition (`j`/`k`
  walks rows only, `n`/`p` walks cards only) was deliberate under ADR
  0022 but didn't match how reviewers actually walk a Tour: the eye
  reads in row order and expects the cursor to stop on every visible
  stop, including cards. Replaced with the **step / jump** model: `j`/`k`
  is one row per press, no destination filter (cards, diff rows, and
  interactive rows all count as one step); `n`/`p` stays one top-level
  Annotation per press regardless of distance. `CardAnchor` now also
  carries `preferredSide` so an `h`/`l` choice survives step-across-card
  and jump-between-cards — a `j` past an additions-side card from a
  `preferredSide: "deletions"` row keeps the deletions preference for
  the next paired row landing. Active under both surfaces via the
  shared `core/cursor-state.ts` helpers; the webapp's URL-mirror and
  re-anchor policies are unchanged (a CardAnchor still mirrors as
  `#<ann-id>` regardless of how the cursor arrived). (#200, PRD #192
  / ADR 0023)

- **Planner: `planRows` now scopes annotations to the file being planned
  (PRD #192 / ADR 0022).** Pressing `j` or `k` from a CardAnchor on the
  webapp jumped to a row in a different file: the row-anchored cursor
  landed in the alphabetically-earliest file whose line range overlapped
  the card's annotation `line_end`, rather than the annotation's own
  file. Root cause: the webapp called `planRows(file, allAnnotations,
  …)` per file (no upstream filter), and `interleaveAnnotations` +
  `applyAnnotationFlags` matched anchors by `(side, line_end)` without
  checking `ann.file`. Every file therefore got phantom card rows + tint
  flags for every foreign annotation whose `line_end` fell inside its
  line range. `flatRows()` emitted those phantoms into the cross-file
  flat-row stream, `resolveCursorRowIdx(CardAnchor, flatRows)` resolved
  to the first phantom, and `moveCursor` stepped into the wrong file's
  row. The fix scopes once at the top of `planRows` —
  `annotations.filter(a => a.file === file.name)` — so every downstream
  helper inherits a file-scoped list. The visible card rendering was
  unaffected because `<FileBlock>` filters Pierre's `lineAnnotations`
  upstream; only the planner-driven cursor-navigation model was poisoned.
  `nextCard`/`prevCard` were already correct after #197 (they walk the
  canonical top-level Annotation list). The TUI also routes through this
  planner — happened not to expose the bug because the TUI's call site
  pre-filtered annotations, but the fix is equally correct on both
  surfaces and removes a footgun for any future caller. (#199, PRD #192
  / ADR 0022)

- **Webapp: URL hash clears when the cursor moves from a card to a row
  (PRD #192 / ADR 0022).** Symmetric follow-up to #197's re-anchor fix.
  The URL-mirror effect's defer gate read `cursorCardId === null`, which
  under the unified-cursor model collapses two distinct cases: "cursor
  is null" (tour-load, the restorer is about to anchor — must defer to
  avoid strip-then-restore in one cycle, per Issue #180) and "cursor is
  a RowAnchor" (the user pressed `j`/`k` or clicked a diff row — must
  write a bare `/<tour-id>` so the stale `#<ann-id>` doesn't survive
  reload). The previous gate suppressed both, leaving the hash stuck on
  the card the user just left. The discriminator now keys off the full
  cursor via a new pure `decideMirrorUrl(cursor, topLevel, tourId)`
  policy in `web/client/mirror-policy.ts`: `cursor === null` with
  annotations → skip; CardAnchor → write `/<tour-id>#<ann-id>`;
  RowAnchor → write `/<tour-id>` (drop the hash). Mirrors `decideReanchor`
  from #197 — both effects key off the same shape now. (#198, PRD #192
  / ADR 0022)

- **Webapp: `n`/`p` walks top-level order; `j`/`k` no longer flickers
  back to a card (PRD #192 / ADR 0022).** Two regressions in the webapp's
  unified-cursor adoption:

  Bug A — `nextCard`/`prevCard` iterated the flat-row display stream
  while the `[N/M]` pill counter read top-level (JSONL `created_at`)
  order. When the two orderings diverged (any Tour whose annotations
  were not authored in file display order — most real-world Tours),
  pressing `n` from pill `1/19` could land on `8/19` rather than `2/19`.
  The walkers now consume the canonical top-level Annotation list
  directly, so `n` from `K/M` always lands on `K+1/M`. The TUI's
  navigation goes through the same walker — `liveTopLevel` replaces
  `flatRowsList` at the TUI call site too. The webapp's row cursor no
  longer needs `flatRowsList` to compute the card target, which also
  drops the `flatRowsListRef` mirror that existed for that one read.

  Bug B — the bundle-load re-anchor effect's null-check (`cursorCardId
  === null`) treated "user moved to a row" the same as "tour just
  loaded, no cursor yet". Pressing `j`/`k` from a CardAnchor cursor
  set the cursor to a RowAnchor, but the effect re-fired within the
  same render, read the still-stale URL fragment, and snapped the
  cursor back to the original CardAnchor — one frame of row-outline
  flicker, zero motion. The discriminator is now `cursor === null`
  via a new pure `decideReanchor(cursor, annFromUrl, topLevel)`
  policy in `web/client/re-anchor-policy.ts`: only the fully-null
  cursor takes the URL-restore branch; a CardAnchor whose id is
  missing from `topLevel` takes a stale-fallback branch; any
  RowAnchor cursor is a noop. The policy is testable independent of
  the App component. (#197, PRD #192 / ADR 0022)

- **TUI: `s` now dispatches the latest human leaf in the focused Thread,
  not the cursor-focused top-level Annotation.** Previously, once a
  Thread had any Reply, the per-Annotation `canSendToAgent` predicate
  rejected the top-level with `already-replied` — the footer hint
  disappeared and pressing `s` was a silent no-op, so `s` stopped
  working as soon as the conversation had started. The keystroke now
  targets the latest human leaf in the Thread via the existing
  `latestHumanLeafId` helper (the same one the webapp uses post-#190
  / #191). The footer `s: send to {agent}` hint appears whenever
  `--reply-agent` is set AND the focused Thread has a non-null latest
  human leaf; pressing `s` dispatches `requestReply` against that
  leaf's id. When the latest turn is agent-authored, the hint hides
  and `s` is a silent no-op (the user is expected to write a human
  Reply first). Lock-held + no-cursor footer-status flashes are
  preserved unchanged. `n`/`p` annotation navigation still walks
  top-levels only — this fix makes `s` Thread-aware so the navigation
  gap doesn't dead-end dispatch. (#196, PRD #181)

- **Webapp: unified Cursor + auto-recall (Slice 2 of PRD #192 / ADR 0022).**
  The webapp now uses the same tagged-union `Cursor` the TUI adopted in
  #193 — `currentAnnotationId` state is fully gone. Click on a diff row
  writes a `RowAnchor`; click anywhere on an Annotation card writes a
  `CardAnchor` for that card; `n`/`p` walks the card lane via
  `nextCard` / `prevCard` from `core/cursor-state.ts`; `j`/`k` walks the
  row lane and skips cards. New keyboard shortcuts: `r` on a card opens
  the Reply composer (targeting the thread's latest annotation per #191);
  `s` on a card dispatches to the configured reply-agent (with the
  unchanged `canSendToAgent` verdict gate). `r`/`s` are no-ops on a row
  / null cursor; `a` is row-only (no-op on a card). When `r` or `s`
  fires while the cursor's card is off-screen, the page smooth-scrolls
  the card into view BEFORE the composer mounts / agent dispatches —
  auto-recall, the webapp's at-action affordance equivalent of the
  TUI's footer-preview. Sequencing uses `scrollend` with a 250 ms
  timeout fallback for Safari < 18 (extracted to `auto-recall.ts` so
  it's testable without mounting <App />). The URL `?ann=<id>` /
  `#<ann-id>` mirror now keys off `cursor.kind === "card"`: present
  when the cursor is on a card, absent on a row or null; stale ids
  (Reply / deleted / hand-edited) fall back to the first top-level
  Annotation and `replaceState` rewrites the URL. `popstate` syncs the
  cursor back to the URL fragment. The top-header SequencePill renders
  `—/M` when the cursor isn't on a card. In-card Reply / Send mouse
  buttons additionally land the cursor on the clicked card so a
  follow-up keyboard `r` / `s` targets it. (#194, PRD #192)

- **TUI: unified Cursor walks diff rows + Annotation cards under a single
  anchor (Slice 1 of PRD #192 / ADR 0022).** Previously the TUI tracked
  two separate cursors — a `❯` line cursor for diff/interactive rows and
  `currentAnnotationId` for the heavy-bordered card — and pressing `r`
  after a wheel-scroll could reply to a card the user wasn't looking
  at. The two pieces of state are now collapsed into one tagged-union
  `Cursor = RowAnchor | CardAnchor` that walks rows and cards alike:
  `j`/`k` step rows (skipping cards), `n`/`p` step cards (skipping
  rows). Action keys dispatch by the cursor's row kind — `r`/`s` are
  card-only, `a` is row-only, mismatches surface a footer hint
  ("r: no annotation under cursor — n/p to navigate"). A new
  footer-preview line always renders the cursor's `r` target ("r: reply
  to "<title>"") and appends a direction indicator ("(cursor ↑ above
  viewport)") when wheel-scroll has parked the cursor off-screen. When
  `r` or `s` fires on a card whose row is off-screen, the diff pane
  scrolls the card into view before the composer mounts (auto-recall).
  `currentAnnotationId` is fully removed from `tui/app.tsx`; the
  top-header pill renders `—/M` when the cursor isn't on a card.
  `core/cursor-state.ts` exports the union and the new `nextCard` /
  `prevCard` walkers; `core/flat-rows.ts` emits `CardFlatRow` entries
  directly after the diff row each card anchors to. The webapp keeps
  RowAnchor-only behaviour for now (Slice 2 will mirror these changes).
  (#193, PRD #192)

- **Webapp: per-Annotation action rows collapsed into a single bottom
  action row per Thread.** Previously, each human Annotation in a Thread
  rendered its own Reply button and the top-level Annotation rendered
  another action row after the inline-Replies list — producing what
  looked like a duplicate Reply at the bottom of long Threads. The webapp
  `AnnotationCard` now renders exactly one action row at the bottom of
  the Thread (after the inline-Replies list, where the top-level's row
  already sat). The Reply button targets the latest Annotation in the
  Thread by `created_at` (id ascending tiebreak) via the new
  `latestAnnotationId` helper in `core/threads.ts`, so a new Reply
  continues from where the conversation is. The Send button still
  targets the latest human leaf per the unchanged #190 rule. The
  composer continues to render inline under whichever Annotation the
  user targeted; the bottom action row is suppressed while a composer
  is open anywhere in the Thread. `canSendToAgent`, the
  latest-human-leaf rule, `requestReply`, the HTTP endpoint, the
  watcher, the lock, and the on-disk schema are all unchanged. (PRD
  #181, #191)

- **Webapp: "Send to {agent}" renders on the latest human leaf only —
  at most one Send button per Thread.** Previously, the inline-Reply
  action row added in #189 rendered a Send button on every human
  Reply whose `canSendToAgent` verdict said visible, producing visual
  noise in Threads with multiple unanswered human siblings (a real
  Tour stacked two Send buttons under the same agent parent — only
  the chronologically later one was a natural dispatch target). The
  webapp `AnnotationCard` now gates each Send button on a per-Thread
  latest-human-leaf check in addition to the predicate. The
  computation is the pure `latestHumanLeafId(topLevel, descendants)`
  helper in `core/threads.ts`: the latest Annotation in the Thread
  by `created_at` (id ascending tiebreak) is always a leaf in a
  well-formed tree, so the rule collapses to "latest overall, if
  human; otherwise null". When the latest turn is agent-authored,
  no Send button renders anywhere — the user is expected to write a
  human Reply first, which becomes the new latest leaf. Per-Reply
  `Reply` button visibility, `canSendToAgent`'s input/output
  contract, the `requestReply` seam, the HTTP endpoint, the watcher,
  and the lock are all unchanged. (PRD #181 story 11, #190)

- **Webapp: "Send to {agent}" + "Reply" affordances now render on every
  human Reply, not just the top-level Annotation.** Previously, the
  webapp `AnnotationCard` rendered its action row exactly once per
  thread (after the inline Replies list), so a human Reply inside the
  Thread had header + body only — no `Send to {agent}`, no `Reply`. A
  human could author a reply to the agent's Reply via the keyboard
  composer, but the webapp surface offered no way to dispatch that
  human reply to the agent, terminating the Thread at the first human
  turn from the webapp's perspective. The inline-Reply rendering loop
  now produces an action row per human Reply, gated by the same shared
  `canSendToAgent` predicate applied per-Annotation — the one-shot-
  terminal rule applies per-Annotation, not per-Thread, so a Reply
  whose own child has landed hides its Send button. Agent-authored
  Replies render no action row (`agent-card` reason). The Send button
  on a Reply calls `POST /api/tours/:id/request-reply` with that
  Reply's id; the Reply button opens the composer targeted at the
  Reply. (PRD #181 story 11, #189)

- **"Send to {agent}" affordance is hidden once a Reply has landed on the
  parent.** Previously, the predicate returned `{ visible: true, enabled:
  false }` for the `already-replied` case, so the webapp rendered a
  permanently-greyed "Send to {agent}" button on every replied-to
  Annotation and the TUI footer showed the `s` hint with no tooltip on
  press. PRD #181 story 16 and ADR 0021's "one-shot terminal" clause
  both specify the affordance should *disappear* once a Reply lands.
  The predicate now returns `visible: false` on `already-replied`; both
  surfaces' existing visibility gates pick the change up. The
  `already-replied > lock-held` reason precedence is unchanged — both
  are simply now hidden. (#188)

- **Bare `tour serve` prints the auto-picked tour-id in the URL.**
  Previously, `tour serve` with no positional id printed
  `http://127.0.0.1:<port>` — a bare base URL. The SPA then auto-picked
  a tour client-side, but the terminal-printed URL was never refreshed,
  so a user copying the URL out of the terminal shared an ambiguous
  link. The server now pre-picks the same tour the SPA would
  auto-select — the most-recent **open** tour — and bakes that id into
  both `__INITIAL_TOUR_ID__` and the printed URL
  (`http://127.0.0.1:<port>/<id>`). Explicit `tour serve <id>` is
  unchanged. Zero open tours → bare URL, unchanged. The pick rule is
  extracted to a shared `pickAutoTour` helper consumed by both
  surfaces so the server's pre-pick and the SPA's auto-pick agree by
  construction, not by accident. (#187)

- **Address bar updates when the SPA is entered at bare `/`.** The
  URL-writer effect's "URL contradicts state" gate previously read the
  URL with a `null` fallback, so a bare `/` resolved to `null` and the
  writer treated it as a contradiction with the auto-selected tour-id
  in state — skipping the write on every cursor move and freezing the
  address bar at `/`. The gate now uses the state's tour-id as the
  fallback: a bare URL is no contradiction (the writer migrates `/`
  to `/<tour-id>#<ann-id>` on first cursor anchor), while a URL that
  asserts a *different* tour-id (the in-flight tour-switch window)
  still skips. (#180)
