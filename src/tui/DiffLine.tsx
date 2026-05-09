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
    // alignItems="flex-start" + explicit height={1} on the gutter siblings
    // anchors them to the top of the row when the content cell wraps to
    // multiple visual lines. Without these, Yoga's default
    // alignItems="stretch" makes the 1-line gutter <text> grow to the row's
    // full multi-line height and the rendered text drifts off the first
    // visual line — line number ends up next to a wrap continuation instead
    // of the row's start.
    <box flexDirection="row" width={width} minHeight={1} alignItems="flex-start">
      <text fg={ACCENT_FG} height={1} flexShrink={0}>{gutterAccent ? GUTTER_CHAR : " "}</text>
      <text bg={gutterBg} height={1} flexShrink={0}>{gutter}</text>
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
