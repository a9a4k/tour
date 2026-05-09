# TUI annotation visual treatment: row tint + gutter mark

The webapp marks an annotation's range with a CSS background tint over `[data-line]` rows in `[line_start, line_end]` and renders the annotation card directly below `line_end`. The TUI needs a medium-appropriate equivalent. Pure tint is single-cue (fails the accessibility "two cues" rule, weakest Gestalt grouping) and competes with the diff `+/-` background colours. Hunk's docking-bracket apparatus is the strongest grouping signal but is bespoke (no other terminal tool uses it), costs ~250 LOC of geometry, and is awkward in unified layout. We pick the middle path: a row background tint **plus** a single accent-coloured gutter character per range row, with the annotation card rendered directly below `line_end` and bordered in the same accent — connecting card and range via shared colour rather than literal box-drawing brackets.

## Considered Options

- **Tint only** (mirror webapp exactly). Rejected: single-cue, fails the [Section 508 / accessibility "two cues" rule](https://www.section508.gov/create/making-color-usage-accessible/), weakest Gestalt grouping (similarity), and competes with the existing diff `+/-` row backgrounds — a tinted `+` row reads as a third colour cocktail rather than "this row is annotated".
- **Hunk's docking-bracket apparatus** (vertical guide column + tee transition + cap row, with the note card docked half-width into the side matching `anchorSide`). Rejected: bespoke pattern with no precedent in vim, magit, lazygit, vscode, or other terminal review tools; ~250 LOC of geometry (note-height measurement, dock-width math, cap placement); awkward in unified layout where there is no side column; marginal value over tint+gutter for the same Gestalt outcome.
- **Gutter mark only.** Rejected: loses the common-region grouping the webapp users already understand, and breaks visual parity across surfaces.

## Consequences

- Two cues (colour + character) make the treatment robust under colour blindness, low-colour terminals, and high-glare environments. Either signal alone communicates "this row is annotated".
- The pattern aligns with the established terminal idiom (vim sign column, magit overlay marks, vscode-git gutter bars) — familiar to terminal users from outside Tour.
- Webapp parity is preserved on the tint axis. The gutter is the medium-appropriate second cue, not a divergence in meaning.
- For `+`/`-` rows, the range tint applies only to the line-number column (not the full row), so the diff `+/-` background signal survives. Context rows tint in full.
- Single-line annotations get the same treatment with `range = 1` row — no special case.
- Layout-independent: gutter sits at column 0 in both split and unified. We do not bias the gutter to the matching `side` column in v1 (added complexity, marginal value).
- Reversibility: if user feedback shows long ranges lose track, upgrading to a full bracket apparatus is additive — keep tint + gutter, layer the docked card variant + cap row on top.
