# Directional hunk expand buttons (Up / Down / All) supersede symmetric-`Enter` + `Shift+Enter`

> **Status:** Supersedes ADR 0013's *TUI: cursor + `Enter` is the unified primitive* decision in the specific points of (a) symmetric `10+10` expansion on a single hunk-header press and (b) `Shift+Enter` as the "expand entire gap" shortcut; the cursor + `Enter` primitive itself stands. Supersedes ADR 0018's gap-size-conditional row count shapes (`hunk-header` interactive at `0 < gapAbove ≤ 2N`; `gap-mid-top` + interactive `hunk-header` at `gapAbove > 2N`) and the `Shift+Enter` / shift-click escape hatch. The asymmetric file-top merge into `hunk-header` (ADR 0018), the `2N = 40` threshold, the **D1** spatial-position convention, and the surface-parity principle all stand. ADR 0024's webapp ownership (gap rows render natively as planner-emitted `kind: "interactive"` rows; click and `Enter` dispatch to `core/expansion-state.ts`) is unchanged in shape — this ADR widens the row vocabulary, not the dispatch path. ADR 0013's orphan-auto-window (`±10` lines around hidden anchors) and per-renderer-session state posture are unchanged.

> **Scope:** webapp + TUI. Both surfaces adopt the same row vocabulary, the same threshold, and the same `Enter`-or-click → reducer wiring. The planner's `PlannedRow[]` stays the single source of truth per ADR 0024.

