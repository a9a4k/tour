import type { Annotation } from "../core/types.js";
import { theme } from "../core/theme.js";

interface AnnotationCardProps {
  annotation: Annotation;
  isCurrent: boolean;
}

function rangeLabel(ann: Annotation): string {
  return ann.line_start === ann.line_end
    ? String(ann.line_start)
    : `${ann.line_start}-${ann.line_end}`;
}

export function AnnotationCard({ annotation, isCurrent }: AnnotationCardProps) {
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
        <text fg={theme.fg.accent} bold>
          [{annotation.side}] {annotation.file}:{rangeLabel(annotation)} ({annotation.author})
        </text>
      </box>
      <box flexGrow={1}>
        <text fg={theme.fg.default} wrapMode="word">{annotation.body}</text>
      </box>
    </box>
  );
}
