import type { FileDiffMetadata } from "@pierre/diffs";
import type { Annotation } from "./types.js";
import { buildThreads, topLevelAnnotations } from "./threads.js";
import {
  getBoundary,
  type BoundaryRef as ExpansionBoundaryRef,
  type ExpansionState,
} from "./expansion-state.js";

export type PlannedRow =
  | DiffRow
  | HunkHeaderRow
  | AnnotationRow
  | InteractiveRow;

export interface DiffRow {
  kind: "diff-row";
  type: "context" | "addition" | "deletion" | "change";
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string;
  rightText: string;
  leftTinted?: boolean;
  rightTinted?: boolean;
  leftGutter?: boolean;
  rightGutter?: boolean;
}

export interface HunkHeaderRow {
  kind: "hunk-header";
  header: string;
  hunkIndex: number;
  /** Lines still hidden in the upper portion of the gap above this hunk
   *  (closer to the previous hunk's end). Together with `expandDown` they
   *  feed the `··· N hidden ···` suffix on the hunk-header (PRD #108). */
  expandUp: number;
  /** Lines still hidden in the lower portion of the gap above this hunk
   *  (closer to this hunk's start). */
  expandDown: number;
}

export interface AnnotationRow {
  kind: "annotation";
  annotation: Annotation;
  replies: Annotation[];
  id: string;
}

/** An interactive row family the line cursor walks alongside diff rows
 *  (ADR 0013). Three sub-kinds: hunk-separator gaps between hunks,
 *  synthetic file-top / file-bottom boundaries when a file has Hidden
 *  context at its edges, and the synthetic indicator row a classifier-
 *  collapsed file emits in place of its diff body. boundaryRef is opaque
 *  to the cursor: numeric for hunk-separators (gap index = next hunk's
 *  index), `'top'` / `'bottom'` for file boundaries, `'top'` for
 *  collapsed-file rows. The planner emits the visible content (the
 *  `··· N hidden ···` string etc.); this slice ships only the row
 *  family + cursor routing — actual expansion handlers stub out and are
 *  filled in by PRD #108. */
export type InteractiveSubKind =
  | "hunk-separator"
  | "boundary-top"
  | "boundary-bottom"
  | "collapsed-file";

export type BoundaryRef = number | "top" | "bottom";

export interface InteractiveRow {
  kind: "interactive";
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
  /** Optional human-readable body the planner can fill in (e.g. "··· 12
   *  hidden ···"); the cursor visual works regardless. */
  text?: string;
}

export interface PlanRowsOptions {
  oldContent?: string;
  newContent?: string;
  expansion?: ExpansionState;
}

export function planRows(
  file: FileDiffMetadata,
  annotations: Annotation[],
  layout: "split" | "unified",
  options: PlanRowsOptions = {},
): PlannedRow[] {
  const diffRows = walkHunks(file, layout, options);
  applyAnnotationFlags(diffRows, annotations, layout);
  return interleaveAnnotations(diffRows, annotations);
}

function repliesByRoot(annotations: Annotation[]): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const t of buildThreads(annotations)) {
    out.set(t.root.id, t.replies);
  }
  return out;
}

// @pierre/diffs returns each line in additionLines/deletionLines with its
// trailing "\n" intact. That's fine for HTML rendering (the webapp consumes
// the raw FileDiff), but in OpenTUI a <text> element honours embedded
// newlines and renders an extra empty visual line per row — doubling the
// diff's vertical footprint. Strip the trailing newline at the planner so
// every TUI consumer of PlannedRow gets clean, single-line text.
function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, s.endsWith("\r\n") ? -2 : -1) : s;
}

function splitLines(s: string): string[] {
  if (!s) return [];
  const trimmed = s.endsWith("\n") ? s.slice(0, -1) : s;
  return trimmed === "" ? [] : trimmed.split("\n");
}

function gapBefore(file: FileDiffMetadata, hunkIndex: number): {
  size: number;
  prevAdditionEnd: number;
  prevDeletionEnd: number;
  nextAdditionStart: number;
  nextDeletionStart: number;
} {
  const next = file.hunks[hunkIndex];
  if (hunkIndex === 0) {
    return {
      size: 0,
      prevAdditionEnd: 0,
      prevDeletionEnd: 0,
      nextAdditionStart: next.additionStart,
      nextDeletionStart: next.deletionStart,
    };
  }
  const prev = file.hunks[hunkIndex - 1];
  const prevAdditionEnd = prev.additionStart + prev.additionCount - 1;
  const prevDeletionEnd = prev.deletionStart + prev.deletionCount - 1;
  const size = Math.max(0, next.additionStart - prevAdditionEnd - 1);
  return {
    size,
    prevAdditionEnd,
    prevDeletionEnd,
    nextAdditionStart: next.additionStart,
    nextDeletionStart: next.deletionStart,
  };
}

