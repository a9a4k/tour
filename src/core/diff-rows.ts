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
  /** Primary expand affordance hosted on the banner's leftmost cell
   *  (issue #280). GitHub's `@@` row is two cells: a ~44px button cell +
   *  the range/context text. `primaryExpand` says which directional
   *  glyph + dispatch the left cell carries — `"up"` reveals upward
   *  (EXPANSION_STEP), `"all"` reveals the entire remaining gap, `null`
   *  paints an inert `…` placeholder (cursor skips the row). When non-
   *  null the row is cursor-walkable via the existing `boundary-top` /
   *  `hunk-separator` interactive subkinds. */
  primaryExpand: "up" | "all" | null;
}

export interface AnnotationRow {
  kind: "annotation";
  annotation: Annotation;
  replies: Annotation[];
  id: string;
}

/** An interactive row family the line cursor walks alongside diff rows
 *  (ADR 0013 + ADR 0018, PRD #270). Issue #280 collapsed the directional
 *  family onto the hunk-header banner's left cell: `expand-up` and
 *  `expand-all` are now hosted on `HunkHeaderRow.primaryExpand` and the
 *  banner is cursor-walkable via the existing `boundary-top` /
 *  `hunk-separator` subkinds. Only `expand-down` survives as a
 *  standalone interactive row — emitted above the hunk-header banner
 *  for mid-file large-gap cases AND for the file-bottom case
 *  (boundaryRef === "bottom"). boundaryRef is opaque to the cursor:
 *  numeric for `hunk-separator` / `expand-down` over a mid-file gap,
 *  `"top"` for file-top boundary-top + collapsed-file rows, `"bottom"`
 *  for file-bottom `expand-down`. */
export type InteractiveSubKind =
  | "hunk-separator"
  | "expand-down"
  | "boundary-top"
  | "collapsed-file";

export type BoundaryRef = number | "top" | "bottom";

export interface InteractiveRow {
  kind: "interactive";
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
  /** Optional human-readable body the planner can fill in (e.g. "··· 12
   *  hidden ···"); the cursor visual works regardless. */
  text?: string;
  /** Lines hidden in the gap this row addresses. Set on `expand-down`
   *  (= remaining gap). Lets consumers compute the full-gap expansion
   *  count directly instead of passing a large sentinel and relying on
   *  receiver-side clamping. */
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
  // Scope to this file before passing on: applyAnnotationFlags and
  // interleaveAnnotations match anchors by `(side, line_end)` only, so an
  // unfiltered list leaks phantom card rows + tint flags into every file
  // whose line range overlaps a foreign annotation's `line_end` (issue #199).
  const fileAnnotations = annotations.filter((a) => a.file === file.name);
  const diffRows = walkHunks(file, layout, options);
  applyAnnotationFlags(diffRows, fileAnnotations, layout);
  return interleaveAnnotations(diffRows, fileAnnotations);
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

    // Issue #280: GitHub's `@@` row is two-cell — the primary expand
    // button (Up / All) lives in the leftmost cell of the hunk-header
    // itself; only the "second" Expand Down for mid-file large gaps is
    // a standalone full-width row above the banner. `hunkHeaderExpandPlan`
    // encodes per-edge × gap-size rules; emit the leading expand-down
    // when the plan requires it, then the hunk-header carrying its
    // primaryExpand affordance.
    const plan = hunkHeaderExpandPlan(gapAbove, isFirst);
    if (plan.emitLeadingExpandDown) {
      rows.push({
        kind: "interactive",
        subKind: "expand-down",
        boundaryRef: hunkIndex,
        text: expandDownRowText(),
        gapAbove,
      });
    }

    rows.push({
      kind: "hunk-header",
      header: hunk.hunkSpecs ?? "",
      hunkIndex,
      gapAbove,
      primaryExpand: plan.primaryExpand,
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

  // File-bottom expand-down: file's last hunk doesn't reach EOF on the
  // additions side. Without `newContent` we can't know the file length,
  // so the row is suppressed.
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
      // file-bottom affordance rows carry no @@ metadata. Once Pierre has
      // fully revealed the file-bottom gap, leaving the row visible
      // would be a cursor trap.
      //
      // Issue #280: GitHub's file-bottom is a standalone TR with a single
      // `[Expand Down][empty]` button — no `Expand All`, no companion
      // up-row (the file's already at EOF). Emit one `expand-down` row
      // regardless of gap size; the reducer clamps the 20-line step
      // against `remaining`.
      if (remaining > 0) {
        rows.push({
          kind: "interactive",
          subKind: "expand-down",
          boundaryRef: "bottom",
          text: expandDownRowText(),
          gapAbove: remaining,
        });
      }
    }
  }

