# Web unified diff gutter mirrors the TUI — two number columns

> **Status:** Tightens ADR 0024's web row renderer in the unified-layout direction.
> Cross-surface parity with the TUI's `unifiedGutter` shape established in ADR 0009
> (per-cell row composition). No supersession — the row-stream + CSS-subgrid scaffolding
> of ADR 0024 stand verbatim; this ADR changes the unified-layout grid template only.

The web unified diff row paints **two** line-number columns — old | new — plus a sign
glyph and the code cell, matching the TUI's `unifiedGutter` and GitHub's unified-view
convention. Each gutter cell carries its own `data-side` so anchoring (cursor seed,
`+` annotate button, future per-side permalinks) reads side directly from the gutter
under the pointer. Context rows populate both numbers; pure-addition rows blank the
old column; pure-deletion rows blank the new column.

## Why

The TUI's `unifiedGutter` (in `src/tui/DiffRows.tsx`) emits `[old#] [new#] [sign]`.
GitHub's unified diff renders the same shape. The webapp's unified-layout branch in
`src/web/client/row-components.tsx` collapses to one gutter via
`lineNumber = rightLineNumber ?? leftLineNumber` and renders a single column that
*swaps meaning* between rows:

- pure addition → shows new#
- pure deletion → shows old#
- context     → shows new# (old# is dropped entirely)

Costs of the asymmetry:

1. **Ambiguous anchoring.** A comment "on line 47" can mean old-47 or new-47 — the
   reader has to read the `+/-` glyph to decide which file the number indexes into.
   Tour's whole job is line-anchored review (ADR 0017 — anchor validated at write
   time), so the gutter is the wrong place to lose `side`.
2. **Context-row information loss.** On context rows the old line number is dropped.
   A reviewer can't map a context line back to the pre-change file without leaving
   the diff.
3. **Cross-surface jolt.** A reviewer toggling between TUI and webapp on the same
   tour sees a different gutter shape per surface. Tour's other cross-surface
   pillars — highlighting (ADR 0033), pane focus (ADR 0031), footer (ADR 0028) —
   explicitly chase parity; the unified gutter is the last meaningful drift point.
4. **Departure from convention.** GitHub, GitLab, Sourcegraph, Gerrit, Phabricator,
   Bitbucket all paint two-column gutters in unified view. Reviewers come
   pre-trained on left=old, right=new.

## Considered Options

- **Two-column gutter matching TUI / GitHub.** Chosen. Both numbers always available;
  side reads from the gutter under the pointer; cross-surface and cross-tool parity.
  Cost: ~40px extra gutter width and one extra subgrid track on the unified template.

- **Status quo — single gutter with side-swap.** Rejected. The four costs above.

- **Single gutter that always shows the new#.** Rejected. Deletions have no new#;
  the column would blank-out on pure-deletion rows. Anchoring on deletions would
  have nothing to read from the gutter.

- **Hybrid — single number column with hover/tooltip "old N → new M".** Rejected.
  Hides the second number behind interaction; doesn't recover the visual scan
  the second column provides; doesn't reduce gutter width meaningfully (sign + one
  number is already ~80% of the two-number footprint).

- **Responsive collapse — two columns on wide viewports, one on narrow.** Rejected
  as initial behaviour. GitHub doesn't collapse on narrow viewports and it's fine;
  the per-file dynamic width (right-aligned to `max(maxOldDigits, maxNewDigits)`)
  already minimises the footprint. Revisitable if mobile complaints surface.

## Decisions

### Unified grid template gains one track

`file-grid-css`'s unified template moves from `auto auto 1fr` (gutter, symbol, cell)
to `auto auto auto 1fr` (gutter-old, gutter-new, symbol, cell). The split template
is unchanged.

### Each gutter cell carries `data-side`

The deletions-side gutter carries `data-side="deletions"`; the additions-side gutter
carries `data-side="additions"`. The existing `data-line-number` attribute reads the
column-specific number. `data-row-id` (the layout-invariant row id) is unchanged —
still keyed on `additions-N ?? deletions-N` at the row level.

