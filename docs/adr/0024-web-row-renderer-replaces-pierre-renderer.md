# Web row renderer replaces Pierre's renderer

> **Companion PRD:** [#212](https://github.com/a9a4k/tour/issues/212). Supersedes the webapp half of [ADR 0001](./0001-pierre-hunk-coupling.md) (Pierre's React renderer + annotation framework on the web surface) and the webapp half of [ADR 0013](./0013-hidden-context-expansion.md) (Pierre owns chevron UI + per-instance expansion state). The TUI halves of both ADRs stand. `@pierre/diffs`'s **parser** (`parsePatchFiles`) remains the only Pierre surface in production, bounded to `core/diff-model.ts`.

The webapp replaces `@pierre/diffs`'s `<FileDiff>` / `<MultiFileDiff>` React renderer with a Tour-owned **row renderer (web)** that walks `core/diff-rows.ts`'s `PlannedRow[]` directly into DOM (per-row `<div>` using CSS subgrid). Pierre stays as the parser. Its React renderer, Web Worker pool, embedded stylesheet, and annotation-slot framework leave the bundle. Both surfaces now consume the same row planner and the same `core/expansion-state.ts` reducer; the cursor walks `core/flat-rows.ts` directly on both. Hidden-context expansion is symmetric — click (web) and `Enter` (TUI + web) dispatch the same action.

ADR 0001 accepted Pierre's renderer because reproducing its annotation framework would burn the v1 budget. Two years and three adapter PRDs later (#151 / #154 / #158), every cross-cutting webapp feature lands as a Pierre adapter: a 474-line gap-row overlay, an 87-line expansion bridge reaching into a `protected` field, a DOM-walking cursor that re-runs on each Pierre re-render, a `MutationObserver`-backed `domTick` counter, R1/R2 race mitigation for initial-anchor scroll, and seven CSS-string blobs working around Pierre's grid / sticky header / column template / cursor / plus-button / gap-row / range-tint. ADR 0001's "renderer swap is bounded to that surface" property is being inverted: every new feature spawns a new bridge.

## Considered options

- **Keep Pierre, add another bridge.** Status quo. Rejected. Each new feature requires one or two more reach-arounds into Pierre internals; the adapter pile has grown linearly with feature count.

- **Vendor Pierre's renderer.** Fork `@pierre/diffs`'s React tree into `src/web/client/`. Rejected. We'd own the same React tree we already can't extend cleanly, plus all of Pierre's Web Worker code, shadow-DOM tree, and embedded stylesheet — net larger surface area than building from `PlannedRow[]`.

- **Run Pierre and the new renderer side by side behind a feature flag.** Cold cutover but with a flag. Rejected. A flag keeps the adapter pile alive for the lifetime of the flag (every Pierre bug + every row-renderer bug, both surfaces, both renderers). The deletion *is* the win; a flag negates the deletion. Parity tests serve the same "safe migration" purpose without holding the old code alive.

- **Build a Tour-owned web row renderer on the same `PlannedRow[]` the TUI uses.** Chosen. Both surfaces now consume the same row planner and the same expansion reducer. Renderer-internal asymmetry collapses to DOM-vs-OpenTUI — the only surface-specific concern that's actually fundamental.

## Consequences

- **The Pierre adapter pile leaves the bundle.** `src/web/client/gap-row-overlay.ts` (474 LOC), `src/web/client/pierre-expansion-bridge.ts` (87 LOC), most of `src/web/client/dom-walk.ts` (shadow-root traversal), `src/web/client/cursor-overlay.ts` (DOM-mutation cursor sync via MutationObserver), `src/web/client/cursor-rows.ts` (DOM-walking flat-row builder), and the Pierre worker bundling in `src/web/server.ts` all delete. Cursor decoration becomes a `React.memo`'d `isCursor` prop on each row; hidden-context expansion dispatches into `core/expansion-state.ts` directly; the cursor walks `core/flat-rows.ts` without DOM intermediation.

- **`@pierre/diffs` moves from `devDependencies` to `dependencies`** in `package.json`. Pierre is still imported at runtime (by `core/diff-model.ts` for `parsePatchFiles`), so its dev-only placement was always a mislabel — `npm install --production` would have broken the parser. The reclassification matches its new runtime-only role.

- **Five new modules in `src/web/client/`:**
  - `syntax-highlight` (deep module) — `tokenize(content, lang) → Map<lineNumber, html>`. Hides Shiki setup, eager grammar bundling for the common-language set (TypeScript, JavaScript, JSON, Markdown, Bash, YAML, CSS, HTML, Python, Rust, Go), `github-dark-default` theme baking, file-extension → language detection, memoization. Pure function in interface; complex internals; rarely changes after the cutover.
  - `use-lazy-highlight` (deep module) — `useLazyHighlight(blockRef, content, lang) → Map<lineNumber, html> | null`. Wraps `IntersectionObserver` (`rootMargin: 200px`) + `tokenize` + cleanup behind a hook. Returns `null` before IO fires, the token map after.
  - `file-grid-css` — CSS module emitting file-level grid + row subgrid + line-type colors + cursor outline rules, referencing `core/theme.ts` tokens. Same shape as the existing `cursor-css.ts` / `annotations.ts` CSS-as-string modules.
  - `<FileBlock>` — per-file React component owning the file-level grid container, calling `useLazyHighlight`, walking the file's `PlannedRow[]`, dispatching to row components.
  - `row-components` — three small focused components: `<DiffRow>`, `<CardRow>`, `<InteractiveRow>`. Each `React.memo`'d, receives `isCursor` as a prop, no internal state. `<InteractiveRow>` covers the gap-row family (`hunk-header` chevron, `gap-mid-top`, `boundary-bottom`); its click handler dispatches expansion actions.

- **Per-row `<div>` with CSS subgrid.** Each row is a real DOM element with `grid-template-columns: subgrid`, inheriting columns from the file-level grid. Annotation cards sit between rows as plain `<div>` siblings with `grid-column: 1 / -1` (full-width unified, side-anchored split). The pattern guarantees column alignment via structure rather than hand-maintained CSS variables, and gives every row a stable element for cursor outline / range tint / click handler / scroll-into-view. Subgrid is supported in Chrome 117+, Safari 16+, Firefox 71+ — all 2+ years old at migration time; `tour serve` runs in the user's local modern browser; no fallback needed.

- **No virtualization.** Every row in the row stream renders as a real React element. The classifier already collapses files that would force virtualization (lockfiles, generated, vendored). Adding virtualization later would require redesigning sticky headers, scroll-anchor preservation, the IO highlight loader, and `?ann=` deep-link centring — deferred until proven necessary.

- **Main-thread Shiki, lazy per file.** A fixed common-language grammar set bundled eagerly; each `FileBlock` tokenizes via `useMemo` triggered when an `IntersectionObserver` (`rootMargin: 200px`) reports the block near the viewport. Tokens memoize per `(content, lang)` per session. No worker pool, no async paint cascade, no binary-build worker glue. Single dark theme: `github-dark-default` paired with `core/theme.ts`'s GitHub Dark palette. Future light theme is a token-table extension at `core/theme.ts` plus Shiki dual-theme CSS-variable mode — a renderer-internal change, not a re-architecture.

- **Cursor decoration is a prop.** `isCursor` flows as a React prop to each row component. `React.memo` keeps cursor moves at two row re-renders per keystroke (loser + winner). Replaces today's `useEffect` mutating `data-tour-cursor` — that pattern was forced by Pierre owning the row, not chosen for any inherent reason.

- **Hidden-context expansion ownership.** `core/expansion-state.ts` is the single source of truth on both surfaces. Pierre's `expandHunk` API and the expansion bridge are deleted; click handlers (web) and `Enter` keymap (TUI + web) dispatch into the same reducer. `EXPANSION_STEP` stays 20; `Shift+Enter` / shift-click stays "expand entire gap".

- **Visual continuity is preserved.** All visual cues (Range tint, accent gutter stripe, three-cue active-card treatment, **Cursor** outline, gap-row chevron glyphs, sticky header) reproduce with identical token values from `core/theme.ts`. `+` / `-` / `change-*` row backgrounds match today's Pierre palette via `theme.bg.successRange.web` / `dangerRange.web`. The reviewer sees the same diff; the maintainer ships features in fewer places.

- **Parity tests gate the merge.** A new harness in `tests/web/parity-render.test.ts` renders canonical Tours through both renderers and compares the visible-row sequence + DOM structure for equivalence (modulo intentional shape differences: shadow root vs light DOM, attribute names). Coverage: a Tour with a single small file; one with many small files; one with hidden context requiring expansion; one with orphan-window Annotations; one with renames; one with binary files; one with classifier-collapsed files; one with stacked Annotations at the same anchor; one with a deep-link `?ann=` URL targeting a middle file. ≤20 fixtures.

- **The migration is a long-lived branch with periodic `main` merges.** Slices land as commits on `sandcastle/issue-212-…`; the branch stays current with `main` via periodic merges; parity tests run on every merge to catch divergence early. Final merge cuts on a release boundary so a user hitting any unforeseen issue can pin to the prior `tourdiff` version. Cold cutover, no feature flag.

- **`core/` gains a second consumer for `diff-rows.ts` / `flat-rows.ts` / `expansion-state.ts` / `theme.ts` but no new behaviour.** The planner is unchanged. The flat-row schema is unchanged. The expansion reducer is unchanged. The theme tokens are unchanged. The work is entirely renderer-side; the TUI is untouched.

- **Reversibility.** Rollback is `git revert` of the merge commit plus `npm install tourdiff@<prior-version>` on the user side. No on-disk format changes; bundle JSON shape (`oldContent`, `newContent`, `orphanWindows`, classifier output, annotation list) is unchanged. CLI surface (`tour create`, `tour serve`, `tour pickup`, annotation file shape) is unchanged. The migration is renderer-internal.

## Risks

- **Shiki cold-start on a huge uncollapsed file.** A single 5000-line file that escapes the classifier blocks paint for ~150 ms during its first IO trigger. Mitigation: lower the classifier's "large file" threshold if this bites a real user. Deferred until observed.

- **Deep-link race regression.** Today the renderer has R1/R2 race mitigation (`pendingAnchorRef` re-firing `scrollIntoView` on Pierre's async paint). With sync paint this is unnecessary — `scrollIntoView` lands on a fully-rendered DOM the first time. The R1/R2 block deletes cleanly, but the parity tests cover deep-link scenarios explicitly to confirm.

- **Subgrid browser support.** Required by the per-row subgrid pattern. All target browsers are well past the support floor; the renderer doesn't ship a fallback.
