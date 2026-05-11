# Annotation visual treatment: row tint + gutter mark

> **Scope:** project-wide. The TUI was the trigger (it had no visual treatment at all), and the consequences below are TUI-flavoured for that reason — but the decision applies to **both surfaces**. The webapp ships the same pattern, expressed in CSS rather than OpenTUI primitives.

An annotation's range needs to be visually marked so the reviewer can connect each annotation card to the lines it covers. Pure tint (the webapp's pre-decision approach) is single-cue (fails the accessibility "two cues" rule, weakest Gestalt grouping) and competes with the diff `+/-` background colours. Hunk's docking-bracket apparatus (the only other documented terminal-native pattern) is the strongest grouping signal but is bespoke (no other terminal tool uses it), costs ~250 LOC of geometry, and is awkward in unified layout. We pick the middle path: a row background tint **plus** a single accent-coloured gutter mark per range row, with the annotation card rendered directly below `line_end` and bordered in the same accent — connecting card and range via shared colour rather than literal box-drawing brackets.

On the webapp, the gutter is a 3px `box-shadow: inset 3px 0 0 #58a6ff` (or equivalent CSS vehicle) at the left edge of each annotated row, side-aware via Pierre's existing `[data-line-type]` selectors. On the TUI, the gutter is a 1-cell-wide accent stripe at column 0 in the same `#58a6ff`, side-aware via the row planner's per-side flags. The colour, the placement (left edge of the matching column in split layout), and the card-coupling (annotation card border in the same accent) are identical across surfaces.

> **Implementation note (2026-05-11):** the TUI stripe is rendered as a 1-cell-wide `<box backgroundColor={ACCENT_FG}>` with `alignSelf="stretch"` (`src/tui/DiffLine.tsx:91-96`), not as a `▎` text glyph as originally specified. The `<box>` form stretches across wrapped lines as a single solid column, where a glyph-per-row approach would have to be re-emitted for every visual line and would leave gaps on wrap. Same colour, same column, same two-cue intent.

## Considered Options

- **Tint only** (the webapp's pre-decision state). Rejected: single-cue, fails the [Section 508 / accessibility "two cues" rule](https://www.section508.gov/create/making-color-usage-accessible/), weakest Gestalt grouping (similarity), and competes with the existing diff `+/-` row backgrounds — a tinted `+` row reads as a third colour cocktail rather than "this row is annotated".
- **Hunk's docking-bracket apparatus** (vertical guide column + tee transition + cap row, with the note card docked half-width into the side matching `anchorSide`). Rejected: bespoke pattern with no precedent in vim, magit, lazygit, vscode, or other terminal review tools; ~250 LOC of geometry (note-height measurement, dock-width math, cap placement); awkward in unified layout where there is no side column; marginal value over tint+gutter for the same Gestalt outcome.
- **Gutter mark only.** Rejected: loses the common-region grouping the existing tint already establishes, and removing the tint would actively regress the webapp's pre-decision state.

## Consequences

- Two cues (colour + character) make the treatment robust under colour blindness, low-colour terminals, and high-glare environments. Either signal alone communicates "this row is annotated".
- The pattern aligns with the established terminal idiom (vim sign column, magit overlay marks, vscode-git gutter bars) — familiar to terminal users from outside Tour.
- Both surfaces ship the same two-cue pattern, expressed in their respective primitives (CSS on web, OpenTUI box-drawing on TUI). The accent colour `#58a6ff` is shared across surfaces.
- For `+`/`-` rows, the range tint applies only to the line-number column (not the full row), so the diff `+/-` background signal survives. Context rows tint in full.
- Single-line annotations get the same treatment with `range = 1` row — no special case.
- Layout-independent: gutter sits at column 0 in both split and unified. We do not bias the gutter to the matching `side` column in v1 (added complexity, marginal value).
- Reversibility: if user feedback shows long ranges lose track, upgrading to a full bracket apparatus is additive — keep tint + gutter, layer the docked card variant + cap row on top.
