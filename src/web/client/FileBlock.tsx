import React, { memo, useCallback, useRef } from "react";
import type { BundleFile } from "../../core/tour-bundle.js";
import type {
  PlannedRow,
  HunkHeaderRow,
  InteractiveRow as InteractiveRowKind,
  AnnotationRow,
  BoundaryRef,
} from "../../core/diff-rows.js";
import type { Cursor } from "../../core/cursor-state.js";
import type { ReplyLock } from "../../core/reply-lock.js";
import type { Annotation } from "./types.js";
import { useLazyHighlight } from "./use-lazy-highlight.js";
import { detectLang } from "./syntax-highlight.js";
import {
  DiffRow,
  CardRow,
  InteractiveRow,
  type DiffRowKind,
} from "./row-components.js";
import { RenameHeaderSpan, RenamePlaceholderBody } from "./rename-display.js";

/**
 * Per-file React component the Tour-owned web row renderer mounts (PRD
 * #212 slice 5, issue #218). Owns the file-level grid container, calls
 * `useLazyHighlight` for syntax highlighting, walks the file's
 * `PlannedRow[]` (from `core/diff-rows.ts`'s planner), and dispatches
 * each row to one of the three primitives from `row-components` (slice
 * 4): `<DiffRow>`, `<CardRow>`, `<InteractiveRow>`.
 *
 * Companion modules:
 *
 *   - `file-grid-css` (slice 3): provides the `<style>` block that
 *     interprets the className / data-attribute pairs this component +
 *     its children emit (`.tour-file-block[data-layout]`, `.tour-row`,
 *     `.tour-card[data-side]`, `.is-cursor`, `.in-range`,
 *     `[data-line-type]`).
 *
 *   - `useLazyHighlight` (slice 2): supplies the `tokensLeft` /
 *     `tokensRight` Maps `<DiffRow>` paints with `dangerouslySetInnerHTML`.
 *     Two calls per file (one per side) — the additions side uses
 *     `file.newContent`, the deletions side uses `file.oldContent`. Both
 *     observe the same block ref.
 *
 * Unused at this slice's merge time. `App.tsx` still routes the diff
 * body through Pierre's `<FileDiff>` / `<MultiFileDiff>`; slice 6 swaps
 * the App-level renderer reference and deletes the Pierre adapter pile.
 */

type Side = "additions" | "deletions";
type Layout = "split" | "unified";

export type ExpandAction =
  | {
      kind: "expand";
      file: string;
      boundaryRef: BoundaryRef;
      direction: "up" | "down" | "both";
      count: number;
    }
  | { kind: "expand-file"; file: string };

/** Pass-through fields to `<CardRow>` / `AnnotationCard`. Bundled into one
 *  prop so the FileBlock signature stays narrow — App-level callbacks all
 *  ride this object. */
export interface AnnotationProps {
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  composerError?: string | null;
  replyTargetId?: string | null;
  onOpenReply?: (annotationId: string) => void;
  onSubmitReply?: (body: string) => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent?: (annotationId: string) => void;
  /** 1-based position in the top-level nav order, per annotation id.
   *  Pre-built by App so the lookup stays O(1). */
  navIndexById?: Map<string, number>;
  navTotal?: number;
}

export interface RowClickAnchor {
  file: string;
  side: Side;
  lineNumber: number;
}

export interface FileBlockProps {
  file: BundleFile;
  rows: PlannedRow[];
  layout: Layout;
  cursor: Cursor | null;
  onDispatchExpand: (action: ExpandAction) => void;
  onRowClick: (anchor: RowClickAnchor) => void;
  onCardClick: (annotationId: string) => void;
  annotationProps?: AnnotationProps;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** When set + matching a diff row in this file, the composerSlot renders
   *  inline at that row's position via a `.tour-card`-positioned wrapper. */
  composerAnchor?: { side: Side; line_end: number } | null;
  composerSlot?: React.ReactNode;
}

function cardGridColumn(layout: Layout, side: Side): string {
  if (layout === "unified") return "1 / -1";
  return side === "deletions" ? "1 / 3" : "3 / -1";
}

