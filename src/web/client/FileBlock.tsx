import React, { memo, useMemo, useRef } from "react";
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
import { useLazyHighlight } from "./use-lazy-highlight.js";
import { detectLang } from "./syntax-highlight.js";
import {
  DiffRow,
  CardRow,
  InteractiveRow,
  HunkHeaderBanner,
  type DiffRowKind,
} from "./row-components.js";
import { RenameHeaderSpan, RenamePlaceholderBody } from "./rename-display.js";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from "./icons.js";
import { fileIcon } from "./file-icon.js";
import { countDiffStats, proportionSegments } from "../../core/diff-stats.js";

/**
 * Per-file React component for the web row renderer. Owns the file-level
 * grid container, walks the file's `PlannedRow[]` (from
 * `core/diff-rows.ts`'s planner), and dispatches each row to one of the
 * three primitives in `row-components`: `<DiffRow>`, `<CardRow>`,
 * `<InteractiveRow>`.
 *
 * Two `useLazyHighlight` calls per file (one per side) supply the
 * `tokensLeft` / `tokensRight` maps `<DiffRow>` paints — additions side
 * reads `file.newContent`, deletions side reads `file.oldContent`. Both
 * observe the same block ref.
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
  | { kind: "expand-file"; file: string }
  | { kind: "expand-file-all"; file: string };

/** Pass-through fields to `<CardRow>` / `AnnotationCard`. Bundled into one
 *  prop so the FileBlock signature stays narrow — App-level callbacks all
 *  ride this object. */
export interface AnnotationProps {
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  composerBody?: string;
  composerError?: string | null;
  onComposerBodyChange?: (body: string) => void;
  replyTargetId?: string | null;
  onOpenReply?: (annotationId: string) => void;
  onSubmitReply?: () => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent?: (annotationId: string) => void;
  /** 1-based position in the top-level nav order, per annotation id.
   *  Pre-built by App so the lookup stays O(1). */
  navIndexById?: ReadonlyMap<string, number>;
  navTotal?: number;
}

export interface RowClickAnchor {
  file: string;
  side: Side;
  lineNumber: number;
}

export interface FileBlockProps {
  file: BundleFile;
  rows: ReadonlyArray<PlannedRow>;
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
  // Split layout has 6 tracks (gutter-L, symbol-L, code-L, gutter-R,
  // symbol-R, code-R), so deletion cards span cols 1-3 and addition
  // cards span cols 4-end.
  return side === "deletions" ? "1 / 4" : "4 / -1";
}

// Maps `diff-row.type` (planner) → `DiffRow.kind` (component). The
// "change" branch is split-only — the planner emits paired left/right
// content; choose change-addition so the row's data-line-type matches
// the success-tint CSS rule.
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
  // PRD #270 / issue #271 directional family: each row dispatches the
  // direction named by its label. `expand-all` always reveals the entire
  // remaining gap (`both` with `count = gapAbove`).
  if (subKind === "expand-up") return "up";
  if (subKind === "expand-down") return "down";
  if (subKind === "expand-all") return "both";
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

  // Pre-compute card-anchor flag per annotation id so the cursor flow into
  // <CardRow>'s `isCurrent` lookup is one O(1) check per row dispatch.
  const cursorCardId =
    cursor && cursor.kind === "card" ? cursor.annotationId : null;

  const navIndexById = annotationProps?.navIndexById;
  const navTotal = annotationProps?.navTotal ?? 0;

  const Chevron = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
  const { Icon: StatusIcon, statusClass } = fileIcon(file.type);

  const stats = useMemo(() => countDiffStats(rows), [rows]);
  const segments = useMemo(
    () => proportionSegments(stats.additions, stats.deletions),
    [stats.additions, stats.deletions],
  );

  const handleCopyPath = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void navigator.clipboard?.writeText?.(file.name).catch(() => {});
  };

  // PRD #270 / issue #274 (Slice 4): per-file Expand-all affordance. The
  // header is also the toggle-collapse target, so `event.stopPropagation`
  // here mirrors the copy-path button's pattern from #225 — clicking the
  // expand-all button reveals every hidden gap in the file without
  // toggling the file's collapsed state.
  const handleExpandAll = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDispatchExpand({ kind: "expand-file-all", file: file.name });
  };

  return (
    <div className="tour-file-outer" data-file={file.name}>
      <div className="tour-file-header" onClick={onToggleCollapse}>
        <div className="tour-file-header-left">
          <Chevron className="tour-file-chevron" />
          <StatusIcon className={`tour-file-status-icon ${statusClass}`} />
          <RenameHeaderSpan name={file.name} prevName={file.prevName} />
          <span className="tour-file-name">{file.name}</span>
        </div>
        <div className="tour-file-header-right">
          {reason ? <span className="reason-tag">{reason}</span> : null}
          <DiffStatsIndicator
            additions={stats.additions}
            deletions={stats.deletions}
            segments={segments}
          />
          <button
            type="button"
            className="tour-file-expand-all-button"
            aria-label="Expand all hidden context in this file"
            onClick={handleExpandAll}
          >
            ↕
          </button>
          <button
            type="button"
            className="tour-file-copy-button"
            aria-label="Copy file path"
            onClick={handleCopyPath}
          >
            <CopyIcon />
          </button>
        </div>
      </div>
      {isCollapsed ? null : (
        <div
          ref={blockRef}
          className="tour-file-block"
          data-layout={layout}
        >
          {rows.flatMap((row, idx) => {
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
              // Composer renders directly after its anchor row — the diff row
              // whose `(side, lineNumber)` matches composerAnchor.
              if (matchComposerAnchor(row, composerAnchor)) {
                return [
                  node,
                  renderComposer(layout, composerAnchor!.side, composerSlot, idx),
                ];
              }
              return [node];
            }
            if (row.kind === "hunk-header") {
              return [renderHunkHeader(row, idx, file, cursor)];
            }
            if (row.kind === "interactive") {
              return [renderInteractive(row, idx, file, cursor, onDispatchExpand)];
            }
            return [
              renderAnnotation(
                row,
                idx,
                layout,
                cursorCardId,
                onCardClick,
                annotationProps,
                navIndexById,
                navTotal,
              ),
            ];
          })}
          <RenamePlaceholderBody reason={reason} />
        </div>
      )}
    </div>
  );
}

