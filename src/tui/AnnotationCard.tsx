import type { Annotation, AuthorKind } from "../core/types.js";
import { theme } from "../core/theme.js";

interface AnnotationCardProps {
  annotation: Annotation;
  isCurrent: boolean;
  replies?: Annotation[];
  repliesCollapsed?: boolean;
}

function rangeLabel(ann: Annotation): string {
  return ann.line_start === ann.line_end
    ? String(ann.line_start)
    : `${ann.line_start}-${ann.line_end}`;
}

// Author-kind cue: human entries paint accent; agent entries stay muted. Same
// rule on both surfaces (see webapp `.author-kind.human`/`.author-kind.agent`)
// so the conversation reads identically across TUI and SPA.
function authorKindColor(kind: AuthorKind): string {
  return kind === "human" ? theme.fg.accent : theme.fg.muted;
}

export function AnnotationCard({
  annotation,
  isCurrent,
  replies,
  repliesCollapsed,
}: AnnotationCardProps) {
  const visibleReplies = repliesCollapsed ? [] : replies ?? [];
  const hiddenCount = repliesCollapsed ? replies?.length ?? 0 : 0;
  return (
    <box
      id={`annotation-${annotation.id}`}
      borderStyle="single"
      borderColor={theme.fg.accent}
      backgroundColor={isCurrent ? theme.bg.accentCurrent.tui : undefined}
      flexDirection="column"
      paddingX={1}
    >
      <box>
        <text fg={authorKindColor(annotation.author_kind)} bold>
          {`[${annotation.author_kind}] `}
        </text>
        <text fg={theme.fg.accent} bold>
          [{annotation.side}] {annotation.file}:{rangeLabel(annotation)} ({annotation.author})
        </text>
      </box>
      <box flexGrow={1}>
        <text fg={theme.fg.default} wrapMode="word">{annotation.body}</text>
      </box>
      {visibleReplies.map((r) => (
        <box
          key={r.id}
          id={`annotation-${r.id}`}
          flexDirection="column"
          marginTop={1}
          paddingLeft={2}
        >
          <box>
            <text fg={authorKindColor(r.author_kind)} bold>
              {`[${r.author_kind}] `}
            </text>
            <text fg={theme.fg.muted}>{`(${r.author})`}</text>
          </box>
          <text fg={theme.fg.default} wrapMode="word">{r.body}</text>
        </box>
      ))}
      {hiddenCount > 0 && (
        <box marginTop={1} paddingLeft={2}>
          <text fg={theme.fg.muted}>
            {`[${hiddenCount} ${hiddenCount === 1 ? "reply" : "replies"} collapsed — c to expand]`}
          </text>
        </box>
      )}
    </box>
  );
}
