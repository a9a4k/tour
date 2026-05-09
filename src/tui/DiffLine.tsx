import type { SyntaxStyle } from "@opentui/core";
import { theme } from "../core/theme.js";

export const TINT_BG = theme.bg.accentRange.tui;
export const ACCENT_FG = theme.fg.accent;
export const GUTTER_CHAR = "▎";

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
  filetype: string | undefined;
  syntaxStyle: SyntaxStyle;
  width: string | number;
}

export function DiffLine({
  gutter,
  text,
  gutterTinted,
  contentTinted,
  gutterAccent,
  filetype,
  syntaxStyle,
  width,
}: DiffLineProps) {
  const gutterBg = gutterTinted ? TINT_BG : undefined;
  const contentBg = contentTinted ? TINT_BG : undefined;
  const showCode = !!filetype && text.length > 0;

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
      <box alignSelf="stretch" flexShrink={0} backgroundColor={gutterBg}>
        <text height={1} flexShrink={0}>{gutter}</text>
      </box>
      {showCode ? (
        // <code> as a direct flex child reports a measure that includes a
        // phantom extra row, doubling the diff row's terminal height. Wrap
        // it in a <box> so flex sizing comes from the box and <code> just
        // fills it. Same pattern as anomalyco/opentui#621's
        // DiffLineRenderable._contentBox.
        <box flexGrow={1} minHeight={1}>
          <code
            content={text}
            filetype={filetype}
            syntaxStyle={syntaxStyle}
            bg={contentBg}
            drawUnstyledText
            wrapMode="word"
            width="100%"
          />
        </box>
      ) : (
        <text bg={contentBg} wrapMode="word" flexGrow={1}>
          {text}
        </text>
      )}
    </box>
  );
}