### Per-row column population

- Context row: both gutters populated.
- Pure-addition row: deletions-side gutter blank, additions-side populated.
- Pure-deletion row: additions-side gutter blank, deletions-side populated.
- "Change" rows that the unified planner emits as consecutive addition + deletion
  rows each follow the rules above.

### Sign column stays between gutters and code

Cell order is `[gutter-old] [gutter-new] [sign] [code]`. Matches the TUI's
`unifiedGutter` ordering. Sign reads from the row's kind: `+` on addition rows,
`-` on deletion rows, blank on context.

### Context line numbers paint muted

Mirrors the TUI's `gutterFg = diffBg ? fg.default : fg.muted` rule in
`src/tui/DiffLine.tsx`. Context-row numbers paint `fg.muted`; addition / deletion
numbers paint `fg.default`. Visual emphasis stays on the changed lines despite the
gutter doubling up.

### Right-aligned, file-scoped width

Each file computes `max(maxOldDigits, maxNewDigits)` once on render and uses that
width for both columns. Numbers right-align so they don't jitter between hunks.

### `+` annotate button anchors to the gutter under it

The `onAnnotate` callback (issue #320) already takes `(side, lineNumber)`. With two
gutters, each renders its own `+` button when its column carries a number. Hover
reveals the button on the column under the pointer. The `a` keyboard shortcut
continues to target the cursored side via the existing `cursorSide` plumbing.

### Click-to-seed-cursor reads the clicked column's side

The current unified path resolves `sideForClick` from
`kind ?? preferredSide ?? "additions"`. With two gutters, click on a gutter / code
cell reads `side` from the gutter under the click — context-row clicks no longer
default-bias to additions; they pick up the side the reviewer pointed at.

### A11y — single row label, gutter cells hidden

Each row carries a single `aria-label` ("Added line 13: return bar()" /
"Context line 12: function foo() {"). The two gutter cells and the symbol cell are
`aria-hidden="true"` so screen readers don't utter "12 12 plus return bar".

## Tradeoffs

- **~40px extra gutter width** at typical viewports. Under 5% of common widths.
  Mobile / narrow-split layouts feel it most; mitigation is the per-file dynamic
  width.
- **More visual density in the gutter.** Mitigated by muting context-row numbers
  (parity with TUI) so the eye still tracks `+/-` rows preferentially.
- **One extra subgrid track to maintain.** `file-grid-css` already tracks per-layout
  templates; adding a track is local to the unified rule.

## Reversibility

The change is contained to the webapp:

- The unified branch of the web diff row renderer.
- `file-grid-css`'s unified grid template.
- The webapp test suite — row-snapshot expectations under unified layout.

Reverting is a one-file change in the row renderer plus restoring the prior grid
template. No data-model change. The TUI is untouched; ADR 0024's row-stream contract
is unchanged.

## Consequences

- **Side-of-anchor reads from the gutter** on every row. Cursor seed, `+` annotate
  click, hover-target side, and future per-side permalinks all derive `side`
  directly from the column under the pointer.
- **Context rows recover the old line number.** Reviewers can map a context line
  back to the pre-change file without leaving the diff.
- **Cross-surface parity tightens.** TUI and webapp paint the same gutter shape in
  unified layout; aligns with the parity stance of ADR 0028 (footer), ADR 0031
  (pane focus), ADR 0033 (highlighting).
- **GitHub muscle memory transfers.** Reviewers arriving from a GitHub PR review
  read the gutter without re-learning column meaning.
- **Future per-side permalinks become cheap.** With both numbers in the DOM and
  each gutter carrying `data-side`, anchoring to `#L47` / `#R47` is a follow-up
  attribute change on each gutter — no grid template touch.
- **No change to the unified row's flat-row id.** The cross-surface row-lookup
  used by cursor resolution keeps reading `additions-N ?? deletions-N` at the
  row level — gutters carry side; rows do not.
