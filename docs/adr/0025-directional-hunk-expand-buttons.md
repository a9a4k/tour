# Directional hunk expand buttons (Up / Down / All) supersede symmetric-`Enter` + `Shift+Enter`

> **Status:** Supersedes ADR 0013's *TUI: cursor + `Enter` is the unified primitive* decision in the specific points of (a) symmetric `10+10` expansion on a single hunk-header press and (b) `Shift+Enter` as the "expand entire gap" shortcut; the cursor + `Enter` primitive itself stands. Supersedes ADR 0018's gap-size-conditional row count shapes (`hunk-header` interactive at `0 < gapAbove ≤ 2N`; `gap-mid-top` + interactive `hunk-header` at `gapAbove > 2N`) and the `Shift+Enter` / shift-click escape hatch. The asymmetric file-top merge into `hunk-header` (ADR 0018), the `2N = 40` threshold, the **D1** spatial-position convention, and the surface-parity principle all stand. ADR 0024's webapp ownership (gap rows render natively as planner-emitted `kind: "interactive"` rows; click and `Enter` dispatch to `core/expansion-state.ts`) is unchanged in shape — this ADR widens the row vocabulary, not the dispatch path. ADR 0013's orphan-auto-window (`±10` lines around hidden anchors) and per-renderer-session state posture are unchanged.
>
> **Amended (issue #280 / re-confirmed by issue #290) — GitHub-parity two-cell hunk-header.** The original phrasing below — *"each directional button is its own full-width row; the hunk-header banner is display-only"* — was based on intuition, not empirical inspection. A live GitHub PR DOM read showed each `tr.js-expandable-line` is a **two-cell** row: a ~44px button cell (`td.blob-num-expandable`) carrying the primary direction button, paired with the `@@` text cell. Tour now mirrors that: the **primary direction** (Up / All for the file-top + mid-file case) collocates with the `@@` text on the hunk-header row itself; only the mid-file large-gap *second* Expand Down stays as a standalone row. The hunk-header's left cell is cursor-walkable + Enter-dispatches when its `primaryExpand` is non-null. The threshold table, the reducer dispatch table, and the D1 convention are unchanged; only the row emission shape and the `InteractiveSubKind` vocabulary shift. Sections marked **(amended #280)** below carry the post-amendment text.
>
> **Amended (issue #292) — standalone `expand-down` adopts the same two-cell shape.** #280 fixed the *banner* shape (Up / All collocate with `@@`) but left the *standalone* Expand Down as a full-width `<InteractiveRow>` with a neutral-subtle background and a centered `↓ Expand Down` glyph. Re-inspection of GitHub's DOM showed the standalone Down `<tr>` uses the **same two-cell shape as the hunk-header banner**: a 44px saturated-blue button cell (`td.blob-num-expandable`) carrying `↓` paired with a wide accent-subtle right cell that is empty (no `@@` text). The Down standalone row's button now lines up vertically with the banner's Up button in the mid-file large-gap case, and the accent-subtle wash carries continuously across both rows. The web surface gains a new `<ExpandDownStandalone>` primitive (reusing the banner's `.tour-hunk-header` / `.tour-hunk-header-button` / `.tour-hunk-header-text` CSS classes); the TUI's `DiffRows` interactive-row branch grows a two-cell render path for `subKind === "expand-down"`. The planner row vocabulary, the reducer dispatch (`direction: "down"`, `count: EXPANSION_STEP`), and the cursor walker are unchanged. Sections marked **(amended #292)** below carry the post-amendment text.

> **Scope:** webapp + TUI. Both surfaces adopt the same row vocabulary, the same threshold, and the same `Enter`-or-click → reducer wiring. The planner's `PlannedRow[]` stays the single source of truth per ADR 0024.

The hunk-header banner becomes a **two-cell row** matching GitHub's empirical layout (issue #280): a ~44px left cell hosts the *primary direction* expand affordance (`↑` for "up", `↕` for "all", or an inert `…` placeholder when nothing's expandable); the right cell carries the parsed `@@ -X,Y +Z,W @@ context` text on an accent-subtle wash. The whole row is cursor-walkable iff the left cell is interactive (`primaryExpand !== null`); pressing `Enter` (or clicking the left cell) dispatches the cursored direction. Only the *second* `expand-down` row for mid-file large gaps stays as a standalone full-width `interactive-row` above the banner; small gaps (`< 40`) and file-top hunks collapse to a single hunk-header row. File-bottom emits a lone `expand-down` standalone row with no companion hunk-header (already past the last hunk). Each non-`all` press reveals 20 lines per ADR 0018's `N = 20` step size; an `all` press reveals the entire remaining gap. The per-file **Expand all hidden** button in the file header (defined in PRD #270 / Slice 4) replaces the previous `Shift+Enter` whole-gap shortcut.

## Decisions

### Primary direction collocates with the hunk-header; `expand-down` is the only standalone subkind (amended #280)

`HunkHeaderRow` gains a `primaryExpand: "up" | "all" | null` field; the banner's left cell hosts the corresponding directional button. `InteractiveSubKind` carries `expand-down` (the only standalone directional row left) alongside `boundary-top`, `hunk-separator`, `expand-file-all`, `boundary-bottom`, and `collapsed-file`. `gap-mid-top` is removed. The pre-amendment `expand-up` and `expand-all` subkinds never landed as standalone rows — they fold onto the banner's `primaryExpand` from the start. The threshold `GAP_TWO_ROW_THRESHOLD = 40` is the same `2N` constant from ADR 0018; only the row emission shape changes:

| `gapAbove`        | File position    | Rows emitted                                                                                                              |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `0`               | any              | `hunk-header` only, `primaryExpand: null` (inert `…` placeholder; not cursor-walkable)                                    |
| `0 < gap < 40`    | any              | `hunk-header`, `primaryExpand: "all"` (single cursor stop carries `↕` on the left cell)                                   |
| `gap ≥ 40`        | mid-file         | standalone `expand-down` (top of gap) + `hunk-header`, `primaryExpand: "up"` (banner left cell carries `↑`)               |
| `gap ≥ 40`        | file-top edge    | `hunk-header`, `primaryExpand: "up"` (single direction toward file start; no standalone row)                              |
| `gap ≥ 40`        | file-bottom edge | standalone `expand-down` (single direction toward file end; no companion hunk-header — file is already past the last hunk) |

A pure helper `hunkHeaderExpandPlan(gapAbove, isFirst)` decides the per-hunk emission: returns `{ primaryExpand, emitLeadingExpandDown }`. The planner calls it once per hunk-header gap (file-top + mid-file) and emits the standalone `expand-down` only when `emitLeadingExpandDown === true`. The file-bottom case is handled separately — when the file's last hunk doesn't reach EOF and `remaining > 0`, the planner emits a single `expand-down` row with `boundaryRef: "bottom"` (no hunk-header companion). The hunk-header row itself stays in the stream at every `gapAbove`, two-cell on both surfaces.

### Hunk-header banner is a two-cell row; left cell is interactive iff `primaryExpand !== null` (amended #280)

The webapp's `<HunkHeaderBanner>` and the TUI's equivalent both render a two-cell row:

- **Left cell** (~44px, `theme.bg.accentEmphasis` background, `theme.fg.onEmphasis` glyph). Carries `↑` (primaryExpand "up"), `↕` ("all"), or an inert `…` placeholder ("null"). When `primaryExpand !== null` the cell carries `role="button"`, `tabIndex={0}` (web) / a click handler (TUI), and dispatches the corresponding `expand` action on click or `Enter`. When `primaryExpand === null` the cell is non-interactive and the row is skipped by the cursor walker (`flat-rows` doesn't project it as an `InteractiveFlatRow`).
- **Right cell** (`theme.bg.accentSubtle` wash). Renders the parsed range segment (`@@ -X,Y +Z,W @@`) and function-context text as static metadata. Never carries a click handler — clicking on the `@@` text is a no-op (mirrors GitHub's `td.blob-code-hunk`).

The cursor outline (`.is-cursor`) paints on the left cell when the banner is cursored. Flat-rows projects the hunk-header as an `InteractiveFlatRow` with `subKind: "boundary-top"` (hunkIndex 0) or `"hunk-separator"` (mid-file) and `boundaryRef: "top"` or the hunk index respectively — same vocabulary the standalone `expand-down` row uses, so the cursor walker recognises it for free. The `::before` `…` cue introduced in issue #252 is removed; the same glyph now lives inline in the left cell as the inert placeholder.

### Standalone `expand-down` row mirrors the banner's two-cell shape (amended #292)

The mid-file large-gap and file-bottom `expand-down` rows render with the same two-cell layout as the hunk-header banner:

- **Left cell** (44px, `theme.bg.accentEmphasis` background, `theme.fg.onEmphasis` glyph). Carries `↓`. Interactive: `role="button"`, `tabIndex={0}`, `aria-label="Expand Down"` (web) / click handler (TUI); dispatches `expand(boundaryRef, "down", EXPANSION_STEP)` on click or cursored Enter.
- **Right cell** (`theme.bg.accentSubtle` wash). Empty content (no `@@` text — the row is a pure affordance, not a hunk header). Non-interactive; matches GitHub's `td.blob-code-hunk` no-op behaviour.

The webapp uses a dedicated `<ExpandDownStandalone>` primitive that reuses the banner's `.tour-hunk-header` / `.tour-hunk-header-button` / `.tour-hunk-header-text` CSS rules (same `display: flex`, same accent-subtle / accent-emphasis bgs, same 44px button-cell width). The TUI's `DiffRows` interactive-row branch grows a two-cell render path for `subKind === "expand-down"` that mirrors the hunk-header branch's flex-row structure (saturated button box + accent-subtle right box). The Down standalone row's button now lines up vertically with the hunk-header banner's Up button in the mid-file large-gap case, and the accent-subtle right-cell wash is continuous across both rows. `.tour-row-interactive` (neutral-subtle, full-width, centered-glyph) remains the treatment for `collapsed-file` (web) and `expand-file-all` / `collapsed-file` (TUI); `expand-down` no longer renders through that path.

### Reducer dispatch maps the affordances to existing `direction` values (amended #280)

The reducer's existing `expand(boundaryRef, direction, count)` action handles every affordance through different parameter combinations:

| Cursored affordance                        | Reducer dispatch                                |
| ------------------------------------------ | ----------------------------------------------- |
| Hunk-header banner, `primaryExpand: "up"`  | `direction: "up"`, `count: 20`                  |
| Standalone `expand-down` row               | `direction: "down"`, `count: 20`                |
| Hunk-header banner, `primaryExpand: "all"` | `direction: "both"`, `count: gapAbove`          |

No new action shape; the `direction: "up" | "down" | "both"` state machine inside `core/expansion-state.ts` carries the load without modification. The dispatch path is identical to the original ADR shape — only the *origin* of the "up" / "all" dispatch moves from a standalone row to the banner's left cell.

### `Shift+Enter` is removed; per-file Expand-all replaces it

The `Shift+Enter` (TUI) and shift-click (web) "expand entire gap" shortcuts from ADR 0013 / ADR 0018 are gone. The reviewer who wants whole-file revelation uses the per-file **Expand all hidden** button in the file header, dispatching a new `expand-file-all` reducer action that expands every hidden gap in the file in one state mutation. The button is cursor-walkable and click-dispatchable on both surfaces. Gap-local "give me everything" is covered by the `expand-all` row when the gap is `< 40`; for gaps `≥ 40` the reviewer either takes both directional rows in sequence or uses the per-file button.

### Cross-surface consistency: planner stays the single source of truth (amended #280, #292)

Both surfaces consume the same `PlannedRow[]`. The row vocabulary widens identically on both per ADR 0024; only the visual rendering of each row kind is surface-specific (web: `<HunkHeaderBanner>` two-cell layout for the hunk-header with `primaryExpand` + `<ExpandDownStandalone>` two-cell layout for the standalone `expand-down` row + `<InteractiveRow>` for the remaining neutral-subtle subkinds; TUI: equivalent two-cell hunk-header + two-cell `expand-down` via OpenTUI flex-row primitives, plus `DiffLine`-based fallback for the neutral-subtle interactive subkinds). No surface-specific row kind, no per-surface threshold, no divergent dispatch.

### Glyphs follow ADR 0018's D1 convention (amended #280)

Each affordance's glyph is a redundant cue, not the invariant — the row's spatial position is the invariant per ADR 0018's D1 decision. The hunk-header banner carries `↑` in its left cell when `primaryExpand === "up"` (reveals lines above, toward file start) and `↕` when `primaryExpand === "all"` (reveals the whole gap); the standalone `expand-down` row carries `↓` (reveals lines below, toward file end); the inert placeholder is `…` (nothing to reveal). The glyph never flips on layout toggle, because the row's position relative to the gap is layout-invariant.

## Considered Options

- **Status quo (symmetric `Enter` + `Shift+Enter`).** Rejected. The symmetric model gives no directional choice on `≥ 40` gaps unless the reviewer reaches for the modifier — and the modifier expands *everything*, not the other direction. The model assumes the reviewer wants both ends equally; field observation under PRD #270's drafting and the GitHub-DOM evidence (see *Empirical motivation*) show that reviewers routinely want one direction at a time (lead-in vs. extension).

- **Add `[` / `]` / `{` / `}` keymap entries for direction selection from any cursor position.** Rejected by ADR 0013 with the reasoning *"four keys for one feature; 'top vs bottom of gap' is a UX distinction users almost never make"* and *"'nearest gap' tiebreak heuristics are fuzzy."* That rejection targeted a different design — adding new keymap entries to dispatch direction from any cursor position via a "nearest gap" heuristic. The model in this ADR adds **zero new keys**: the existing cursor walks to a directional row, and the existing `Enter` dispatches the cursored direction. The "key inflation" objection no longer applies because no new keys are added. The "nearest-gap heuristic" objection is also moot because each direction is its own explicit cursor target with no heuristic involved — the row's own existence and position carry the disambiguation.

- **Keep `Shift+Enter` alongside the per-file Expand-all button.** Rejected. Every competitor (GitHub, GitLab, Phabricator, Reviewable) uses per-row + per-file buttons without a modifier-key shortcut; aligning gives a simpler mental model (`Enter` does what the cursor is on, no special cases). The per-file button is the single discoverable escape hatch; a parallel keystroke would split the affordance and re-introduce the "key inflation" objection the new model avoids.

- **One-row gaps with a direction-toggle on the hunk-header (e.g. `h` / `l` selects direction before `Enter`).** Rejected. Modalizes the cursor — `h` / `l` already mean "toggle preferred side" on paired diff rows in split layout (per ADR 0011), and overloading them with direction-select on hunk-headers would re-introduce the modality that ADR 0011 deliberately avoided. The three-row vocabulary makes the choice explicit in the diff stream, so `Enter` always does the one thing the cursor is on.

- **Drop the `expand-all` row entirely; small gaps would render only the inert hunk-header.** Rejected. Sub-40 gaps would lose their gap-local affordance, forcing the reviewer to find the per-file button for one-shot reveal even when the gap is trivially small. `expand-all` keeps the affordance local to the gap and matches GitHub's "Expand All" button per the empirical evidence.

- **Single `expand-all` for every gap regardless of size; never emit directional pairs.** Rejected. Loses the directional-choice win for `≥ 40` gaps that the model exists to deliver. The reviewer reading hunk N wants to extend hunk N's tail (Down) *or* peek at hunk N+1's head (Up) — not both at once. The threshold acknowledges that small gaps fit comfortably in one press, but large gaps reward the split.

- **`D2` (glyph-direction) iconography that flips when layout toggles.** Rejected — already rejected in ADR 0018 for the same reason, restated here for clarity: the `↑` on `expand-up` always reveals lines above the row, regardless of layout. D1 (spatial-position) is preserved.

- **Per-file Expand-all button on the diff side rather than the file header.** Rejected. The file header is the natural per-file affordance surface — the existing copy-path button (per issue #225) and diff-stats indicator (per issue #228) already live there. Placing Expand-all there keeps file-scoped actions together; placing it in the diff body would steal a row from the diff stream and confuse "what scope does this button act on."

- **Three rows per gap: one TR per directional button, hunk-header text as a separate display-only row (the pre-amendment shape).** Rejected on amendment (issues #280 / #290). The original ADR proposed this shape based on intuition rather than empirical inspection of GitHub's DOM. Re-inspection showed GitHub uses a two-cell row (button cell + `@@` text cell) per primary direction, with only the mid-file large-gap *second* Expand Down as a standalone row. Tour's three-row variant required one extra cursor stop per hunk and read as visually busier than the empirical convention. The two-cell variant collapses the row count to match GitHub's (2 rows for mid-file large gaps; 1 for everything else with a hunk-header), preserves the cursor + Enter primitive, and keeps the directional-choice win for `≥ 40` gaps via the standalone `expand-down` + banner-Up pairing.

## Empirical motivation (amended #280)

GitHub's live PR-diff DOM renders directional expand buttons inside a **two-cell** `tr.js-expandable-line` row — the primary direction shares a row with the `@@` text. The relevant DOM, re-inspected in detail for issue #280:

```html
<tr class="js-expandable-line">
  <td class="blob-num blob-num-expandable">   <!-- ~44px left cell, saturated bg -->
    <a class="js-expand directional-expander" aria-label="Expand Up">…</a>
  </td>
  <td class="blob-code blob-code-inner blob-code-hunk">
    @@ -X,Y +Z,W @@ context                    <!-- right cell, accent-subtle wash -->
  </td>
</tr>
```

Per gap, GitHub's row count is:

| Scenario                              | GitHub rows                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Mid-file, gap ≥ 40                    | standalone TR `[Expand Down][empty]` + hunk-header TR `[Expand Up][@@ text]` (2 TRs) |
| Mid-file, gap < 40                    | hunk-header TR `[Expand All][@@ text]` (1 TR)                                        |
| File-top with gap                     | hunk-header TR `[Expand Up][@@ text]` (1 TR; only one direction available)           |
| File-bottom (lines hidden below last) | standalone TR `[Expand Down][empty]` (1 TR; no hunk-header companion)                |

The `aria-label` values (`"Expand Up"`, `"Expand Down"`, `"Expand All"`) match the affordance vocabulary adopted here. GitHub's hunk-header text cell (`td.blob-code-hunk`) is non-interactive — the affordance lives exclusively on `td.blob-num-expandable`. Tour's row counts now match GitHub's exactly. The standalone Down `<tr>` shares the two-cell shape with the hunk-header banner (44px saturated button cell + wide accent-subtle right cell); only the right cell's content differs — empty for the standalone Down row, `@@` text for the banner (amended #292).

The original ADR specified a *three rows per gap* model (one TR per directional button, separated from the hunk-header text). That misread GitHub's DOM — the directional buttons share a TR with the `@@` text. Issue #280 corrected the structural design; issue #290 re-confirmed it by re-inspecting the GitHub DOM and ratified this amendment.

The point isn't visual parrot-mimicry. Reviewers who switch between GitHub and Tour carry a button-shaped mental model AND a row-count-shaped one; landing on a same-shaped affordance with the same row counts lowers cross-tool surface area on both axes. The previous symmetric model required a one-shot learning cost ("Tour does it differently") for a UX distinction that the empirical convention treats as fundamental.

## Consequences

- **ADR 0013's TUI symmetric-expansion decision is reversed in the specific sense above.** The cursor + `Enter` primitive (one key, dispatching to a row-kind-specific action) stands — it now dispatches `direction: "up" | "down" | "both"` based on the cursored row's subkind, instead of always `"both"` with `count: 10` on each side.
- **ADR 0018's gap-size-conditional threshold (`2N = 40`) stands but the row shapes flip (amended #280).** Small gaps (`< 40`) emit a single hunk-header row with `primaryExpand: "all"` on the left cell. Mid-file large gaps (`≥ 40`) emit a standalone `expand-down` row + a hunk-header row with `primaryExpand: "up"` on the left cell. File-top large gaps collapse to a single hunk-header row with `primaryExpand: "up"`. File-bottom is a standalone `expand-down` with no companion banner. The hunk-header is two-cell on both surfaces; the left cell is cursor-walkable iff `primaryExpand !== null`.
- **`Shift+Enter` keymap binding is removed.** No parallel keystroke replaces it; the per-file Expand-all button is the only "give me everything" affordance on either surface.
- **Cursor walker is unchanged (amended #280).** The walker already iterates `kind: "interactive"` rows and now also iterates `kind: "hunk-header"` rows whose `primaryExpand !== null` (projected as `boundary-top` / `hunk-separator` `InteractiveFlatRow`s by `flat-rows.ts`); both slot in for free without per-subkind walker logic. DOM order is preserved: in the mid-file large-gap case the cursor visits the standalone `expand-down` first (top of gap) then the hunk-header banner with the Up button (bottom of gap, just above the next hunk).
- **The webapp's `::before` `…` cue from issue #252 is removed (amended #280).** Its CSS-pseudo-element form is gone; the inert `…` glyph now lives inline as the left cell's content when `primaryExpand === null`.
- **`InteractiveSubKind` enumerates only the standalone-row subkinds (amended #280).** `expand-down` joins the union; `gap-mid-top` leaves it. The pre-amendment `expand-up` and `expand-all` are *not* standalone-row subkinds — they fold onto `HunkHeaderRow.primaryExpand` and dispatch through the banner's left cell, addressed by the existing `boundary-top` / `hunk-separator` flat-row projection. Existing call sites that switch on `subKind` extend to `expand-down` only; the hunk-header banner case stays in the `kind: "hunk-header"` branch.
- **The reducer gains one new action shape (`expand-file-all`).** Existing `expand(boundaryRef, direction, count)` covers the per-row dispatches; `expand-file-all(file)` walks every gap in the file and expands each in one state mutation.
- **No data-model changes.** Annotation anchors, `tour.toml`, `annotations.jsonl`, the bundle's per-side `oldContent` / `newContent`, and the orphan-window mechanism are all unchanged. The change is render-time only.
- **CONTEXT.md vocabulary aligns with the new row family (amended #280).** The `gap-mid-top` term leaves the glossary; `expand-down` enters as a standalone-row subkind; `primaryExpand: "up" | "all" | null` joins the `HunkHeaderRow` description as the field carrying the banner's left-cell affordance. References to `Shift+Enter` as "expand entire gap" remove. The Cursor entry's interactive-row list notes that hunk-header banners with `primaryExpand !== null` are cursor stops via the existing `boundary-top` / `hunk-separator` subkinds.
- **PRD #270 carries the cross-cutting implementation across 7 slices** (planner vocabulary + helper; reducer additions; web renderer; TUI renderer; per-file Expand-all button; keymap cleanup; this ADR). Each slice is independently mergeable; the ADR can ship in parallel with implementation per PRD #270's slicing guidance.
- **Reversibility (amended #280).** Reverting would unwind: the `expand-down` `InteractiveSubKind` variant + `hunkHeaderExpandPlan`, `HunkHeaderRow.primaryExpand`, the two-cell hunk-header rendering branches on both surfaces (web `<HunkHeaderBanner>`, TUI `DiffRows` hunk-header branch), the flat-rows projection of interactive hunk-headers, the per-file Expand-all button + `expand-file-all` reducer action, the `gap-mid-top` removal, the `Shift+Enter` keymap removal, and the `::before` cue removal. Bounded but multi-file; the planner vocabulary (`primaryExpand` + `expand-down`) is the load-bearing piece. The reducer's `direction` state machine and the cursor walker are unchanged, so revert wouldn't touch them.
- **Future-proofing.** The directional-row pattern slots in cleanly for future row kinds — e.g. a "load more annotations" row, an "expand surrounding function" row — under the same `kind: "interactive"` umbrella per ADR 0024. The pattern is: planner emits a new subkind, cursor walker recognises it for free, reducer dispatches by subkind, both surfaces render through their existing switch on `subKind`. The two-cell hunk-header pattern also slots in for any future banner-row family that needs an inline affordance — left cell for the action, right cell for the metadata text — without growing the standalone-row vocabulary.
- **The `<InteractiveRow>` neutral-subtle primitive shrinks to non-directional affordances (amended #292).** Only `collapsed-file` (web + TUI) and `expand-file-all` (TUI) render through `.tour-row-interactive`'s full-width centered-glyph treatment now. The `expand-down` subkind dispatches to `<ExpandDownStandalone>` (web) / the TUI's two-cell render branch instead. `InteractiveSubKind` is unchanged — the split is on the renderer side only.
