import type { SyntaxStyle } from "@opentui/core";
import { theme } from "../core/theme.js";

// Annotation accent stripe — 128 repeats of ▌ (U+258C LEFT HALF BLOCK)
// separated by newlines. The accent column's wrapper is `alignSelf="stretch"`
// (height = row's wrapped height) and `overflow="hidden"` (clips painted
// overflow). The glyph `<text>` is `position="absolute"` so its 128-row
// intrinsic content height does NOT propagate up: without that, every row
// would stretch to 128 cells tall (prototype 2026-05-14). The result is a
// half-cell-wide vertical rule in `theme.fg.accent` that follows the
// wrapped row height through any realistic wrap depth (128 visual rows
// covers ~10× the worst real-world line wrap; bump if a 1024-char minified
// line on a 20-col viewport ever shows up).
//
// DO NOT "improve" this back to a `backgroundColor` paint on the wrapper:
// that delivered a full-cell-wide stripe and the read of the stripe as
// thicker-than-necessary was the bug this fix addresses. Prototype A
// (full-cell bg) lost to prototype C (this shape) on read at the same
// width-1 layout footprint.
//
// DO NOT remove the `position="absolute"`: without it the 128-row glyph
// stack drives the row's intrinsic height to 128 cells regardless of the
// content's real wrap depth.
const ACCENT_STRIPE_GLYPHS = Array.from({ length: 128 }, () => "▌").join("\n");

export const TINT_BG = theme.bg.accentRange.tui;
export const ACCENT_FG = theme.fg.accent;
export const CURSOR_FG = theme.fg.cursor;
export const CURSOR_ROW_BG = theme.bg.cursorRow.tui;
// Issue #305: parked-cursor bg used when the diff pane is unfocused.
// Dimmer than CURSOR_ROW_BG so the focused pane's cursor reads as the
// single "live" cursor; the parked one stays visible as a place-marker.
export const CURSOR_ROW_PARKED_BG = theme.bg.accentCursor.tui;
export const CURSOR_GLYPH = "❯";

interface DiffLineProps {
  // Pre-formatted gutter text (line numbers + sign + trailing space).
  // Caller decides exact format (one column for split, two for unified).
  gutter: string;
  // Empty string when this side has no content (e.g. left side of a pure
  // addition row in split view). Code highlighting is skipped in that case.
  text: string;
  // Annotation tint cues (ADR 0008). Gutter tints whenever the row falls
  // inside an annotation range; content only tints on context-paired rows
  // so the diff +/- signal survives on change rows.
  gutterTinted: boolean;
  contentTinted: boolean;
  gutterAccent: boolean;
  // Diff +/- row bg (issue #74; two-tone since #262). When set, paints
  // two tones: the brighter `*Range.tui` rail on the gutter cell and the
  // softer `*Cell.tui` wash on the content cell. The bright rail anchors
  // the vertical scan; the softer wash keeps syntax-highlighted tokens
  // readable. Mirrors webapp #221 (introduced two-tone) + #247 (flipped
  // direction to bright-rail / soft-code). Annotation tint composes on
  // top per ADR 0008: on +/- rows the gutter tint wins (caller passes
  // contentTinted=false so the soft diff cell bg shows on content); on
  // context rows diffBg is undefined so the annotation tint paints both
  // cells.
  diffBg?: "addition" | "deletion";
  // Line cursor (ADR 0011). When true, both the gutter cell and the
  // content cell paint theme.bg.cursorRow (winning over annotation tint
  // and diff bg per the composition rule), and a leading `❯` glyph in
  // theme.fg.cursor renders in the line-number column. The full-row fill
  // is the TUI-native analogue of the web's outlined-row focus — terminals
  // can't do outlines without taking extra rows, so we use a solid fill.
  cursorActive?: boolean;
  // Issue #305: focus-aware cursor. When the diff pane is focused (default)
  // the cursored row paints the bright `cursorRow.tui` plate + ❯ glyph;
  // when the diff pane is unfocused (sidebar holds focus) the cursored row
  // dims to `accentCursor.tui` and the glyph is suppressed so the gutter
  // width does not shift across focus transitions. Defaults to `true` so
  // pre-#305 callers (and most tests) get the historic bright treatment.
  paneFocused?: boolean;
  filetype: string | undefined;
  syntaxStyle: SyntaxStyle;
  // Hunk-header / metadata text (issue #259). When true, skip the
  // <code> syntax-highlight branch regardless of filetype and paint
  // the plain <text> in theme.fg.muted. GitHub renders the entire
  // `@@ ... @@ <function-context>` line in continuous fg.muted grey —
  // the banner is metadata, not code, and the syntax pipeline would
  // otherwise paint keywords in the function-context tail (e.g.
  // `import` red, `function` red) breaking the muted continuity.
  mutedText?: boolean;
  // Empty side of a single-side split-layout row (issue #260). When
  // true, paint both gutter and content cells in theme.canvas.inset so
  // the empty side recedes below canvas — parity with webapp #227. The
  // active side renders untouched; cursor + annotation range tint still
  // win when they apply (the empty side never carries either on
  // single-side rows, so they are mutually exclusive in practice).
  emptySide?: boolean;
  width: string | number;
}

interface DiffBgTones {
  gutter: string | undefined;
  content: string | undefined;
}

function diffBgTones(kind: "addition" | "deletion" | undefined): DiffBgTones {
  if (kind === "addition") {
    return { gutter: theme.bg.successRange.tui, content: theme.bg.successCell.tui };
  }
  if (kind === "deletion") {
    return { gutter: theme.bg.dangerRange.tui, content: theme.bg.dangerCell.tui };
  }
  return { gutter: undefined, content: undefined };
}

