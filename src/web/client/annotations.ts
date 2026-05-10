import { theme } from "../../core/theme.js";
import { isTopLevel, topLevelAnnotations } from "../../core/threads.js";
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
 *
 * Replies are filtered out: they inherit the parent's anchor and render
 * nested inside the root annotation's card, so emitting Pierre entries for
 * them would produce a duplicate card at the same line.
 */
export function toPierreLineAnnotations(annotations: Annotation[], file: string): PierreLineAnnotation[] {
  const result: PierreLineAnnotation[] = [];
  for (const ann of annotations) {
    if (ann.file !== file) continue;
    if (!isTopLevel(ann)) continue;
    for (let line = ann.line_start; line <= ann.line_end; line++) {
      result.push({
        side: ann.side,
        lineNumber: line,
        metadata: {
          kind: "annotation",
          annotation: ann,
          isAnchor: line === ann.line_end,
        },
      });
    }
  }
  return result;
}

const RANGE_TINT = theme.bg.accentRange.web;
const RANGE_ACCENT = theme.fg.accent;

/**
 * Build a CSS string targeting Pierre's per-line `[data-line]` markers for
 * every line in every annotation range, painting two cues over each
 * annotated row: the subtle blue tint as the row background, plus a 3px
 * accent-coloured gutter stripe at the left edge — matching the
 * annotation card's accent border so card and range read as one
 * column-aligned bracket (ADR 0008's two-cue rule). Tint and accent are
 * sourced from the shared theme module so TUI and SPA stay in lockstep.
 *
 * Single- and multi-line ranges are treated identically. Pierre's
 * `lineAnnotations` injects a gutter buffer + a `[data-line-annotation]`
 * row beneath the anchor (the card body) but paints no marker on the
 * anchor `[data-line]` row itself, so we own the row-edge cue uniformly.
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
    if (!isTopLevel(ann)) continue;
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
 * Resolve the sequence cursor to an index in the current top-level
 * annotations list, anchored by id. n/p navigates top-level Annotations only
 * (Replies are not navigation targets), so the cursor index is in
 * `topLevelAnnotations(annotations)` rather than the raw list.
 *
 * - Empty top-level list: -1 (no cursor).
 * - prevId is null (initial state): 0.
 * - prevId still present at top level: its new index.
 * - prevId no longer present at top level: 0 (sensible default).
 */
export function resolveCursorById(annotations: Annotation[], prevId: string | null): number {
  const tops = topLevelAnnotations(annotations);
  if (tops.length === 0) return -1;
  if (prevId === null) return 0;
  const idx = tops.findIndex((a) => a.id === prevId);
  return idx === -1 ? 0 : idx;
}
