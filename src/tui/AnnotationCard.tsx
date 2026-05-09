import type { Annotation } from "../core/types.js";
import { ACCENT_FG } from "./DiffRows.js";

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
      borderColor={isCurrent ? "cyan" : ACCENT_FG}
      flexDirection="column"
      paddingX={1}
    >
      <text
        fg={isCurrent ? "black" : ACCENT_FG}
        bg={isCurrent ? "cyan" : undefined}
        bold
      >
        [{annotation.side}] {annotation.file}:{rangeLabel(annotation)} ({annotation.author})
      </text>
      <text fg="white" wrapMode="word">{annotation.body}</text>
    </box>
  );
}
