import type { Annotation, AnnotationMetadata } from "./types.js";

export interface PierreLineAnnotation {
  side: "additions" | "deletions";
  lineNumber: number;
  metadata: AnnotationMetadata;
}

/**
 * Map source annotations to Pierre's DiffLineAnnotation shape. A multi-line
 * annotation expands into one entry per line in the range, all carrying the
 * same Annotation in metadata. Only the entry at line_end is the "anchor" —
 * matching GitHub's pattern where the comment thread reads as a conclusion
 * below the discussed code. renderAnnotation uses this flag to render the
 * body once; non-anchor entries leave only the gutter indicator on every
 * line in the range.
 */
export function toPierreLineAnnotations(annotations: Annotation[], file: string): PierreLineAnnotation[] {
  const result: PierreLineAnnotation[] = [];
  for (const ann of annotations) {
    if (ann.file !== file) continue;
    for (let line = ann.line_start; line <= ann.line_end; line++) {
      result.push({
        side: ann.side,
        lineNumber: line,
        metadata: { annotation: ann, isAnchor: line === ann.line_end },
      });
    }
  }
  return result;
}

const RANGE_TINT = "rgba(88, 166, 255, 0.12)";
const RANGE_ACCENT = "#58a6ff";

/**
 * Build a CSS string targeting Pierre's per-line `[data-line]` markers for
 * every line in every multi-line annotation range, painting two cues over
 * each annotated row: the existing subtle blue tint as the row background,
 * plus a 3px accent-coloured gutter stripe at the left edge — matching the
 * annotation card's `border-left: 3px solid #58a6ff` so card and range
 * read as one column-aligned bracket (ADR 0008's two-cue rule).
 *
 * Single-line annotations are skipped: Pierre's built-in `lineAnnotations`
 * already paints its own gutter marker for the anchor row, and stacking
 * our 3px stripe on top would visually double up. Multi-line ranges have
 * no such built-in marker on the non-anchor rows, so they need both cues.
 *
 * Pierre renders each diff inside a shadow root, so this CSS must be
 * injected via the FileDiff `unsafeCSS` option (which Pierre slots into
 * its `@layer unsafe`, the highest-priority cascade layer).
 */
export function buildRangeBackgroundCSS(annotations: Annotation[], file: string): string {
  const additionLines = new Set<number>();
  const deletionLines = new Set<number>();
  for (const ann of annotations) {
    if (ann.file !== file) continue;
    if (ann.line_start === ann.line_end) continue;
    const target = ann.side === "additions" ? additionLines : deletionLines;
    for (let line = ann.line_start; line <= ann.line_end; line++) target.add(line);
  }
  const rules: string[] = [];
  if (additionLines.size > 0) {
    rules.push(rangeRule(additionLines, ["addition", "change-addition"]));
  }
  if (deletionLines.size > 0) {
    rules.push(rangeRule(deletionLines, ["deletion", "change-deletion"]));
  }
  return rules.join("\n");
}

function rangeRule(lines: Set<number>, types: string[]): string {
  const lineSel = [...lines].sort((a, b) => a - b).map((n) => `[data-line="${n}"]`).join(", ");
  const typeSel = types.map((t) => `[data-line-type="${t}"]`).join(", ");
  return `:is(${lineSel}):is(${typeSel}) { background-image: linear-gradient(${RANGE_TINT}, ${RANGE_TINT}); box-shadow: inset 3px 0 0 ${RANGE_ACCENT}; }`;
}

/**
 * Resolve the sequence cursor to an index in the current annotations list,
 * anchored by id. The reviewer's cursor is the *annotation* they're reading,
 * not its position — when the agent appends or removes entries, we re-locate
 * the same id rather than blindly preserving the index.
 *
 * - Empty list: -1 (no cursor).
 * - prevId is null (initial state): 0.
 * - prevId still present: its new index.
 * - prevId no longer present: 0 (sensible default rather than getting stuck).
 */
export function resolveCursorById(annotations: Annotation[], prevId: string | null): number {
  if (annotations.length === 0) return -1;
  if (prevId === null) return 0;
  const idx = annotations.findIndex((a) => a.id === prevId);
  return idx === -1 ? 0 : idx;
}
