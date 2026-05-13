# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-05-12

### Added

- **TUI: hunk-header banner adopts the directional `expand-up` /
  `expand-down` / `expand-all` model (issue #273, PRD #270 Slice 3).**
  Sibling change to #271 on the TUI surface. The TUI's hunk-header
  banner becomes a display-only metadata row — no DiffLine pipeline,
  no cursor-on-banner visual, no click handler — at every `gapAbove`.
  The cursor walks past it via `j` / `k`; the directional rows the
  planner emits adjacent to the banner are the only cursor-walkable
  affordances. A new `hunkHeaderCursorStop?: boolean` option on
  `flatRows()` (default `true`, preserves the web's Slice 1/2
  transition shape) is threaded through `deriveTourSessionView` /
  `useTourSessionView` so the TUI's view call passes
  `hunkHeaderCursorStop: false`. With the option set, the flat-rows
  builder skips the `hunk-header → boundary-top / hunk-separator`
  promotion entirely. The TUI's `dispatchPrimaryAction` switch sheds
  the now-unreachable `hunk-separator` / `boundary-top` /
  `boundary-bottom` cases (and their orphan helpers
  `expandHunkBoundary` / `expandTopBoundary` / `expandBottomBoundary`);
  the `expand-up` / `expand-down` / `expand-all` cases route through
  the existing `expandDirectional` helper. Directional row text
  (`↑ Expand Up` / `↓ Expand Down` / `↕ Expand All N lines`) is
  painted from the planner's `expandRowText`, so cross-surface glyph
  consistency holds.

  Issue: #273

- **Web: GitHub-style directional + Expand-All buttons replace the
  legacy `gap-mid-top` row family (issue #271, PRD #270 Slice 1).**
  The planner's `InteractiveSubKind` vocabulary gains three variants —
  `expand-up`, `expand-down`, `expand-all` — and loses `gap-mid-top`.
  A new pure helper `expandRowsForGap(gapAbove, isFirst, isLast)`
  encodes the per-edge-position + gap-size rules: `gapAbove === 0`
  emits no rows; `gapAbove < 40` emits a single `↕ Expand All ${gapAbove}
  lines` row that dispatches `direction: "both"` with `count =
  gapAbove`; `gapAbove >= 40` mid-file emits a two-row pair
  `[↓ Expand Down, ↑ Expand Up]` (DOM order: Down first at the top of
  the gap, Up second just above the hunk-header) that dispatch
  `direction: "down"` / `direction: "up"` respectively with the
  EXPANSION_STEP count; `gapAbove >= 40` file-top emits a single
  `↑ Expand Up`; `gapAbove >= 40` file-bottom emits a single
  `↓ Expand Down`. All three new subkinds render through the existing
  `<InteractiveRow>` primitive using its `glyph` field; the planner
  paints the row text from `expandRowText`. The reducer's
  `direction: "up" | "down" | "both"` state machine is reused
  unchanged — only the renderer + planner vocabulary changes. The
  `<HunkHeaderBanner>` click handler stays as a fallback during this
  slice (Slice 2 makes it display-only). The file-bottom path
  replaces the standalone `boundary-bottom` emission with the same
  directional family at `boundaryRef: "bottom"`; the `boundary-bottom`
  subkind remains in the vocabulary so the existing reducer / cursor
  paths keep routing. The TUI cursor dispatch grows handler cases for
  the new subkinds so cross-surface cursor walks still produce the
  right action; the TUI visual rendering of the new rows is in Slice
  3.

  Issue: #271

### Fixed

- **TUI: split-layout vertical divider now extends continuously through
  wrapped rows (issue #269, sibling fix to #267).** Pre-fix, the
  1-cell-wide divider column between the deletions and additions halves
  was a stretched `<box>` containing a single `│` (U+2502) text glyph.
  The box correctly stretched to the row's full visual height via
  `alignSelf="stretch"`, but the glyph is a leaf that occupies one
  cell — so on wrapped rows where the populated half spans N visual
  rows, the divider painted the glyph on visual row 1 and left N − 1
  cells of unpainted terminal background (a visible black gap) for
  visual rows 2..N. Issue #267 fixed the analogous bug on the side
  halves via flex-direction trickery, but the divider column couldn't
  take that route (its content is a leaf glyph). The fix replaces the
  glyph with a `backgroundColor={theme.border.muted}` paint on the
  same stretched box — same pattern as `DiffLine`'s annotation accent
  stripe (a 1-cell-wide `alignSelf="stretch"` box with `bg`, no glyph
  child). The bg paints the box's full height regardless of wrap
  depth, with no dependency on a per-visual-row repeated glyph.
  Un-wrapped rows render visually identically to before (1-cell
  vertical bar in `theme.border.muted`). Unified layout is unchanged
  (no divider). Annotation rows in split layout are unchanged (no
  divider between the card + empty sibling). Banner rows (hunk-header,
  interactive) take the full-width branch and continue to break the
  rule. The now-orphan `DIVIDER_GLYPH` constant is removed in the
  same commit per CLAUDE.md's "remove orphans" rule.

  Issue: #269

- **TUI: context-row gutter line numbers now render in `fg.muted` so
  bright numbers anchor scan on tinted rows (issue #268, inverse of
  webapp #248).** Pre-fix, `DiffLine.tsx`'s gutter `<text>` rendered
  with no explicit `fg`, inheriting OpenTUI's default white-ish
  foreground (`rgb(240, 246, 252)` ≈ `theme.fg.default`). Result:
  every gutter line number painted in `fg.default` regardless of row
  kind — context rows pulled attention away from the actual diff
  content because their numbers shone as brightly as the
  addition/deletion numbers on the `*Range.tui` rails. The fix is a
  one-line derivation inside `DiffLine`: `gutterFg = diffBg ?
  theme.fg.default : theme.fg.muted`, applied as `fg` to the existing
  gutter `<text>` element. Tinted rows (`addition` / `deletion`,
  including paired-change halves in split) keep `fg.default` so
  numbers stay readable against the bright tinted rail; context rows
  (no `diffBg`) drop to `fg.muted` (`#9198a1`). The `+`/`-` sign cell
  (post-#257) follows automatically — it shares the gutter `<text>`.
  Cursor glyph (`CURSOR_FG`) is independent, sitting on its own
  `<text>` element. Annotation tint composition, two-tone diff bg
  composition, empty-side neutral fill, hunk-header `mutedText`
  path, and the interactive-row branch are all unchanged.

  Issue: #268

- **TUI: empty half of a split-layout row no longer leaves a black gap
  when the populated half wraps (issue #267, parity with webapp #227).**
  Pre-fix, the TUI's split-layout rows nested each `DiffLine` inside a
  50%-width click wrapper with default (column) flex direction. When
  the populated half's content wrapped to N visual rows, the outer row
  container stretched to match, and the opposite click wrapper
  inherited the N-row height via the parent's default
  `alignItems="stretch"`. The `DiffLine` inside it, however, has
  `minHeight={1}` on its outer `<box>` and no `alignSelf="stretch"` /
  `flexGrow` against the wrapper's main axis — so it stayed 1 visual
  row tall, leaving N − 1 rows of unpainted terminal background (a
  visible black gap below the empty half's line-number cell). The fix
  is one prop on each 50%-width wrapper: `flexDirection="row"`. The
  wrapper hosts a single `DiffLine` child, so swapping the wrapper's
  main axis from column to row leaves child placement structurally
  unchanged but flips the default `alignItems="stretch"` onto the
  cross axis = vertical. The wrapper's N-row height now transmits to
  the `DiffLine`'s outer box, whose internal sub-boxes (accent stripe,
  gutter bg, content-bg wrapper) already escape its own
  `alignItems="flex-start"` via `alignSelf="stretch"` — so every bg
  layer (neutral fill / diff bg / annotation tint / cursor) paints
  across the wrapped row height for free. The line-number text stays
  anchored to visual row 1 (the `flex-start` pin inside `DiffLine` is
  preserved). Unified-layout rows are unaffected (single `DiffLine`
  per row, no sibling height mismatch); annotation rows in split
  layout are unchanged (their empty sibling already inherits the
  card's intrinsic row height through the outer row container).

  Issue: #267

- **TUI: tour-level diff stats `+N -M` in the top header (issue #266,
  parity with webapp #233).** Pre-fix, the TUI's top header carried
  hamburger toggle, tour title, source labels, annotation nav, and the
  Split/Unified toggle — but no tour-level diff stats. The webapp ships
  a `<TourStatsIndicator>` between the annotation nav and the layout
  toggle that sums additions / deletions across every file in the
  bundle. The TUI now renders the same `+N -M` text indicator in its
  top header's right cluster, between the SequencePill and the
  LayoutToggle. `+N` paints in `theme.fg.success`; `-M` in
  `theme.fg.danger`; a single-space gap separates them. Zero totals
  render nothing (a degenerate empty-diff tour would otherwise pay a
  `+0 -0` cost for no signal). Pure-addition / pure-deletion tours
  render only the non-zero side. The pure `countDiffStats` /
  `tourDiffStats` helpers move from `src/web/client/diff-stats.ts` to
  `src/core/diff-stats.ts` so both surfaces consume the same code;
  `proportionSegments` rides along (still webapp-only at the call
  site). Stats are memoized against the bundle / file-metadata refs —
  cursor moves, layout toggles, expansion changes, and annotation
  navigation do NOT re-walk.

  Issue: #266

- **TUI: per-file diff stats `+N -M` next to the sidebar file label
  (issue #265, parity with webapp #228).** Pre-fix, the TUI sidebar
  rendered each file as ` ${indent}${icon} ${name} [${N}] ` with the
  annotation count `[N]` as the only per-file numeric indicator —
  reviewer could not tell at a glance whether a file was a 5-line or
  500-line change. The webapp's #228 added a `+N -M` count + 5-segment
  proportion bar to each file's header; the TUI's natural analogue is
  the sidebar entry. The sidebar now renders `+N` in
  `theme.fg.success` and `-M` in `theme.fg.danger` between the
  filename and the annotation badge (e.g. ` M app.tsx +43 -27 [3] `).
  Segments are omitted when their count is 0: deleted files show only
  `-M`, new files show only `+N`, pure-rename files (no content
  change, both counts 0) render no stats segments. Stats are derived
  via the shared `countDiffStats` helper (relocated from
  `src/web/client/diff-stats.ts` to `src/core/diff-stats.ts` for
  cross-surface reuse) fed the file's `PlannedRow[]` from
  `rowsSlice.plannedRowsByFile`. `fileRowLabel` (returning one string)
  is replaced by `fileRowSegments` (returning structured leading /
  additions / deletions / badge / trailing segments) so the renderer
  can paint each segment in its own `<text>` foreground; the row is a
  flex-row `<box>` with the selected-row background applied to the
  box, preserving the existing selection highlight. `fileRowFixedCost`
  now takes the per-file stats so the name budget shrinks to make
  room for the stats segments — long filenames continue to truncate
  with `…`. No theme change, no planner / cursor / expansion /
  annotation-model change. No proportion bar in the TUI (text-only,
  same call as #233).

  Issue: #265

- **TUI: hunk-header rows now carry a `…` expand-affordance glyph at
  the leftmost edge (issue #264, mirrors webapp #252).** Pre-fix, the
  TUI hunk-header row gave no rest-state visual cue that it was
  interactive — a reviewer couldn't tell from looking at it that
  navigating the cursor onto it and pressing Enter would expand
  hidden context (per ADR 0013). The webapp shipped #252 with a
  saturated 44px `bg.accentEmphasis` block + `…` dots in white at
  the leftmost edge of the banner. The TUI's terminal-native
  equivalent: prepend a `…` (U+2026 HORIZONTAL ELLIPSIS) glyph
  painted in `theme.fg.accent` at column 0 of every hunk-header row
  (both the inert `gapAbove === 0` and the interactive `gapAbove > 0`
  paths). The accent-coloured glyph contrasts with the muted header
  text and reads as a "this row is interactive" cue. Path B from the
  brief: the glyph is rendered as a separate `<text>` element so it
  keeps the accent color while the header text stays muted (Path A's
  bake-into-text would have painted the glyph in muted grey, losing
  the contrast that IS the affordance signal). Cursor + Enter
  expansion behavior is unchanged — the glyph is purely decorative.
  Decorative-misdirection on `gapAbove === 0` headers (where Enter
  is a no-op) is accepted, matching the webapp's same trade-off.
  No planner / cursor / expansion / annotation model change.

  Issue: #264

- **TUI: horizontal `─` rule renders between consecutive files in the
  diff pane (issue #263, mirrors webapp #249).** Pre-fix, the TUI
  stacked every file in a tour's diff stream vertically inside a single
  outer `┌─ Diff ─┐` box with no visible boundary between consecutive
  files. The webapp shipped #249 to wrap each file in a 1px
  `border.muted` rounded card with 16px margin so the eye can anchor on
  file boundaries. The TUI now interleaves a 1-row horizontal rule of
  `─` (U+2500 BOX DRAWINGS LIGHT HORIZONTAL) characters in
  `theme.border.muted` between every consecutive pair of files inside
  the diff pane. The file card above carries `marginBottom={1}` which
  supplies the blank row above the rule; the separator owns the rule
  line and a 1-row blank below. No separator renders before the first
  file or after the last (the outer `┌─ Diff ─┐` box already provides
  those boundaries); single-file tours render with no separator at
  all. LIGHT weight matches the LIGHT `│` from #258 for visual
  consistency. The rule uses `wrapMode="none"` so a long pre-filled
  string is clipped by the 100%-width parent box rather than wrapping
  to a second line. No planner / cursor / expansion / annotation /
  scroll-helper change.

  Issue: #263

- **TUI: two-tone tint within a +/- row — bright gutter rail + soft
  code wash (issue #262, parity with webapp #221 + #247).** Pre-fix,
  `DiffLine` computed one `diffColor` from the row's diff kind and
  painted it across both the gutter and content cells: addition rows
  used `theme.bg.successRange.tui` (`#1c4328`) everywhere; deletion
  rows used `theme.bg.dangerRange.tui` (`#542426`) everywhere. The
  webapp's post-#247 pattern paints the brighter `*Range` rail on
  the gutter + symbol column and the softer `*Cell` wash on the
  code column — the bright rail anchors the vertical scan and the
  softer wash keeps syntax-highlighted tokens readable. The TUI
  inherits the same theme tokens (`bg.successCell.tui` `#142a20`,
  `bg.dangerCell.tui` `#24171c`) but was applying only the range
  value. `diffBgColor` is replaced by `diffBgTones`, which returns
  `{ gutter, content }` per row kind. `DiffLine` routes the gutter
  side to `gutterBg`'s diff-bg fallback and the content side to
  `contentBg`'s. All composition rules stay (cursor row-fill >
  annotation tint > +/- bg > empty-side neutral fill); only the
  diff-bg layer is split. No theme change, no `DiffLine` prop
  surface change from a caller's perspective, no planner / cursor
  / annotation-model change.
- **TUI: clicking an annotation card moves the cursor to that card
  (issue #261).** Pre-fix, the TUI's `DiffRows` annotation branch
  rendered an `AnnotationCard` (or a 50/50 split-layout wrapper
  containing the card on the appropriate side) with no `onMouseDown`
  handler anywhere in the tree — clicking a card was a no-op. The
  webapp moves the cursor to the clicked card via
  `setCursorFromCardClick`. The regression went unnoticed because the
  diff-rows test suite still asserted "annotation card rows do NOT
  receive a click handler on their wrapper" — a stale invariant from
  the pre-ADR 0022 design when annotation cards were not cursor
  stops. ADR 0022 unified the cursor (`CardAnchor` became
  first-class), the keyboard paths (`j`/`k`/`n`/`p`/`Enter`) were
  updated, but the mouse-click path was not. `DiffRows` now accepts
  an `onCardClick?: (annotationId: string) => void` prop — mirroring
  `onCursorClick` (diff rows) and `onInteractiveClick` (interactive
  rows) — and wires `onMouseDown` on the annotation card's wrapper.
  The App-shell supplies a callback that dispatches `cursor.set`
  with `cursorFromAnnotation(ann, preferredSideOf(cursor))` — the
  exact shape `jumpToAnnotation` (the `n`/`p` keyboard path) writes.
  In split layout only the half hosting the card carries the handler;
  the empty sibling stays a no-op. Clicks on a reply nested inside
  the card bubble up to the same wrapper, so the cursor lands on the
  parent top-level annotation (cursor walks top-levels only per ADR
  0022). Click on the already-current card is a no-op via the
  reducer's same-anchor short-circuit. Cursor-follow scroll runs
  through the existing `cursor.set` → `scrollCursorTarget` intent
  → `centerChildInView` path; no parallel scroll plumbing. The stale
  negative test is deleted; a new describe block ("mouse click on
  annotation card → cursor (issue #261)") asserts the positive
  behaviour: unified wrapper fires `onCardClick`, split layout fires
  only on the card half (additions / deletions), the
  `onCardClick`-omitted case wires no handler. No planner / cursor
  reducer / AnnotationCard / scroll-helper change.

  Issue: #261

- **TUI: split-layout single-side rows paint a neutral fill on the
  empty side (issue #260, mirrors webapp #227).** Pre-fix, the empty
  side of a pure-addition or pure-deletion row in split layout rendered
  as plain canvas — indistinguishable from the inter-row gap or the
  page's outer canvas. The half "floated" with no boundary signal that
  "this row exists; its other side is just blank." On consecutive
  single-side rows the diff body lost coherence; the eye read "content
  here, void there" rather than "row here, with one side intentionally
  blank." Webapp shipped #227 painting the three cells of the empty
  side with `theme.canvas.inset` (`#010409`, ~6% darker than
  `canvas.default`). TUI matches via a new `emptySide?: boolean` prop
  on `DiffLine`: when set, both the gutter and content cells paint
  `theme.canvas.inset` so the empty side recedes below canvas while
  the active side sits at canvas. `DiffRows` flags
  `leftEmptySide = row.type === "change" && row.leftLineNumber === null`
  (and the right-side mirror) on the split-layout branch and passes it
  to the per-side `DiffLine`. Composition: cursor row-fill (ADR 0011)
  and annotation range tint (ADR 0008) both win over the empty-side
  fill, but the empty side of a single-side row never carries either —
  the cursor anchors to the populated side and annotation ranges only
  apply where there's content — so the priority resolves consistently.
  Paired-change, context, and banner (hunk-header / interactive) rows
  never trip the flag (no empty side concept). Unified layout
  unchanged (one rendered column, no per-side concept). The diff +/-
  tint (`bg.successRange.tui` / `bg.dangerRange.tui`) on the active
  side is untouched. Three subtle depth layers now: empty side recedes
  (`canvas.inset`), context side sits at canvas level, tinted active
  cells lift "above" the page surface — same visual hierarchy the
  webapp #227 established. No planner / cursor / expansion /
  annotation / theme change; reuses the Tier-1 `theme.canvas.inset`
  token (same hex on both surfaces).

  Issue: #260

- **TUI: split-layout renders a vertical `│` rule between the
  deletions and additions halves (issue #258, mirrors webapp #251).**
  Pre-fix the two halves sat flush against each other with no visible
  separator. On context blocks where both halves carried identical
  content, the split layout read as one continuous wide grid rather
  than two parallel columns; with no cue at the column boundary, the
  eye lost the "this is the boundary between old and new" anchor.
  Webapp shipped a 1px `border.muted` vertical rule down every split
  row in #251. The TUI's terminal-native equivalent is a `│` (U+2502
  BOX DRAWINGS LIGHT VERTICAL) glyph painted in `theme.border.muted`
  (`#2f3742` — same token webapp picked for parity). The divider is
  a 1-cell-wide `<box width={1} alignSelf="stretch" flexShrink={0}>`
  containing a `<text fg={theme.border.muted}>│</text>`, inserted
  between the two 50%-width half columns in the split-layout row
  composition. Default `flexShrink=1` on the halves absorbs the 1-
  cell divider into the 100% row width with no visible alignment
  shift. The lighter LIGHT VERTICAL weight (vs the HEAVY `┃` the
  file-block uses for its outer border) keeps the inner divider from
  competing for attention with the outer box. Banner rows (hunk-
  header, interactive: gap / boundary / collapsed-file) take the
  full-width render branch and skip the split composition entirely,
  so the rule naturally breaks at each banner — matches GitHub's
  behaviour. Annotation card rows in split layout keep their existing
  two-half composition with the card slotted into one side; the
  divider is not threaded through the annotation render path, so the
  card visually breaks the rule where it occupies — acceptable per
  the issue brief because the card is a different content kind and
  the break correctly signals "this is a comment, not code". Cursor
  row-fill composition is unchanged: the cursor's `bg.cursorRow.tui`
  fills both halves' DiffLine cells but does not extend across the
  divider's 1-cell column, so the divider remains visible through
  cursored rows. Unified layout untouched — the change is layout-
  aware (the divider only renders in the `layout === "split"`
  branch). No planner / annotation / cursor / expansion / syntax-
  highlight change; no theme change (reuses `theme.border.muted`).

  Issue: #258

- **TUI: cursor materialises on the first top-level annotation on tour
  load (issue #256).** Pre-fix, opening a TUI tour with at least one
  annotation left the cursor null and the diff pane parked at
  `scrollTop = 0` — the first annotation was off-screen unless it
  happened to sit near the top of the first file, and the user had to
  scroll manually or press `n`/`j` to materialise the cursor and
  trigger a scroll. ADR 0011's "lazy materialization" rule (2026-05-10)
  was justified by surface parity with the webapp and a "land on first
  annotation" eye-catcher, but ADR 0022's URL-anchored mount broke the
  parity rationale (the webapp now materialises the cursor at `?ann=`
  or the first top-level annotation on mount unconditionally), and the
  eye-catcher only delivered when the first annotation sat inside the
  initial viewport. Fix dispatches `cursor.materialize` in the App-
  shell's existing tour-open `useEffect`, seeded by `initialCursor`
  with the live `topLevel` + `flatRowsList`. Same first-paint-per-tour
  guard (`seededTourIdRef` on `bundle.tour.id`) used by the tree-
  reveal side effect — `bundle.refreshed` does not re-seed, so user
  motion before a watcher reload survives. Empty tours and snapshot-
  lost bundles keep the lazy-materialization rule (no target to seed
  on; cursor stays null). ADR 0011 carries a new revision entry
  reverting the on-load rule for the non-empty path.

  Issue: #256

- **TUI: split-layout gutter renders `+` / `-` sign column (issue #257,
  mirrors webapp #221).** Pre-fix `splitGutter(lineNumber)` returned
  `${pad(lineNumber)} ` — line number + trailing space, no sign. Tint
  alone signalled addition / deletion / change rows in split layout,
  which is insufficient for color-blind readers and didn't match the
  TUI's own unified-layout behaviour (`unifiedSign` already emits
  `+` / `-` / blank). Webapp shipped the sign column in both layouts
  in #221; TUI was partial. Fix adds a `splitSign(row, side)` helper
  that mirrors `unifiedSign`'s vocabulary but reads the sign from the
  populated side: in split layout the planner emits both pure adds and
  pure dels as `type: "change"` with one side's line number null,
  so the sign on each side is `-` (left, deletions) or `+` (right,
  additions) when that side carries content, and a blank space when
  the side is empty or the row is `type: "context"`. `splitGutter`
  takes the sign as a second argument and appends `${sign} ` after
  the line-number column, keeping the gutter width uniform across all
  row kinds. `INTERACTIVE_PAD_GUTTER` widens to match (LINE_NUMBER_WIDTH
  + 3) so hunk-separator / collapsed-file rows still align their body
  text with the diff column. Paired-change rows: deletions side `-`,
  additions side `+`. Pure-add: additions side `+`, deletions side
  blank. Pure-del: deletions side `-`, additions side blank. Context:
  both sides blank. Unified layout unchanged.

  Issue: #257

- **TUI hunk-header renders in continuous fg.muted, no syntax highlighting on
  the function-context tail (issue #259).** Pre-fix the interactive
  hunk-header (`@@ -X,Y +Z,W @@ <function-context>` with `gapAbove > 0`)
  routed its text through `DiffLine` with the same `filetype` /
  `syntaxStyle` as the diff-row code cells. The function-context tail ran
  through the syntax highlighter — `import` painted red, identifiers blue,
  brackets white — and the banner read as a colourful element pulling
  attention from the diff rows below. GitHub renders the entire
  `td.blob-code-hunk` cell in one continuous `fg.muted` grey
  (`#9198a1`); the webapp's `.tour-hunk-header` matches. The TUI now does
  too: `DiffLine` grows a `mutedText?: boolean` prop that forces the plain
  `<text>` branch regardless of filetype and tints the content in
  `theme.fg.muted`. `DiffRows` passes `mutedText` for the interactive
  hunk-header. The inert path (`gapAbove === 0`) was already rendered as
  `<text fg={theme.fg.muted}>` and is unchanged. Cursor visual, gutter
  padding, and the `↑` / `↓` / `↕` direction glyph + `··· N hidden ···`
  suffix are unchanged — only the syntax pipeline is bypassed and the
  text is tinted muted.

  Issue: #259

- **TUI: top-level annotation submit no longer silently fails — diverged
  `WriteAnnotationInput` types and unrendered `errored` composer state fixed
  (issue #254).** Pre-fix `WriteAnnotationInput` was declared twice: once in
  `src/tui/app.tsx` (no `bundle` field) and once in `src/cli/tui.ts` (with
  `bundle: TourBundle`). The intent listener in `app.tsx` built a top-level
  input without `bundle`; the CLI's writer callback passed `input.bundle ===
  undefined` into `createAnnotation`'s anchor validator, which dereferenced
  `undefined.kind` and threw `TypeError`. The exception was caught and
  dispatched as `composer.failed`. The App rendered the composer only when
  `composer.kind === "open"` so the user saw the composer vanish on Enter
  with no error message. The type-system blind spot was hidden by an
  `as string` cast on the dynamic-import path in `src/cli/tui.ts` (the TUI
  source is excluded from tsc for opentui JSX intrinsics, so the duplicate
  types couldn't be cross-checked). Fix consolidates `WriteAnnotationInput`
  and the App's prop shape (`StartTuiProps`) into a new shared module
  `src/core/write-annotation-input.ts`. A pure builder
  `buildWriteAnnotationInput` constructs the payload from the live bundle —
  removing the bundle field from the type OR from the builder is now a tsc
  error rather than a runtime crash. The Composer renders all three visible
  slice kinds: `open` (editable input + submit hint), `submitting` (plain
  body + "Submitting…" hint, no input focus), and `errored` (plain body +
  the error message + "Enter: retry · Esc: dismiss" hint, muted border).
  The App's `useKeyboard` routes Enter / Esc to `composer.retry` /
  `composer.dismissError` on the errored state. Reply submit path
  unchanged — it never passed a bundle.

  Issue: #254

- **Hunk-header banner adopts monospace 12px / line-height 20px
  typography (issue #253).** Pre-fix `.tour-hunk-header` set no
  `font-family`, `font-size`, or `line-height`, so the banner and its
  child spans inherited the document body's system sans-serif at 16px
  with the browser-computed `line-height: normal` (≈19.2px). The diff-
  row code cells below (gutter, +/- symbol, code text) render in
  monospace 12px / line-height 20px per issue #241, so banner text was
  visually mismatched — larger, sans-serif, off-rhythm with the rows
  below. GitHub renders hunk-header text in the same monospace stack /
  size / line-height as the code cells. `.tour-hunk-header` acquires
  the three font declarations reusing the existing module-private
  `MONO_STACK` constant; the two child spans
  (`.tour-hunk-header-range`, `.tour-hunk-header-context`) and the
  `::before` cue area's `…` glyph all inherit from the parent. Banner
  height becomes ≈ 32px (20px line-height + 6px top/bottom padding),
  aligned to a 20px multiple matching the row rhythm. No JSX / prop /
  planner / theme change.

  Issue: #253

- **TUI: cursor-follow scroll defers to next macrotask so Yoga relayout
  completes before centering math runs (issue #250).** Pre-fix the cursor-
  follow `useEffect` in `src/tui/app.tsx` (deps: `[cursor, layout]`) called
  `centerChildInView` / `scrollChildIntoView` synchronously after React's
  commit. OpenTUI's Yoga relayout for newly-rendered rows runs on a later
  render tick, so the synchronous call read positions against the previous
  layout. Most visible trigger: cursor on an annotation card + `Shift-L`
  layout flip — `centerChildInView` computed `desired` against the stale
  content frame, parking the scrollbox where, in the new layout, only
  stacked annotation cards live; every diff code row was pushed off-screen
  above and below. The effect now schedules the scroll via `setTimeout(0)`,
  and the cleanup cancels the pending callback so rapid cursor motion only
  scrolls to the latest position. `requestAnimationFrame` does NOT work as
  a substitute in this runtime — in bun/node it shims to `setImmediate` or
  similar and fires before OpenTUI's render tick; the macrotask delay from
  `setTimeout(0)` is what lands the callback after the layout pass.
  Inline comment in the effect explains the race and explicitly warns
  against the rAF "improvement". No change to `centerChildInView` /
  `scrollChildIntoView`, the layout reducer, or the planner.

  Issue: #250

- **Hunk-header banner gains a visible expand affordance (issue #252).**
  Pre-fix the webapp hunk-header banner was clickable (per ADR 0013 the
  whole banner expands hidden context) but had no rest-state visual cue
  — only `cursor: pointer` on mouseover. GitHub paints a 44px saturated-
  blue leftmost cell with a `…` glyph on every hunk-header row as the
  rest-state signal. New `.tour-hunk-header::before` rule in
  `file-grid-css.ts` paints the analogous cue: width 44px, background
  `theme.bg.accentEmphasis` (#1f6feb solid), glyph `theme.fg.onEmphasis`
  (#ffffff), centered via flexbox, absolutely positioned to the banner's
  left edge. `.tour-hunk-header` acquires `position: relative` (anchor
  for the ::before) and `padding-left: 60px` (44 cue + 16 gap) so the
  range/context text clears the cue. Path B (`::before` pseudo-element)
  rather than Path A (inline span) so the cue cannot accidentally become
  a separate click target — per ADR 0013 the whole banner stays one
  click target. No JSX / prop / planner / theme change.

  Issue: #252

- **Split-layout diff rows render a 1px vertical rule between the
  deletions and additions halves (issue #251).** Pre-fix the two halves
  sat flush against each other with no visible separator — on context
  blocks where both halves had identical content, the split layout read
  as one continuous wide grid rather than two parallel columns. GitHub
  paints a thin vertical rule down every row at the column boundary,
  implemented as a `border-left` on the additions-side line-number
  gutter cell. New rule in `file-grid-css.ts` keys on
  `.tour-file-block[data-layout="split"] .tour-row-gutter[data-side="additions"]`
  and declares `border-left: 1px solid ${theme.border.muted}` (#2f3742) —
  visually nearly identical to GitHub's `rgba(61, 68, 77, 0.7)` blended
  over `canvas.default`. Reuses an existing token. Unified-layout rows
  are unaffected (selector qualifies on the layout attribute). Banner
  rows and annotation cards span full width with no additions-side
  gutter, so the rule naturally breaks at each banner — matches GitHub.
  Clipped to the file-card's rounded corners by the existing
  `.tour-file-outer` `overflow: hidden`. No DOM / prop change; no new
  theme tokens.

  Issue: #251

- **Diff body wraps each file in a bordered, rounded card (issue #249).**
  Pre-fix the per-file `.tour-file-outer` div was a style-less
  passthrough — files in the diff body stacked edge-to-edge with no
  border, no rounded corners, no margin, and no overflow clipping;
  scanning a multi-file tour required reading file-header text rather
  than recognizing card boundaries. New `.tour-file-outer` rule in
  `file-grid-css.ts` paints `1px solid theme.border.default` (#3d444d),
  `border-radius: 6px`, `margin-bottom: 16px`, `overflow: hidden`, and
  `background-color: theme.canvas.default` — matches GitHub's empirical
  `.file` container shape. `overflow: hidden` clips children to the
  rounded corners AND bounds the sticky file-header's stick range to
  its own card so only the current file's header sticks at any moment
  (instead of all file headers stacking at the viewport top). No DOM /
  prop change; no new theme tokens.

  Issue: #249

- **Diff-row gutter line numbers + `+` / `-` symbol promote to
  `fg.default` on tinted rows (issue #248).** Companion to #247: with
  the gutter+symbol now wearing the brighter range tint, the previously
  uniform `fg.muted` text color produced low-contrast grey digits on a
  saturated green/red rail. GitHub's pattern is white text on tinted
  rows (`addition` / `deletion` / `change-addition` / `change-deletion`)
  and muted text on plain-canvas context rows; color discrimination is
  carried by the background, not the foreground. New
  `[data-line-type]` × `{ .tour-row-gutter, .tour-row-symbol }` rule
  in `file-grid-css.ts` overrides the base muted color to
  `theme.fg.default` on the four tinted row kinds; context rows fall
  through to the unchanged base rule. No new tokens, no DOM/prop
  change.

  Issue: #248

- **Diff-row two-tone tint flipped to GitHub's empirical direction
  (issue #247).** The line-number gutter + `+`/`-` symbol cells now wear
  the brighter range tint (alpha .30 of fg.success / fg.danger); the
  code cell wears a softer wash (alpha .15 for additions, .10 for
  deletions — red sits one step softer than green at equal alpha to
  preserve visual balance, matching live PR-diff inspection). Pre-fix
  the direction was inverted (soft gutter, bright code) — the
  syntax-highlighted Shiki tokens sat over the more-saturated cell
  background, reducing legibility, and the gutter rail was muted
  enough that the eye lost the vertical-scan anchor in long
  addition / deletion runs. Token names are unchanged
  (`bg.successRange` / `bg.successCell` / `bg.dangerRange` /
  `bg.dangerCell`); only the alpha values flip and the corresponding
  TUI hex equivalents recalibrate (`#1c4328` / `#142a20` / `#542426`
  / `#24171c`). CSS rule wiring and the planner / row primitives are
  unchanged.

  Issue: #247

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

- **Tour-session view: nav lifted to both branches; single early-narrow
  per App (issue #246, PRD #242 follow-up).** `TourSessionView`'s
  `snapshot-lost` branch now carries `nav: NavBase` (topLevel /
  repliesByRoot / navIndexById / navTotal); `currentIdx` and `sendTarget`
  stay ok-only on the NavSlice that extends NavBase. The webapp's
  inline `topLevelAnnotations` / `buildThreads` re-derivation in
  `AnnotationListSnapshotLost` (and the parallel call inside the
  re-anchor `useEffect`) is gone — both reads route through `view.nav`.
  The TUI's `navSlice` destructure flattens to a non-nullable `nav` of
  type NavBase | NavSlice; `EMPTY_NAV_INDEX` is deleted. The webapp's
  render branches on `view.kind === "snapshot-lost"` once (the sidebar
  and main body are inside one ternary); the body-proper `view.kind ===
  "ok"` ternaries for `navTotal` / `pillIdx` are gone (NavBase universal;
  pillIdx uses a property check on `nav.currentIdx`).

  Issue: #246 · PRD: #242

- **Webapp migration to Tour-session view (issue #245, PRD #242).**
  `web/client/App.tsx` now reads `const view = useTourSessionView(store,
  bundle)` at root and consumes namespace slices (`view.bundle.*`,
  `view.nav.*`, `view.rows.*`, `view.tree.*`, `view.cursor.*`) instead
  of the parallel `useMemo` chain it used to maintain. The eight
  derivation `useMemo`s (`topLevel`, `navIndexById`, `repliesByRoot`,
  `tree`, `annotationCounts`, `visibleRows`, `plannedRowsByFile`,
  `flatRowsList`), the inline cursor predicates (`currentIdx`,
  `cursorCardId`, `cursorCardFile`), and the parallel projections
  (`liveFiles`, `modelFilesByName`, `parsedFilesByName`) are gone.
  `CursorKeymapContext` now consumes `view.cursor.onCard`; the
  webapp's `s`-dispatch consumes `view.nav.sendTarget`, sharing the
  latest-human-leaf rule with the TUI through `core/send-target.ts`.
  The webapp adopts the view's `isFileFolded` rule (binary-only auto-
  fold; classifier-collapsed non-binary files emit a synthetic
  CollapsedFileRow via the planner), reconciling the prior
  `defaultCollapsedFor` divergence. Behaviour is observationally
  identical: keymaps fire the same actions, the planner emits rows
  in the same order, snapshot-lost still renders the banner, and the
  watcher-reload `revalidateCursor` intent re-derives the view inline
  to validate the cursor against the fresh bundle before React
  re-renders.

  Issue: #245 · PRD: #242

- **Tour-session view foundation: pure projection from `(bundle, state)`
  to the rendered shape both surfaces consume (issue #243, PRD #242).**
  New `core/tour-session-view.ts` exports a `TourSessionView`
  discriminated union mirroring `TourBundle`'s `ok` / `snapshot-lost`
  split, layered into `bundle` / `nav` / `rows` / `tree` / `cursor`
  namespaces, plus `deriveTourSessionView(bundle, state)` (pure, no
  React) and a `useTourSessionView(store, bundle)` hook that runs one
  `useMemo` per namespace so granular invalidation survives the move
  in slices 2 + 3. The view's `cursor.anchor` is the **validated**
  cursor — `state.cursor` pruned against the live `flatRowsList` (a
  CardAnchor to a deleted annotation resolves to null) — so the
  `validateCursor` call that lives inline in both Apps' useEffects
  is now derivable from one source. `core/send-target.ts` is the new
  canonical home for the `SendTarget` type + latest-human-leaf rule;
  `tui/send-target.ts` becomes a thin re-export so existing callers
  keep working until slice 2 migrates them through
  `view.nav.sendTarget`. No surface wiring — both `tui/app.tsx` and
  `web/client/App.tsx` are unchanged at the end of this slice; the
  verifiability story is the pure-data test battery (snapshot-lost
  short-circuit, killer cursor-validation fixture for a stale
  CardAnchor, namespace shape assertions, watcher-reload
  preservation). `CONTEXT.md` Language section gains a `Tour-session
  view` entry paired with `Tour-session` and `Tour bundle`.

  Issue: #243 · PRD: #242

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

- **Webapp diff-row line-number gutter and `+`/`-` symbol render in
  monospace at 12px / 20px line-height (issue #241).** The gutter and
  symbol cells were inheriting the body's sans-serif font at 16px with
  browser-computed `line-height: normal`; line numbers rendered with
  proportional-width digits while the code cell rendered in monospace
  at 12px. Because the gutter's content-dependent line-height didn't
  match the code's, the gutter's number drifted out of vertical
  alignment with the first physical row of a wrapped code line. Empirical
  DOM inspection of a live GitHub PR diff shows monospace 12px with a
  fixed `line-height: 20px` on both `.blob-num` and `.blob-code-inner`.
  `.tour-row-gutter`, `.tour-row-symbol`, and `.tour-row-code` now all
  declare the same monospace stack (`ui-monospace, SFMono-Regular,
  "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`),
  `font-size: 12px`, and `line-height: 20px`. The pre-existing chrome
  (text-align, color, padding, user-select on the gutter; text-align,
  padding, color on the symbol; white-space, word-break, tab-size on the
  code) is preserved — the new declarations are additive. Compose
  correctly with the existing cursor outline, range tint, two-tone
  line-type backgrounds, and empty-side neutral fill (orthogonal —
  backgrounds + outline are unrelated to font / line-height).

  Issue: #241

- **Webapp diff-row long lines soft-wrap instead of producing per-cell
  horizontal scrollbars (issue #240).** The #239 monospace + preserved-
  whitespace fix picked Path A (`white-space: pre` + per-cell
  `overflow-x: auto`); the result was that every long line in every diff
  rendered its own horizontal scrollbar — and in split layout, a long
  addition and a long deletion on the same row each got their own,
  independently scrollable. Visually noisy and not how GitHub actually
  behaves (empirical DOM inspection of a live PR diff cell shows
  `white-space: pre-wrap` + `overflow-x: visible`, i.e. soft-wrap).
  `.tour-row-code` now declares `white-space: pre-wrap` (preserves leading
  + internal whitespace identically to `pre`, but breaks at the cell edge)
  + `word-break: break-all` (a single unbroken token — URL, base64 blob,
  generated hash, minified line — wraps at a character boundary rather
  than overflowing). `.tour-row-cell` drops `overflow-x: auto`; the
  default `overflow: visible` is the right behavior under soft-wrap.
  `min-width: 0` remains so the file-grid's `1fr` code track can still
  shrink below content size. The cursor outline, range tint, two-tone
  line-type backgrounds, and empty-side neutral fill all paint via
  `background-color` / `outline` / `box-shadow` which flex with the
  cell's actual height, so the taller wrapped rows compose correctly
  with no other rule change. Shiki token spans set `color: #…` inline;
  the parent's new `white-space` / `word-break` don't touch token colors.

  Issue: #240

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