The hunk-header banner stops being clickable. In its place, the planner emits explicit **directional expand rows** per hidden gap — `expand-up`, `expand-down`, `expand-all` — each a separate cursor stop. Mid-file gaps `≥ 40` lines emit a pair (`expand-down` at the top of the gap; `expand-up` just above the next hunk's header); gaps `< 40` emit a single `expand-all`; file-edge gaps emit the single applicable direction (or `expand-all` when small enough). The reviewer who wants to peek at the previous hunk's tail walks the cursor to the `expand-down` row and presses `Enter`; the reviewer who wants lead-in to the next hunk walks to the `expand-up` row. Each press reveals 20 lines per ADR 0018's `N = 20` step size. The per-file **Expand all hidden** button in the file header (defined in PRD #270 / Slice 4) replaces the previous `Shift+Enter` whole-gap shortcut.

## Decisions

### Three directional row subkinds; `gap-mid-top` is removed

`InteractiveSubKind` gains `expand-up`, `expand-down`, `expand-all`. `gap-mid-top` is removed — its top-of-gap position folds into `expand-down`. The threshold `GAP_TWO_ROW_THRESHOLD = 40` is the same `2N` constant from ADR 0018; only the row emission shape changes:

| `gapAbove`        | File position    | Rows emitted                                                        |
| ----------------- | ---------------- | ------------------------------------------------------------------- |
| `0`               | any              | `hunk-header` only (display-only)                                   |
| `0 < gap < 40`    | any              | `expand-all` (one cursor stop)                                      |
| `gap ≥ 40`        | mid-file         | `expand-down` (top of gap) + `expand-up` (just above next header)   |
| `gap ≥ 40`        | file-top edge    | `expand-up` (single direction toward file start)                    |
| `gap ≥ 40`        | file-bottom edge | `expand-down` (single direction toward file end)                    |

A pure helper `expandRowsForGap(gapAbove, isFirst, isLast)` decides the emission. The planner calls it once per gap and slots the rows around the existing `hunk-header` (mid-file / file-top) or after the last hunk's content (file-bottom). The hunk-header row itself stays in the stream as display-only metadata at every `gapAbove`.

### Hunk-header banner is display-only at every `gapAbove`

The `hunk-header` row never carries a click handler, never dispatches on `Enter`, and is not a cursor stop. The webapp's `<HunkHeaderBanner>` and the TUI's equivalent render the range segment (`@@ -X,Y +Z,W @@`) and function-context text as static metadata. The `::before` `…` cue introduced in issue #252 is removed; its premise — "the banner is the affordance" — no longer holds now that explicit directional buttons carry the affordance.

### Reducer dispatch maps the subkinds to existing `direction` values

The reducer's existing `expand(boundaryRef, direction, count)` action handles all three new rows through different parameter combinations:

| Cursored row    | Reducer dispatch                                |
| --------------- | ----------------------------------------------- |
| `expand-up`     | `direction: "up"`, `count: 20`                  |
| `expand-down`   | `direction: "down"`, `count: 20`                |
| `expand-all`    | `direction: "both"`, `count: gapAbove`          |

No new action shape; the `direction: "up" | "down" | "both"` state machine inside `core/expansion-state.ts` carries the load without modification.

### `Shift+Enter` is removed; per-file Expand-all replaces it

The `Shift+Enter` (TUI) and shift-click (web) "expand entire gap" shortcuts from ADR 0013 / ADR 0018 are gone. The reviewer who wants whole-file revelation uses the per-file **Expand all hidden** button in the file header, dispatching a new `expand-file-all` reducer action that expands every hidden gap in the file in one state mutation. The button is cursor-walkable and click-dispatchable on both surfaces. Gap-local "give me everything" is covered by the `expand-all` row when the gap is `< 40`; for gaps `≥ 40` the reviewer either takes both directional rows in sequence or uses the per-file button.

### Cross-surface consistency: planner stays the single source of truth

Both surfaces consume the same `PlannedRow[]`. The row vocabulary widens identically on both per ADR 0024; only the visual rendering of each row kind is surface-specific (web: `<InteractiveRow>` with the row's glyph + text label; TUI: equivalent banner row with the same glyph + label via OpenTUI primitives). No surface-specific row kind, no per-surface threshold, no divergent dispatch.

### Glyphs follow ADR 0018's D1 convention

Each directional row's glyph is a redundant cue, not the invariant — the row's spatial position is the invariant per ADR 0018's D1 decision. `expand-up` carries `↑` and reveals lines above (toward file start); `expand-down` carries `↓` and reveals lines below (toward file end); `expand-all` carries `↕` and reveals the whole gap. The glyph never flips on layout toggle, because the row's position relative to the gap is layout-invariant.

## Considered Options

- **Status quo (symmetric `Enter` + `Shift+Enter`).** Rejected. The symmetric model gives no directional choice on `≥ 40` gaps unless the reviewer reaches for the modifier — and the modifier expands *everything*, not the other direction. The model assumes the reviewer wants both ends equally; field observation under PRD #270's drafting and the GitHub-DOM evidence (see *Empirical motivation*) show that reviewers routinely want one direction at a time (lead-in vs. extension).

- **Add `[` / `]` / `{` / `}` keymap entries for direction selection from any cursor position.** Rejected by ADR 0013 with the reasoning *"four keys for one feature; 'top vs bottom of gap' is a UX distinction users almost never make"* and *"'nearest gap' tiebreak heuristics are fuzzy."* That rejection targeted a different design — adding new keymap entries to dispatch direction from any cursor position via a "nearest gap" heuristic. The model in this ADR adds **zero new keys**: the existing cursor walks to a directional row, and the existing `Enter` dispatches the cursored direction. The "key inflation" objection no longer applies because no new keys are added. The "nearest-gap heuristic" objection is also moot because each direction is its own explicit cursor target with no heuristic involved — the row's own existence and position carry the disambiguation.

- **Keep `Shift+Enter` alongside the per-file Expand-all button.** Rejected. Every competitor (GitHub, GitLab, Phabricator, Reviewable) uses per-row + per-file buttons without a modifier-key shortcut; aligning gives a simpler mental model (`Enter` does what the cursor is on, no special cases). The per-file button is the single discoverable escape hatch; a parallel keystroke would split the affordance and re-introduce the "key inflation" objection the new model avoids.

- **One-row gaps with a direction-toggle on the hunk-header (e.g. `h` / `l` selects direction before `Enter`).** Rejected. Modalizes the cursor — `h` / `l` already mean "toggle preferred side" on paired diff rows in split layout (per ADR 0011), and overloading them with direction-select on hunk-headers would re-introduce the modality that ADR 0011 deliberately avoided. The three-row vocabulary makes the choice explicit in the diff stream, so `Enter` always does the one thing the cursor is on.

- **Drop the `expand-all` row entirely; small gaps would render only the inert hunk-header.** Rejected. Sub-40 gaps would lose their gap-local affordance, forcing the reviewer to find the per-file button for one-shot reveal even when the gap is trivially small. `expand-all` keeps the affordance local to the gap and matches GitHub's "Expand All" button per the empirical evidence.

- **Single `expand-all` for every gap regardless of size; never emit directional pairs.** Rejected. Loses the directional-choice win for `≥ 40` gaps that the model exists to deliver. The reviewer reading hunk N wants to extend hunk N's tail (Down) *or* peek at hunk N+1's head (Up) — not both at once. The threshold acknowledges that small gaps fit comfortably in one press, but large gaps reward the split.

- **`D2` (glyph-direction) iconography that flips when layout toggles.** Rejected — already rejected in ADR 0018 for the same reason, restated here for clarity: the `↑` on `expand-up` always reveals lines above the row, regardless of layout. D1 (spatial-position) is preserved.

- **Per-file Expand-all button on the diff side rather than the file header.** Rejected. The file header is the natural per-file affordance surface — the existing copy-path button (per issue #225) and diff-stats indicator (per issue #228) already live there. Placing Expand-all there keeps file-scoped actions together; placing it in the diff body would steal a row from the diff stream and confuse "what scope does this button act on."

## Empirical motivation

GitHub's live PR-diff DOM (inspected during PRD #270's drafting) renders three explicit button kinds per hunk gap. The relevant DOM:

```html
<tr class="js-expandable-line">
  <td class="blob-num-expandable">
    <a class="directional-expander" aria-label="Expand Up">…</a>
    <a class="directional-expander" aria-label="Expand Down">…</a>
    <!-- or a single Expand All on small gaps -->
  </td>
  <td class="blob-code-hunk">@@ … @@</td>
</tr>
```

The `aria-label` values (`"Expand Up"`, `"Expand Down"`, `"Expand All"`) match the row subkinds adopted here. GitHub's hunk-header text cell (`td.blob-code-hunk`) is non-interactive — the affordance lives exclusively on `td.blob-num-expandable`. The three-button-per-gap model in this ADR mirrors this empirical convention.

The point isn't visual parrot-mimicry. Reviewers who switch between GitHub and Tour carry a button-shaped mental model; landing on a same-shaped affordance lowers cross-tool surface area. The previous symmetric model required a one-shot learning cost ("Tour does it differently") for a UX distinction that the empirical convention treats as fundamental.

## Consequences

- **ADR 0013's TUI symmetric-expansion decision is reversed in the specific sense above.** The cursor + `Enter` primitive (one key, dispatching to a row-kind-specific action) stands — it now dispatches `direction: "up" | "down" | "both"` based on the cursored row's subkind, instead of always `"both"` with `count: 10` on each side.
- **ADR 0018's gap-size-conditional threshold (`2N = 40`) stands but the row shapes flip.** Small gaps (`< 40`) emit one `expand-all` row instead of folding into an interactive `hunk-header`. Large gaps (`≥ 40`) emit `expand-down` + `expand-up` instead of `gap-mid-top` + interactive `hunk-header`. The `hunk-header` is display-only in both shapes.
- **`Shift+Enter` keymap binding is removed.** No parallel keystroke replaces it; the per-file Expand-all button is the only "give me everything" affordance on either surface.
- **Cursor walker is unchanged.** The walker already iterates `kind: "interactive"` rows; the new subkinds slot in for free without per-subkind walker logic. DOM order is preserved: when both `expand-down` and `expand-up` exist for the same gap, the cursor visits Down first (top of gap) then Up (above the next header).
- **The webapp's `::before` `…` cue from issue #252 is removed.** Its premise ("the banner is the affordance") no longer holds.
- **`InteractiveSubKind` enumerates the new subkinds.** `expand-up`, `expand-down`, `expand-all` join the union; `gap-mid-top` leaves it. Existing call sites that switch on `subKind` extend to the three new cases.
- **The reducer gains one new action shape (`expand-file-all`).** Existing `expand(boundaryRef, direction, count)` covers the per-row dispatches; `expand-file-all(file)` walks every gap in the file and expands each in one state mutation.
- **No data-model changes.** Annotation anchors, `tour.toml`, `annotations.jsonl`, the bundle's per-side `oldContent` / `newContent`, and the orphan-window mechanism are all unchanged. The change is render-time only.
- **CONTEXT.md vocabulary aligns with the new row family.** The `gap-mid-top` term leaves the glossary; `expand-up`, `expand-down`, `expand-all` enter. References to `Shift+Enter` as "expand entire gap" remove. The Cursor entry's interactive-row list updates accordingly.
- **PRD #270 carries the cross-cutting implementation across 7 slices** (planner vocabulary + helper; reducer additions; web renderer; TUI renderer; per-file Expand-all button; keymap cleanup; this ADR). Each slice is independently mergeable; the ADR can ship in parallel with implementation per PRD #270's slicing guidance.
- **Reversibility.** Reverting would unwind: the three new `InteractiveSubKind` variants and `expandRowsForGap`, the directional-row rendering branches on both surfaces, the per-file Expand-all button + `expand-file-all` reducer action, the `gap-mid-top` removal, the `Shift+Enter` keymap removal, and the `::before` cue removal. Bounded but multi-file; the planner vocabulary is the load-bearing piece. The reducer's `direction` state machine and the cursor walker are unchanged, so revert wouldn't touch them.
- **Future-proofing.** The directional-row pattern slots in cleanly for future row kinds — e.g. a "load more annotations" row, an "expand surrounding function" row — under the same `kind: "interactive"` umbrella per ADR 0024. The pattern is: planner emits a new subkind, cursor walker recognises it for free, reducer dispatches by subkind, both surfaces render through their existing switch on `subKind`.
