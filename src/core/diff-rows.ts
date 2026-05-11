import type { FileDiffMetadata } from "@pierre/diffs";
import type { Annotation } from "./types.js";
import { buildThreads, topLevelAnnotations } from "./threads.js";
import {
  getBoundary,
  getFileExpanded,
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
  /** Lines still hidden in the gap above this hunk-header (PRD #151, ADR
   *  0018). For `hunkIndex === 0` this is the file-top gap (lines 1 to
   *  first-hunk-start) minus any expansion at boundary `"top"`. For
   *  `hunkIndex > 0` it's the mid-file gap between the previous hunk's
   *  end and this hunk's start, minus expansion at boundary `hunkIndex`.
   *  Drives both the `··· N hidden ···` suffix on the @@ row and the
   *  cursor-walkability rule (interactive iff `gapAbove > 0`). */
  gapAbove: number;
}

export interface AnnotationRow {
  kind: "annotation";
  annotation: Annotation;
  replies: Annotation[];
  id: string;
}

/** An interactive row family the line cursor walks alongside diff rows
 *  (ADR 0013 + ADR 0018). After PRD #151, `boundary-top` is no longer
 *  emitted as a planner row kind — its semantics fold into the first
 *  hunk's `hunk-header` (interactive iff `gapAbove > 0`). The enum
 *  value persists internally because the cursor walker tags promoted
 *  first-hunk hunk-headers with `subKind: "boundary-top"` so dispatch
 *  routes to the file-top reducer path. `gap-mid-top` is emitted only
 *  when a mid-file gap exceeds `2N` (= 40), giving large gaps two cursor
 *  stops (one for each end). `boundary-bottom` continues to be emitted
 *  standalone — git has no hunk-footer to fold into. boundaryRef is
 *  opaque to the cursor: numeric for `hunk-separator` and `gap-mid-top`
 *  (the hunk-index whose gap-above this row addresses), `"top"` /
 *  `"bottom"` for file boundaries, `"top"` for collapsed-file rows. */
export type InteractiveSubKind =
  | "hunk-separator"
  | "gap-mid-top"
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
  /** Lines hidden in the gap this row addresses. Set on `gap-mid-top`
   *  (= remaining mid-file gap above the next hunk) and `boundary-bottom`
   *  (= remaining file-bottom gap). Lets consumers (e.g. webapp gap-row
   *  overlay shift-click) compute the full-gap expansion count directly
   *  instead of passing a large sentinel and relying on receiver-side
   *  clamping. */
  gapAbove?: number;
}

export interface PlanRowsOptions {
  oldContent?: string;
  newContent?: string;
  expansion?: ExpansionState;
  /** When `true`, the planner emits a single synthetic `collapsed-file`
   *  interactive row in place of the file's diff body unless
   *  `expansion[file].fileExpanded` is set (PRD #108 issue #113). The App
   *  layer combines its classifier flags + user-toggle state into this
   *  single boolean so the planner stays a pure mapping. */
  classifierCollapsed?: boolean;
}

export function planRows(
  file: FileDiffMetadata,
  annotations: Annotation[],
  layout: "split" | "unified",
  options: PlanRowsOptions = {},
): PlannedRow[] {
  if (options.classifierCollapsed) {
    const fileExpanded = options.expansion
      ? getFileExpanded(options.expansion, file.name)
      : false;
    if (!fileExpanded) {
      return [collapsedFileRow(file)];
    }
  }
  const diffRows = walkHunks(file, layout, options);
  applyAnnotationFlags(diffRows, annotations, layout);
  return interleaveAnnotations(diffRows, annotations);
}

