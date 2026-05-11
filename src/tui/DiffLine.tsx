import type { SyntaxStyle } from "@opentui/core";
import { theme } from "../core/theme.js";

export const TINT_BG = theme.bg.accentRange.tui;
export const ACCENT_FG = theme.fg.accent;
export const CURSOR_FG = theme.fg.cursor;
export const CURSOR_ROW_BG = theme.bg.cursorRow.tui;
export const GUTTER_CHAR = "▎";
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
  // Diff +/- row bg (issue #74). When set, paints a subtle add/del bg under
  // both the gutter and content cells. Annotation tint composes on top per
  // ADR 0008: on +/- rows the gutter tint wins (caller passes
  // contentTinted=false so the diff bg shows on content); on context rows
  // diffBg is undefined so the annotation tint paints both cells.
  diffBg?: "addition" | "deletion";
  // Line cursor (ADR 0011). When true, both the gutter cell and the
  // content cell paint theme.bg.cursorRow (winning over annotation tint
  // and diff bg per the composition rule), and a leading `❯` glyph in
  // theme.fg.cursor renders in the line-number column. The full-row fill
  // is the TUI-native analogue of the web's outlined-row focus — terminals
  // can't do outlines without taking extra rows, so we use a solid fill.
  cursorActive?: boolean;
  filetype: string | undefined;
  syntaxStyle: SyntaxStyle;
  width: string | number;
}

function diffBgColor(kind: "addition" | "deletion" | undefined): string | undefined {
  if (kind === "addition") return theme.bg.successRange.tui;
  if (kind === "deletion") return theme.bg.dangerRange.tui;
  return undefined;
}

export function DiffLine({
  gutter,
  text,
  gutterTinted,
  contentTinted,
  gutterAccent,
  diffBg,
  cursorActive,
  filetype,
  syntaxStyle,
  width,
}: DiffLineProps) {
  const diffColor = diffBgColor(diffBg);
  // Composition rule (ADR 0011): cursor bg > annotation tint > +/- bg.
  // Cursor bg fills both gutter and content so the active row reads as a
  // single solid plate — the terminal-native equivalent of the web's
  // outlined row.
  const gutterBg = cursorActive
    ? CURSOR_ROW_BG
    : gutterTinted
      ? TINT_BG
      : diffColor;
  const contentBg = cursorActive
    ? CURSOR_ROW_BG
    : contentTinted
      ? TINT_BG
      : diffColor;
  const showCode = !!filetype && text.length > 0;
  // Drop one leading char so the total gutter width is preserved when the
  // cursor glyph rides in front of the line number.
  const gutterText = cursorActive && gutter.length > 0 ? gutter.slice(1) : gutter;

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
      <box
        width={1}
        alignSelf="stretch"
        flexShrink={0}
        backgroundColor={gutterAccent ? ACCENT_FG : undefined}
      />
      <box
        alignSelf="stretch"
        flexShrink={0}
        flexDirection="row"
        backgroundColor={gutterBg}
      >
        {cursorActive && (
          <text height={1} flexShrink={0} fg={CURSOR_FG}>{CURSOR_GLYPH}</text>
        )}
        <text height={1} flexShrink={0}>{gutterText}</text>
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
        <box flexGrow={1} minHeight={1} backgroundColor={contentBg}>
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
        // glyph cells. Matters for the empty side of pure +/- rows in split.
        <box flexGrow={1} minHeight={1} backgroundColor={contentBg}>
          <text wrapMode="word">{text}</text>
        </box>
      )}
    </box>
  );
}