// Maps `diff-row.type` (planner) → `DiffRow.kind` (component). The
// "change" branch is split-only — the planner emits paired left/right
// content; choose change-addition so the row's data-line-type matches the
// success-tint CSS rule (file-grid-css). Per-cell change tinting is
// reserved for a later slice.
function diffRowKindFor(type: "context" | "addition" | "deletion" | "change"): DiffRowKind {
  if (type === "change") return "change-addition";
  return type;
}

// Hunk-header direction:
//   hunkIndex === 0 → "up" (file-top expansion reveals lines toward line 1)
//   hunkIndex  >  0 → "both" (mid-file gap reveals from both sides)
function hunkHeaderDirection(hunkIndex: number): "up" | "both" {
  return hunkIndex === 0 ? "up" : "both";
}

function interactiveDirection(
  subKind: InteractiveRowKind["subKind"],
): "up" | "down" | "both" {
  if (subKind === "gap-mid-top") return "up";
  if (subKind === "boundary-bottom") return "down";
  if (subKind === "boundary-top") return "up";
  // collapsed-file uses `down` as a neutral default; activation routes
  // through `expand-file` regardless of direction.
  return "down";
}

// Cursor matching for a diff row. Returns true when the cursor's anchor
// agrees with the row's (file, side, lineNumber). preferredSide doesn't
// participate — the cursor's `side` field is the active one.
function rowCursorMatches(
  cursor: Cursor | null,
  file: string,
  side: Side,
  lineNumber: number | null,
): boolean {
  if (cursor === null || cursor.kind !== "row") return false;
  if (cursor.interactive) return false;
  if (cursor.file !== file) return false;
  if (cursor.side !== side) return false;
  if (lineNumber === null) return false;
  return cursor.lineNumber === lineNumber;
}

function interactiveCursorMatches(
  cursor: Cursor | null,
  file: string,
  subKind: InteractiveRowKind["subKind"],
  boundaryRef: BoundaryRef,
): boolean {
  if (cursor === null || cursor.kind !== "row") return false;
  if (!cursor.interactive) return false;
  if (cursor.file !== file) return false;
  return (
    cursor.interactive.subKind === subKind &&
    cursor.interactive.boundaryRef === boundaryRef
  );
}

function FileBlockImpl(props: FileBlockProps): React.JSX.Element {
  const {
    file,
    rows,
    layout,
    cursor,
    onDispatchExpand,
    onRowClick,
    onCardClick,
    annotationProps,
    isCollapsed,
    onToggleCollapse,
    composerAnchor,
    composerSlot,
  } = props;

  const blockRef = useRef<HTMLDivElement | null>(null);

  const additionsLang = detectLang(file.name);
  const deletionsLang = detectLang(file.prevName ?? file.name);
  const tokensRight = useLazyHighlight(blockRef, file.newContent ?? "", additionsLang);
  const tokensLeft = useLazyHighlight(blockRef, file.oldContent ?? "", deletionsLang);

  const reason = file.classification?.reason;

  const headerClick = useCallback(() => {
    onToggleCollapse();
  }, [onToggleCollapse]);

  // Pre-compute card-anchor flag per annotation id so the cursor flow into
  // <CardRow>'s `isCurrent` lookup is one O(1) check per row dispatch.
  const cursorCardId =
    cursor && cursor.kind === "card" ? cursor.annotationId : null;

  const navIndexById = annotationProps?.navIndexById;
  const navTotal = annotationProps?.navTotal ?? 0;

  return (
    <div className="tour-file-outer" data-file={file.name}>
      <div className="tour-file-header" onClick={headerClick}>
        <RenameHeaderSpan name={file.name} prevName={file.prevName} />
        <span className="tour-file-name">{file.name}</span>
        {reason ? <span className="reason-tag">{reason}</span> : null}
      </div>
      {isCollapsed ? null : (
        <div
          ref={blockRef}
          className="tour-file-block"
          data-layout={layout}
        >
          {rows.map((row, idx) =>
            renderRow({
              row,
              idx,
              file,
              layout,
              cursor,
              cursorCardId,
              tokensLeft,
              tokensRight,
              onDispatchExpand,
              onRowClick,
              onCardClick,
              annotationProps,
              navIndexById,
              navTotal,
              composerAnchor,
              composerSlot,
            }),
          )}
          <RenamePlaceholderBody reason={reason} />
        </div>
      )}
    </div>
  );
}