function expansionFor(
  options: PlanRowsOptions,
  file: string,
  ref: ExpansionBoundaryRef,
): { up: number; down: number } {
  if (!options.expansion) return { up: 0, down: 0 };
  return getBoundary(options.expansion, { file, ref });
}

function emitContextRowsByLineNumber(
  rows: PlannedRow[],
  oldContent: string | undefined,
  newContent: string | undefined,
  fromAdditionLine: number,
  fromDeletionLine: number,
  count: number,
): void {
  if (count <= 0) return;
  const newLines = newContent ? splitLines(newContent) : [];
  const oldLines = oldContent ? splitLines(oldContent) : [];
  for (let i = 0; i < count; i++) {
    const aL = fromAdditionLine + i;
    const dL = fromDeletionLine + i;
    const text = newLines[aL - 1] ?? oldLines[dL - 1] ?? "";
    rows.push({
      kind: "diff-row",
      type: "context",
      leftLineNumber: dL,
      rightLineNumber: aL,
      leftText: text,
      rightText: text,
    });
  }
}

function walkHunks(
  file: FileDiffMetadata,
  layout: "split" | "unified",
  options: PlanRowsOptions,
): PlannedRow[] {
  const rows: PlannedRow[] = [];
  const { oldContent, newContent } = options;
  const newLineCount = newContent !== undefined ? splitLines(newContent).length : 0;

  // boundary-top: file's first hunk doesn't start at line 1.
  if (file.hunks.length > 0 && file.hunks[0].additionStart > 1) {
    const top = expansionFor(options, file.name, "top");
    const gapSize = file.hunks[0].additionStart - 1;
    const remaining = Math.max(0, gapSize - top.up - top.down);
    rows.push({
      kind: "interactive",
      subKind: "boundary-top",
      boundaryRef: "top",
      text: boundaryTopText(remaining),
    });
    if (top.up > 0) {
      emitContextRowsByLineNumber(rows, oldContent, newContent, 1, 1, top.up);
    }
    if (top.down > 0) {
      emitContextRowsByLineNumber(
        rows,
        oldContent,
        newContent,
        file.hunks[0].additionStart - top.down,
        file.hunks[0].deletionStart - top.down,
        top.down,
      );
    }
  }

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const hunk = file.hunks[hunkIndex];
    const gap = gapBefore(file, hunkIndex);
    const sep =
      hunkIndex === 0
        ? { up: 0, down: 0 }
        : expansionFor(options, file.name, hunkIndex);
    const hidden = Math.max(0, gap.size - sep.up - sep.down);
    // Split the remaining hidden count cosmetically across the two sides
    // of the @@ line; the suffix concat (expandUp + expandDown) is what the
    // renderer actually shows. No semantic meaning to the split.
    const expandUp = Math.ceil(hidden / 2);
    const expandDown = hidden - expandUp;

    // Up-side context rows: lines just after the previous hunk's end.
    if (hunkIndex > 0 && sep.up > 0) {
      emitContextRowsByLineNumber(
        rows,
        oldContent,
        newContent,
        gap.prevAdditionEnd + 1,
        gap.prevDeletionEnd + 1,
        sep.up,
      );
    }

    rows.push({
      kind: "hunk-header",
      header: hunk.hunkSpecs ?? "",
      hunkIndex,
      expandUp,
      expandDown,
    });

    // Down-side context rows: lines just before this hunk's start.
    if (hunkIndex > 0 && sep.down > 0) {
      emitContextRowsByLineNumber(
        rows,
        oldContent,
        newContent,
        gap.nextAdditionStart - sep.down,
        gap.nextDeletionStart - sep.down,
        sep.down,
      );
    }

    let leftLine = hunk.deletionStart;
    let rightLine = hunk.additionStart;

    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let i = 0; i < block.lines; i++) {
          const text = stripTrailingNewline(
            file.additionLines[block.additionLineIndex + i] ??
              file.deletionLines[block.deletionLineIndex + i] ??
              "",
          );
          rows.push({
            kind: "diff-row",
            type: "context",
            leftLineNumber: leftLine,
            rightLineNumber: rightLine,
            leftText: text,
            rightText: text,
          });
          leftLine++;
          rightLine++;
        }
      } else {
        if (layout === "split") {
          const max = Math.max(block.deletions, block.additions);
          for (let i = 0; i < max; i++) {
            const isDel = i < block.deletions;
            const isAdd = i < block.additions;
            rows.push({
              kind: "diff-row",
              type: "change",
              leftLineNumber: isDel ? leftLine + i : null,
              rightLineNumber: isAdd ? rightLine + i : null,
              leftText: isDel ? stripTrailingNewline(file.deletionLines[block.deletionLineIndex + i] ?? "") : "",
              rightText: isAdd ? stripTrailingNewline(file.additionLines[block.additionLineIndex + i] ?? "") : "",
            });
          }
        } else {
          for (let i = 0; i < block.deletions; i++) {
            rows.push({
              kind: "diff-row",
              type: "deletion",
              leftLineNumber: leftLine + i,
              rightLineNumber: null,
              leftText: stripTrailingNewline(file.deletionLines[block.deletionLineIndex + i] ?? ""),
              rightText: "",
            });
          }
          for (let i = 0; i < block.additions; i++) {
            rows.push({
              kind: "diff-row",
              type: "addition",
              leftLineNumber: null,
              rightLineNumber: rightLine + i,
              leftText: "",
              rightText: stripTrailingNewline(file.additionLines[block.additionLineIndex + i] ?? ""),
            });
          }
        }
        leftLine += block.deletions;
        rightLine += block.additions;
      }
    }
  }

  // boundary-bottom: file's last hunk doesn't reach EOF on the additions
  // side. Without `newContent` we can't know the file length, so the row
  // is suppressed.
  if (file.hunks.length > 0 && newLineCount > 0) {
    const last = file.hunks[file.hunks.length - 1];
    const lastAdditionEnd = last.additionStart + last.additionCount - 1;
    const lastDeletionEnd = last.deletionStart + last.deletionCount - 1;
    if (lastAdditionEnd < newLineCount) {
      const bot = expansionFor(options, file.name, "bottom");
      const gapSize = newLineCount - lastAdditionEnd;
      const remaining = Math.max(0, gapSize - bot.up - bot.down);
      if (bot.up > 0) {
        emitContextRowsByLineNumber(
          rows,
          oldContent,
          newContent,
          lastAdditionEnd + 1,
          lastDeletionEnd + 1,
          bot.up,
        );
      }
      if (bot.down > 0) {
        emitContextRowsByLineNumber(
          rows,
          oldContent,
          newContent,
          newLineCount - bot.down + 1,
          lastDeletionEnd + (gapSize - bot.down) + 1,
          bot.down,
        );
      }
      rows.push({
        kind: "interactive",
        subKind: "boundary-bottom",
        boundaryRef: "bottom",
        text: boundaryBottomText(remaining),
      });
    }
  }

  return rows;
}