function collapsedFileRow(file: FileDiffMetadata): InteractiveRow {
  const hidden = file.hunks.reduce(
    (sum, h) => sum + h.additionCount + h.deletionCount,
    0,
  );
  return {
    kind: "interactive",
    subKind: "collapsed-file",
    boundaryRef: "top",
    text: `··· ${hidden} lines hidden — Enter to expand ···`,
  };
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

/** Hidden-line gap above `hunks[hunkIndex]`. For hunk 0 this is the file-top
 *  gap (lines 1 to first-hunk-start); for hunk i > 0 it's the mid-file gap
 *  between the previous hunk's end and this hunk's start. The "prev end"
 *  fields are 0 for hunk 0 so callers can use `prevAdditionEnd + 1` as the
 *  first hidden line on either side uniformly. */
function gapBefore(file: FileDiffMetadata, hunkIndex: number): {
  size: number;
  prevAdditionEnd: number;
  prevDeletionEnd: number;
} {
  const next = file.hunks[hunkIndex];
  if (hunkIndex === 0) {
    return {
      size: Math.max(0, next.additionStart - 1),
      prevAdditionEnd: 0,
      prevDeletionEnd: 0,
    };
  }
  const prev = file.hunks[hunkIndex - 1];
  const prevAdditionEnd = prev.additionStart + prev.additionCount - 1;
  const prevDeletionEnd = prev.deletionStart + prev.deletionCount - 1;
  return {
    size: Math.max(0, next.additionStart - prevAdditionEnd - 1),
    prevAdditionEnd,
    prevDeletionEnd,
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

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const hunk = file.hunks[hunkIndex];
    const isFirst = hunkIndex === 0;
    // First-hunk reads file-top expansion (BoundaryRef='top'); mid-file
    // hunks read the per-separator expansion at boundary=hunkIndex. PRD
    // #151 asymmetric merge: file-top is reached through hunk 0's
    // hunk-header (no standalone boundary-top row).
    const sep = expansionFor(options, file.name, isFirst ? "top" : hunkIndex);
    const gap = gapBefore(file, hunkIndex);
    const gapAbove = Math.max(0, gap.size - sep.up - sep.down);

    // Up-side context rows: lines just after the previous hunk's end (or
    // from line 1 for the first hunk).
    if (sep.up > 0) {
      emitContextRowsByLineNumber(
        rows,
        oldContent,
        newContent,
        gap.prevAdditionEnd + 1,
        gap.prevDeletionEnd + 1,
        sep.up,
      );
    }

    // gap-mid-top: emitted ONLY for mid-file gaps whose remaining hidden
    // count exceeds 2N (= 40). File-edges have a single meaningful
    // direction (toward file start / end), so the two-row split would be
    // pointless (ADR 0018).
    if (!isFirst && gapAbove > GAP_TWO_ROW_THRESHOLD) {
      rows.push({
        kind: "interactive",
        subKind: "gap-mid-top",
        boundaryRef: hunkIndex,
        text: gapMidTopText(gapAbove),
        gapAbove,
      });
    }

    rows.push({
      kind: "hunk-header",
      header: hunk.hunkSpecs ?? "",
      hunkIndex,
      gapAbove,
    });

    // Down-side context rows: lines just before this hunk's start.
    if (sep.down > 0) {
      emitContextRowsByLineNumber(
        rows,
        oldContent,
        newContent,
        hunk.additionStart - sep.down,
        hunk.deletionStart - sep.down,
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
      // Suppress when remaining === 0 (issue #160): unlike `hunk-header`,
      // `boundary-bottom` carries no @@ metadata — it's a pure affordance row.
      // Once Pierre has fully revealed the file-bottom gap, leaving the row
      // visible with "0 hidden" would be a cursor trap (each Enter / click is
      // a no-op).
      if (remaining > 0) {
        rows.push({
          kind: "interactive",
          subKind: "boundary-bottom",
          boundaryRef: "bottom",
          text: boundaryBottomText(remaining),
          gapAbove: remaining,
        });
      }
    }
  }

  return rows;
}

function boundaryBottomText(remaining: number): string {
  return `··· ${remaining} lines hidden below ···`;
}

function gapMidTopText(remaining: number): string {
  // ↑ glyph per D1 (row position == end of gap, ADR 0018): pressing
  // Enter reveals lines above the row — toward the previous hunk's end.
  return `↑ ··· ${remaining} lines hidden ···`;
}

/** Per-direction expansion step (N). The two-row threshold is 2N. Matches
 *  Pierre's `expansionLineCount: 20` and the TUI's prior symmetric-20
 *  semantics (ADR 0018). Exported so the TUI dispatch + render layers
 *  pick their direction glyph / Enter-direction from the same constant. */
export const GAP_TWO_ROW_THRESHOLD = 40;

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