  return rows;
}

/** True iff the file has at least one hidden gap (file-top, mid-file, or
 *  file-bottom) after subtracting current expansion. Issue #297 promotes
 *  this helper to a public export so the TUI's file-header chrome can
 *  decide when to render the `↕` Expand-all affordance from the same
 *  source of truth that gates the affordance's effect — once every gap
 *  is saturated the affordance has nothing to do and disappears. */
export function fileHasHiddenGap(
  file: FileDiffMetadata,
  expansion: ExpansionState | undefined,
  newContent: string | undefined,
): boolean {
  const opts: PlanRowsOptions = { expansion };
  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const isFirst = hunkIndex === 0;
    const sep = expansionFor(opts, file.name, isFirst ? "top" : hunkIndex);
    const gap = gapBefore(file, hunkIndex);
    if (gap.size - sep.up - sep.down > 0) return true;
  }
  const newLineCount = newContent !== undefined ? splitLines(newContent).length : 0;
  if (file.hunks.length > 0 && newLineCount > 0) {
    const last = file.hunks[file.hunks.length - 1];
    const lastAdditionEnd = last.additionStart + last.additionCount - 1;
    if (lastAdditionEnd < newLineCount) {
      const bot = expansionFor(opts, file.name, "bottom");
      const gapSize = newLineCount - lastAdditionEnd;
      if (gapSize - bot.up - bot.down > 0) return true;
    }
  }
  return false;
}

/** Per-direction expansion step (N). The two-row threshold is 2N. Matches
 *  Pierre's `expansionLineCount: 20` and the TUI's prior symmetric-20
 *  semantics (ADR 0018). Exported so the TUI dispatch + render layers
 *  pick their direction glyph / Enter-direction from the same constant. */
export const GAP_TWO_ROW_THRESHOLD = 40;

/** Affordance plan for a hunk-header banner's gap-above. Issue #280:
 *  GitHub's `@@` row hosts the primary direction button on its leftmost
 *  cell; only mid-file large gaps additionally emit a standalone
 *  `expand-down` row above the banner. */
export interface HunkHeaderExpandPlan {
  /** Subkind to host on the hunk-header banner's left cell. `null` paints
   *  an inert `…` placeholder and the row is not cursor-walkable. */
  primaryExpand: "up" | "all" | null;
  /** When true the planner emits a standalone `interactive-row[expand-down]`
   *  immediately before the hunk-header. Only set for mid-file large
   *  gaps (gapAbove ≥ 40, not file-top). */
  emitLeadingExpandDown: boolean;
}

/**
 * Pure helper that decides what affordance a hunk-header gap carries
 * (issue #280). Mirrors GitHub's per-hunk Expand Up / Expand Down /
 * Expand All layout. Called once per hunk-header gap (file-top OR
 * mid-file). The file-bottom case is handled separately by the planner
 * — it emits a lone `expand-down` row with no hunk-header.
 *
 *   `gapAbove === 0`                          → null    (inert; cursor skips)
 *   `gapAbove <  GAP_TWO_ROW_THRESHOLD` (=40) → "all"   (single Enter reveals the entire gap)
 *   `gapAbove >= 40` & `isFirst`              → "up"    (file-top: only one direction available)
 *   `gapAbove >= 40` & mid-file               → "up" + standalone Expand Down above the banner
 */
export function hunkHeaderExpandPlan(
  gapAbove: number,
  isFirst: boolean,
): HunkHeaderExpandPlan {
  if (gapAbove <= 0) return { primaryExpand: null, emitLeadingExpandDown: false };
  if (gapAbove < GAP_TWO_ROW_THRESHOLD) {
    return { primaryExpand: "all", emitLeadingExpandDown: false };
  }
  if (isFirst) return { primaryExpand: "up", emitLeadingExpandDown: false };
  return { primaryExpand: "up", emitLeadingExpandDown: true };
}

/** Renderer text for the standalone `expand-down` interactive row.
 *  Issue #280 collapsed Up/All onto the banner left cell; only Down
 *  remains as a standalone row and its label never reads the gap size
 *  (the 20-line step is fixed). */
function expandDownRowText(): string {
  return `↓ Expand Down`;
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