function DiffStatsIndicator(props: {
  additions: number;
  deletions: number;
  segments: { greens: number; reds: number; neutrals: number };
}): React.JSX.Element {
  const { additions, deletions, segments } = props;
  const segmentNodes: React.ReactNode[] = [];
  for (let i = 0; i < segments.greens; i += 1) {
    segmentNodes.push(
      <span
        key={`g-${i}`}
        className="tour-file-stats-segment added"
        aria-hidden="true"
      />,
    );
  }
  for (let i = 0; i < segments.reds; i += 1) {
    segmentNodes.push(
      <span
        key={`r-${i}`}
        className="tour-file-stats-segment deleted"
        aria-hidden="true"
      />,
    );
  }
  for (let i = 0; i < segments.neutrals; i += 1) {
    segmentNodes.push(
      <span
        key={`n-${i}`}
        className="tour-file-stats-segment neutral"
        aria-hidden="true"
      />,
    );
  }
  return (
    <span className="tour-file-stats">
      <span className="tour-file-stats-bar">{segmentNodes}</span>
      {additions > 0 ? (
        <span className="tour-file-stats-count added">{`+${additions}`}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="tour-file-stats-count deleted">{`-${deletions}`}</span>
      ) : null}
    </span>
  );
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
  // Cursor matches whichever side's lineNumber agrees. h/l toggles
  // cursor.side, so the matched side determines which cell reads the
  // outline (scoped to one side, not the whole row).
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
  const cursorSide: Side | undefined = isCursorOnAdditions
    ? "additions"
    : isCursorOnDeletions
      ? "deletions"
      : undefined;
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
      cursorSide={cursorSide}
      leftInRange={!!row.leftTinted}
      rightInRange={!!row.rightTinted}
      onClick={handleClick}
    />
  );
}

// PRD #270 Slice 2 / issue #272: the hunk-header banner is display-only —
// no click / keyboard dispatch. The directional expand affordance is
// owned by the `<InteractiveRow>` subkinds (`expand-up` / `expand-down` /
// `expand-all`) emitted by `expandRowsForGap` (Slice 1); the banner
// itself is rendered for wayfinding only. `cursor` is still passed
// through so the `.is-cursor` outline rule applies structurally if the
// cursor were ever placed on the banner — in practice
// `flatRows` no longer promotes hunk-header rows to interactive
// flat-rows, so the cursor never walks here.
function renderHunkHeader(
  row: HunkHeaderRow,
  idx: number,
  file: BundleFile,
  cursor: Cursor | null,
): React.ReactNode {
  // hunkIndex === 0 → boundary-top (file-top), boundaryRef "top".
  // hunkIndex  >  0 → hunk-separator, boundaryRef = hunkIndex.
  const subKind: InteractiveRowKind["subKind"] =
    row.hunkIndex === 0 ? "boundary-top" : "hunk-separator";
  const boundaryRef: BoundaryRef = row.hunkIndex === 0 ? "top" : row.hunkIndex;
  const direction = hunkHeaderDirection(row.hunkIndex);
  const isCursor = interactiveCursorMatches(cursor, file.name, subKind, boundaryRef);
  return (
    <HunkHeaderBanner
      key={`hh-${idx}`}
      header={row.header}
      boundaryRef={boundaryRef}
      direction={direction}
      isCursor={isCursor}
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
  navIndexById: ReadonlyMap<string, number> | undefined,
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
      composerBody={annotationProps?.composerBody ?? ""}
      composerError={annotationProps?.composerError ?? null}
      onComposerBodyChange={annotationProps?.onComposerBodyChange}
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
