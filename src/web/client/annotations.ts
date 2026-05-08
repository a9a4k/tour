import type { Annotation, AnnotationMetadata } from "./types.js";

export interface PierreLineAnnotation {
  side: "additions" | "deletions";
  lineNumber: number;
  metadata: AnnotationMetadata;
}

/**
 * Map source annotations to Pierre's DiffLineAnnotation shape. A multi-line
 * annotation expands into one entry per line in the range, all carrying the
 * same Annotation in metadata. Only the entry at line_start is the "anchor"
 * — renderAnnotation uses this flag to render the body once, while the
 * non-anchor entries leave the gutter indicator for range visualization.
 */
export function toPierreLineAnnotations(annotations: Annotation[], file: string): PierreLineAnnotation[] {
  const result: PierreLineAnnotation[] = [];
  for (const ann of annotations) {
    if (ann.file !== file) continue;
    for (let line = ann.line_start; line <= ann.line_end; line++) {
      result.push({
        side: ann.side,
        lineNumber: line,
        metadata: { annotation: ann, isAnchor: line === ann.line_start },
      });
    }
  }
  return result;
}