interface RenderRowArgs {
  row: PlannedRow;
  idx: number;
  file: BundleFile;
  layout: Layout;
  cursor: Cursor | null;
  cursorCardId: string | null;
  tokensLeft: ReturnType<typeof useLazyHighlight>;
  tokensRight: ReturnType<typeof useLazyHighlight>;
  onDispatchExpand: (action: ExpandAction) => void;
  onRowClick: (anchor: RowClickAnchor) => void;
  onCardClick: (annotationId: string) => void;
  annotationProps: AnnotationProps | undefined;
  navIndexById: Map<string, number> | undefined;
  navTotal: number;
  composerAnchor: { side: Side; line_end: number } | null | undefined;
  composerSlot: React.ReactNode;
}

function renderRow(args: RenderRowArgs): React.ReactNode {
  const {
    row,
    idx,
    file,
    layout,
    cursor,
    cursorCardId,
    tokensLeft,
    tokensRight,
    onDispatchExpand,
    onRowClick,
    onCardClick,
    annotationProps,
    navIndexById,
    navTotal,
    composerAnchor,
    composerSlot,
  } = args;

  if (row.kind === "diff-row") {
    const node = renderDiffRow(
      row,
      idx,
      file,
      layout,
      cursor,
      tokensLeft,
      tokensRight,
      onRowClick,
    );
    // Composer renders directly after its anchor row. The anchor is the
    // diff row whose `(side, lineNumber)` matches composerAnchor — same
    // matching rule the card-interleave step uses.
    const composer = matchComposerAnchor(row, composerAnchor)
      ? renderComposer(layout, composerAnchor!.side, composerSlot, idx)
      : null;
    return composer ? [node, composer] : node;
  }
  if (row.kind === "hunk-header") {
    return renderHunkHeader(row, idx, file, cursor, onDispatchExpand);
  }
  if (row.kind === "interactive") {
    return renderInteractive(row, idx, file, cursor, onDispatchExpand);
  }
  if (row.kind === "annotation") {
    return renderAnnotation(
      row,
      idx,
      layout,
      cursorCardId,
      onCardClick,
      annotationProps,
      navIndexById,
      navTotal,
    );
  }
  return null;
}

function matchComposerAnchor(
  row: Extract<PlannedRow, { kind: "diff-row" }>,
  anchor: { side: Side; line_end: number } | null | undefined,
): boolean {
  if (!anchor) return false;
  if (anchor.side === "additions") return row.rightLineNumber === anchor.line_end;
  return row.leftLineNumber === anchor.line_end;
}

function renderComposer(
  layout: Layout,
  side: Side,
  slot: React.ReactNode,
  idx: number,
): React.ReactNode {
  if (slot == null) return null;
  return (
    <div
      key={`composer-${idx}`}
      className="tour-card"
      data-side={side}
      data-composer="true"
      style={{ gridColumn: cardGridColumn(layout, side) }}
    >
      {slot}
    </div>
  );
}

function renderDiffRow(
  row: Extract<PlannedRow, { kind: "diff-row" }>,
  idx: number,
  file: BundleFile,
  layout: Layout,
  cursor: Cursor | null,
  tokensLeft: ReturnType<typeof useLazyHighlight>,
  tokensRight: ReturnType<typeof useLazyHighlight>,
  onRowClick: (anchor: RowClickAnchor) => void,
): React.ReactNode {
  const kind = diffRowKindFor(row.type);
  // Cursor matches whichever side's lineNumber agrees. Check the cursor's
  // active side first — h/l toggles that field so the outline follows the
  // user's column.
  const isCursorOnAdditions = rowCursorMatches(
    cursor,
    file.name,
    "additions",
    row.rightLineNumber,
  );
  const isCursorOnDeletions = rowCursorMatches(
    cursor,
    file.name,
    "deletions",
    row.leftLineNumber,
  );
  const isCursor = isCursorOnAdditions || isCursorOnDeletions;
  const isInRange = !!(row.leftTinted || row.rightTinted);
  const handleClick = (side: Side) => {
    const lineNumber =
      side === "additions" ? row.rightLineNumber : row.leftLineNumber;
    if (lineNumber == null) return;
    onRowClick({ file: file.name, side, lineNumber });
  };
  return (
    <DiffRow
      key={`row-${idx}`}
      kind={kind}
      layout={layout}
      leftLineNumber={row.leftLineNumber}
      rightLineNumber={row.rightLineNumber}
      leftText={row.leftText}
      rightText={row.rightText}
      tokensLeft={tokensLeft}
      tokensRight={tokensRight}
      isCursor={isCursor}
      isInRange={isInRange}
      onClick={handleClick}
    />
  );
}