export function DiffLine({
  gutter,
  text,
  gutterTinted,
  contentTinted,
  gutterAccent,
  diffBg,
  cursorActive,
  paneFocused = true,
  filetype,
  syntaxStyle,
  mutedText,
  emptySide,
  width,
}: DiffLineProps) {
  const diffTones = diffBgTones(diffBg);
  const emptySideBg = emptySide ? theme.canvas.inset : undefined;
  // Issue #305: focused vs parked cursor bg. Focused diff pane → bright
  // `cursorRow.tui` plate + glyph (existing ADR 0011 treatment); unfocused
  // diff pane → dim `accentCursor.tui` plate + no glyph so the gutter
  // width does not shift on focus change.
  const cursorBg = paneFocused ? CURSOR_ROW_BG : CURSOR_ROW_PARKED_BG;
  const showCursorGlyph = cursorActive && paneFocused;
  // Composition rule (ADR 0011 + #260 + #262): cursor bg > annotation
  // tint > +/- bg (two-tone: bright rail on gutter, soft wash on content)
  // > empty-side neutral fill. Cursor bg fills both gutter and content so
  // the active row reads as a single solid plate — the terminal-native
  // equivalent of the web's outlined row. The empty-side fill sits at the
  // bottom of the stack; it only paints when no other layer claims the
  // cell, which on a single-side row's blank half is always (no cursor /
  // no range / no diff bg apply).
  const gutterBg = cursorActive
    ? cursorBg
    : gutterTinted
      ? TINT_BG
      : (diffTones.gutter ?? emptySideBg);
  const contentBg = cursorActive
    ? cursorBg
    : contentTinted
      ? TINT_BG
      : (diffTones.content ?? emptySideBg);
  const showCode = !!filetype && text.length > 0 && !mutedText;
  // Drop one leading char so the total gutter width is preserved when the
  // cursor glyph rides in front of the line number. When the glyph is
  // suppressed (issue #305: parked cursor in the unfocused pane) we keep
  // the full gutter so line numbers / sign columns do not shift.
  const gutterText = showCursorGlyph && gutter.length > 0 ? gutter.slice(1) : gutter;
  // Issue #268 — context rows mute the gutter line-number + sign cell
  // so the bright-on-tinted contrast emerges naturally. Tinted rows
  // (addition / deletion) keep fg.default so numbers stay readable
  // against the bright *Range.tui rail. Cursor glyph (CURSOR_FG) is
  // independent — handled on its own <text> below.
  const gutterFg = diffBg ? theme.fg.default : theme.fg.muted;

  return (
    // alignItems="flex-start" pins the line-number text to visual-line 1 when
    // the content cell wraps to multiple visual lines (commit 7ee3e85). The
    // accent stripe and gutter-tint background must escape that pin and
    // extend down through the wraps — they're row-edge cues, not anchored
    // text. Each is wrapped in its own 1-cell-or-content-wide <box> with
    // alignSelf="stretch" overriding the parent's flex-start, so the box
    // grows to the row's full visual height and paints its bg across every
    // wrapped line. The line-number <text> stays height={1} inside its
    // wrapper so the anchor behavior holds. ADR 0008's continuous accent +
    // ADR 0009's wrapped-row anchor coexist this way.
    <box flexDirection="row" width={width} minHeight={1} alignItems="flex-start">
      <box width={1} alignSelf="stretch" flexShrink={0} overflow="hidden">
        {gutterAccent && (
          <text position="absolute" fg={ACCENT_FG}>
            {ACCENT_STRIPE_GLYPHS}
          </text>
        )}
      </box>
      <box
        alignSelf="stretch"
        flexShrink={0}
        flexDirection="row"
        backgroundColor={gutterBg}
      >
        {showCursorGlyph && (
          <text height={1} flexShrink={0} fg={CURSOR_FG}>{CURSOR_GLYPH}</text>
        )}
        <text height={1} flexShrink={0} fg={gutterFg}>{gutterText}</text>
      </box>
      {showCode ? (
        // <code> as a direct flex child reports a measure that includes a
        // phantom extra row, doubling the diff row's terminal height. Wrap
        // it in a <box> so flex sizing comes from the box and <code> just
        // fills it. Same pattern as anomalyco/opentui#621's
        // DiffLineRenderable._contentBox.
        // bg lives on the wrapper, not <code>: <code> only paints behind
        // characters, so a bg passed to it leaves the trailing whitespace
        // unhighlighted. Painting on the flex-grown box fills the full row.
        // alignSelf="stretch" escapes the parent's `alignItems="flex-start"`
        // so the content cell extends to the row's full wrapped height when
        // the SIBLING half drives the wrap — without it, the empty-side
        // / context-paired / annotation-tinted content cell stayed 1 row
        // tall, leaving the wrap-continuation rows unpainted and showing
        // the terminal canvas as visible stripes through the empty-side
        // inset fill, the annotation tint, and the diff +/- bg. Sibling
        // fix to #267 (which stretched the wrapper one level up).
        <box flexGrow={1} minHeight={1} alignSelf="stretch" backgroundColor={contentBg}>
          <code
            content={text}
            filetype={filetype}
            syntaxStyle={syntaxStyle}
            drawUnstyledText
            wrapMode="word"
            width="100%"
          />
        </box>
      ) : (
        // Same reason as above: wrap so the bg fills the row, not just the
        // glyph cells. `alignSelf="stretch"` for the same wrap-coverage
        // reason; without it the empty side of pure +/- rows (#260 inset
        // fill) showed a canvas-default stripe on wrap continuations.
        <box flexGrow={1} minHeight={1} alignSelf="stretch" backgroundColor={contentBg}>
          <text wrapMode="word" fg={mutedText ? theme.fg.muted : undefined}>{text}</text>
        </box>
      )}
    </box>
  );
}