function boundaryTopText(remaining: number): string {
  if (remaining === 0) return "··· 0 hidden above ···";
  return `··· ${remaining} lines hidden above ···`;
}

function boundaryBottomText(remaining: number): string {
  if (remaining === 0) return "··· 0 hidden below ···";
  return `··· ${remaining} lines hidden below ···`;
}

function applyAnnotationFlags(
  rows: PlannedRow[],
  annotations: Annotation[],
  layout: "split" | "unified",
): void {
  if (annotations.length === 0) return;
  for (const ann of annotations) {
    for (const row of rows) {
      if (row.kind !== "diff-row") continue;
      const lineOnAnnSide =
        ann.side === "additions" ? row.rightLineNumber : row.leftLineNumber;
      if (lineOnAnnSide === null) continue;
      if (lineOnAnnSide < ann.line_start || lineOnAnnSide > ann.line_end) continue;
      if (layout === "split" && ann.side === "deletions") {
        row.leftTinted = true;
        row.leftGutter = true;
      } else {
        row.rightTinted = true;
        row.rightGutter = true;
      }
    }
  }
}

function interleaveAnnotations(rows: PlannedRow[], annotations: Annotation[]): PlannedRow[] {
  if (annotations.length === 0) return rows;

  // Only top-level annotations get cards; replies render nested inside the
  // root's card. Reply anchors are inherited from the root, so a reply would
  // produce a duplicate card at the same line if interleaved here.
  const tops = topLevelAnnotations(annotations);
  if (tops.length === 0) return rows;

  const replies = repliesByRoot(annotations);

  const sorted = [...tops].sort((a, b) => {
    if (a.created_at < b.created_at) return -1;
    if (a.created_at > b.created_at) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const insertions = new Map<number, Annotation[]>();
  for (const ann of sorted) {
    const idx = findAnchorRowIndex(rows, ann);
    if (idx === -1) continue;
    const list = insertions.get(idx) ?? [];
    list.push(ann);
    insertions.set(idx, list);
  }

  if (insertions.size === 0) return rows;

  const out: PlannedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i]);
    const anns = insertions.get(i);
    if (!anns) continue;
    for (const ann of anns) {
      out.push({
        kind: "annotation",
        annotation: ann,
        replies: replies.get(ann.id) ?? [],
        id: ann.id,
      });
    }
  }
  return out;
}

function findAnchorRowIndex(rows: PlannedRow[], ann: Annotation): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "diff-row") continue;
    if (ann.side === "additions") {
      if (row.rightLineNumber === ann.line_end) return i;
    } else {
      if (row.leftLineNumber === ann.line_end) return i;
    }
  }
  return -1;
}