function renderHunkHeader(
  row: HunkHeaderRow,
  idx: number,
  file: BundleFile,
  cursor: Cursor | null,
  onDispatchExpand: (action: ExpandAction) => void,
): React.ReactNode {
  // hunk-header maps to an interactive row for expansion dispatch.
  // hunkIndex === 0 → boundary-top (file-top), boundaryRef "top".
  // hunkIndex  >  0 → hunk-separator, boundaryRef = hunkIndex.
  const subKind: InteractiveRowKind["subKind"] =
    row.hunkIndex === 0 ? "boundary-top" : "hunk-separator";
  const boundaryRef: BoundaryRef = row.hunkIndex === 0 ? "top" : row.hunkIndex;
  const direction = hunkHeaderDirection(row.hunkIndex);
  const isCursor = interactiveCursorMatches(cursor, file.name, subKind, boundaryRef);
  const onActivate = (count: number) => {
    if (row.gapAbove <= 0) return;
    onDispatchExpand({
      kind: "expand",
      file: file.name,
      boundaryRef,
      direction,
      count,
    });
  };
  return (
    <InteractiveRow
      key={`hh-${idx}`}
      subKind={subKind}
      boundaryRef={boundaryRef}
      direction={direction}
      gapAbove={row.gapAbove}
      glyph={row.header}
      isCursor={isCursor}
      onActivate={onActivate}
    />
  );
}

function renderInteractive(
  row: InteractiveRowKind,
  idx: number,
  file: BundleFile,
  cursor: Cursor | null,
  onDispatchExpand: (action: ExpandAction) => void,
): React.ReactNode {
  const direction = interactiveDirection(row.subKind);
  const gapAbove = row.gapAbove ?? 0;
  const isCursor = interactiveCursorMatches(
    cursor,
    file.name,
    row.subKind,
    row.boundaryRef,
  );
  const onActivate = (count: number) => {
    if (row.subKind === "collapsed-file") {
      onDispatchExpand({ kind: "expand-file", file: file.name });
      return;
    }
    onDispatchExpand({
      kind: "expand",
      file: file.name,
      boundaryRef: row.boundaryRef,
      direction,
      count,
    });
  };
  return (
    <InteractiveRow
      key={`int-${idx}`}
      subKind={row.subKind}
      boundaryRef={row.boundaryRef}
      direction={direction}
      gapAbove={gapAbove}
      glyph={row.text}
      isCursor={isCursor}
      onActivate={onActivate}
    />
  );
}

function renderAnnotation(
  row: AnnotationRow,
  idx: number,
  layout: Layout,
  cursorCardId: string | null,
  onCardClick: (annotationId: string) => void,
  annotationProps: AnnotationProps | undefined,
  navIndexById: Map<string, number> | undefined,
  navTotal: number,
): React.ReactNode {
  const ann = row.annotation;
  const isCurrent = ann.id === cursorCardId;
  const navIndex = navIndexById?.get(ann.id) ?? null;
  return (
    <CardRow
      key={`ann-${ann.id}`}
      annotation={ann}
      replies={row.replies}
      isCurrent={isCurrent}
      navIndex={navIndex}
      navTotal={navTotal}
      side={ann.side}
      layout={layout}
      registerRef={annotationProps?.registerRef}
      composerError={annotationProps?.composerError ?? null}
      replyTargetId={annotationProps?.replyTargetId ?? null}
      onOpenReply={annotationProps?.onOpenReply}
      onSubmitReply={annotationProps?.onSubmitReply}
      onCancelReply={annotationProps?.onCancelReply}
      replyLock={annotationProps?.replyLock ?? null}
      replyAgent={annotationProps?.replyAgent ?? null}
      onSendToAgent={annotationProps?.onSendToAgent}
      onCardClick={onCardClick}
    />
  );
}

export const FileBlock = memo(FileBlockImpl);
