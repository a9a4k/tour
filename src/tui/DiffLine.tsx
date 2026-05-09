import type { SyntaxStyle } from "@opentui/core";

export const TINT_BG = "#1e2a44";
export const ACCENT_FG = "#58a6ff";
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
    <box flexDirection="row" width={width} minHeight={1}>
      <text fg={ACCENT_FG}>{gutterAccent ? GUTTER_CHAR : " "}</text>
      <text bg={gutterBg}>{gutter}</text>
      {showCode ? (
        <code
          content={text}
          filetype={filetype}
          syntaxStyle={syntaxStyle}
          bg={contentBg}
          drawUnstyledText
          wrapMode="word"
          flexGrow={1}
          width="100%"
        />
      ) : (
        <text bg={contentBg} wrapMode="word" flexGrow={1}>
          {text}
        </text>
      )}
    </box>
  );
}
