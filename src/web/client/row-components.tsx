import React, { memo } from "react";
import type { BoundaryRef, InteractiveSubKind } from "../../core/diff-rows.js";
import type { ReplyLock } from "../../core/reply-lock.js";
import { AnnotationCard } from "./App.js";
import type { Annotation } from "./types.js";
import type { TokenLines } from "./syntax-highlight.js";

/**
 * Row primitives the Tour-owned web row renderer (PRD #212 slice 4)
 * mounts. Three `React.memo`'d, prop-driven components — no internal
 * state, no Pierre dependency, no DOM mutation. Companion modules:
 *
 *   - `file-grid-css` (slice 3): the `<style>` block that interprets the
 *     attributes / classNames these components emit (`.tour-row`,
 *     `.tour-card`, `.is-cursor`, `.in-range`, `[data-line-type]`,
 *     `[data-side]`).
 *
 *   - `useLazyHighlight` (slice 2): supplies the `tokensLeft` /
 *     `tokensRight` Maps `<DiffRow>` paints with `dangerouslySetInnerHTML`.
 *
 *   - `<FileBlock>` (slice 5, not yet landed): the per-file React
 *     component that walks the planner's `PlannedRow[]` and dispatches
 *     each row to one of the three primitives below.
 *
 * These primitives are unused at this slice's merge time — `App.tsx` still
 * routes the diff body through Pierre's `<FileDiff>` / `<MultiFileDiff>`.
 * Slice 5's `<FileBlock>` consumes them; slice 6 swaps the App-level
 * renderer reference and deletes the Pierre adapter pile.
 */

export const EXPANSION_STEP = 20;

type Side = "additions" | "deletions";
type Layout = "split" | "unified";

// ---------------------------------------------------------------------------
// <DiffRow>
// ---------------------------------------------------------------------------

export type DiffRowKind =
  | "addition"
  | "deletion"
  | "change-addition"
  | "change-deletion"
  | "context";

export interface DiffRowProps {
  kind: DiffRowKind;
  layout: Layout;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string;
  rightText: string;
  tokensLeft?: TokenLines | null;
  tokensRight?: TokenLines | null;
  isCursor: boolean;
  isInRange: boolean;
  /** Informs which column reads the cursor outline in split layout when
   *  the row carries content on only one side. The component falls back
   *  to `kind` when this is omitted. */
  preferredSide?: Side;
  /** Receives the column-side of the click so the App layer can seed the
   *  Line cursor for annotation creation. */
  onClick?: (side: Side) => void;
  onMouseEnter?: () => void;
}

// `display: grid` + `grid-template-columns: subgrid` + `grid-column: 1 / -1`
// is the per-row subgrid pattern. File-grid-css also declares these rules
// keyed on `.tour-row`; the inline style is what makes the structure
// inspectable from tests without injecting the stylesheet.
const ROW_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "subgrid",
  gridColumn: "1 / -1",
};

function impliedSideFromKind(kind: DiffRowKind): Side | null {
  if (kind === "addition" || kind === "change-addition") return "additions";
  if (kind === "deletion" || kind === "change-deletion") return "deletions";
  return null;
}

function DiffRowImpl(props: DiffRowProps): React.JSX.Element {
  const {
    kind,
    layout,
    leftLineNumber,
    rightLineNumber,
    leftText,
    rightText,
    tokensLeft,
    tokensRight,
    isCursor,
    isInRange,
    preferredSide,
    onClick,
    onMouseEnter,
  } = props;

  const classes = ["tour-row"];
  if (isCursor) classes.push("is-cursor");
  if (isInRange) classes.push("in-range");

  const handleColumnClick = (side: Side) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(side);
  };

  if (layout === "split") {
    return (
      <div
        className={classes.join(" ")}
        data-line-type={kind}
        style={ROW_STYLE}
        onMouseEnter={onMouseEnter}
      >
        <Column
          side="deletions"
          lineNumber={leftLineNumber}
          text={leftText}
          tokens={tokensLeft}
          onClick={onClick ? handleColumnClick("deletions") : undefined}
        />
        <Column
          side="additions"
          lineNumber={rightLineNumber}
          text={rightText}
          tokens={tokensRight}
          onClick={onClick ? handleColumnClick("additions") : undefined}
        />
      </div>
    );
  }

  // Unified — a single gutter + code column. The side echoed back to
  // `onClick` is determined by `kind` (an addition row is unambiguous);
  // for context rows the caller's `preferredSide` wins, defaulting to
  // additions (mirrors `click-anchor.ts`'s context-fallback rule).
  const impliedSide = impliedSideFromKind(kind);
  const sideForClick: Side = impliedSide ?? preferredSide ?? "additions";
  const lineNumber = rightLineNumber ?? leftLineNumber;
  const text = impliedSide === "deletions" ? leftText : rightText;
  const tokens = impliedSide === "deletions" ? tokensLeft : tokensRight;
  return (
    <div
      className={classes.join(" ")}
      data-line-type={kind}
      style={ROW_STYLE}
      onMouseEnter={onMouseEnter}
    >
      <Column
        side={sideForClick}
        lineNumber={lineNumber}
        text={text}
        tokens={tokens}
        onClick={onClick ? handleColumnClick(sideForClick) : undefined}
      />
    </div>
  );
}

interface ColumnProps {
  side: Side;
  lineNumber: number | null;
  text: string;
  tokens?: TokenLines | null;
  onClick?: (e: React.MouseEvent) => void;
}

function Column({
  side,
  lineNumber,
  text,
  tokens,
  onClick,
}: ColumnProps): React.JSX.Element {
  const html = lineNumber != null ? tokens?.get(lineNumber) : undefined;
  return (
    <>
      <span
        className="tour-row-gutter"
        data-side={side}
        data-line-number={lineNumber ?? ""}
      >
        {lineNumber ?? ""}
      </span>
      <span className="tour-row-cell" data-side={side} onClick={onClick}>
        {html !== undefined ? (
          <span
            className="tour-row-code"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span className="tour-row-code">{text}</span>
        )}
      </span>
    </>
  );
}

export const DiffRow = memo(DiffRowImpl);

// ---------------------------------------------------------------------------
// <CardRow>
// ---------------------------------------------------------------------------

export interface CardRowProps {
  annotation: Annotation;
  replies?: Annotation[];
  isCurrent: boolean;
  navIndex: number | null;
  navTotal: number;
  side: Side;
  layout: Layout;
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  // AnnotationCard pass-through.
  composerError?: string | null;
  replyTargetId?: string | null;
  onOpenReply?: (annotationId: string) => void;
  onSubmitReply?: (body: string) => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent?: (annotationId: string) => void;
  onCardClick?: (annotationId: string) => void;
}

// `grid-column` is set inline so a card's positioning is visible on the
// element itself; file-grid-css emits the same rules as a fallback for
// callers (e.g. the future <FileBlock> integration test) that mount via
// CSS only.
function cardGridColumn(layout: Layout, side: Side): string {
  if (layout === "unified") return "1 / -1";
  return side === "deletions" ? "1 / 3" : "3 / -1";
}

function CardRowImpl(props: CardRowProps): React.JSX.Element {
  const {
    annotation,
    replies,
    isCurrent,
    navIndex,
    navTotal,
    side,
    layout,
    registerRef,
    composerError,
    replyTargetId,
    onOpenReply,
    onSubmitReply,
    onCancelReply,
    replyLock,
    replyAgent,
    onSendToAgent,
    onCardClick,
  } = props;
  return (
    <div
      className="tour-card"
      data-side={side}
      style={{ gridColumn: cardGridColumn(layout, side) }}
    >
      <AnnotationCard
        annotation={annotation}
        replies={replies}
        isCurrent={isCurrent}
        navIndex={navIndex}
        navTotal={navTotal}
        registerRef={registerRef}
        composerError={composerError}
        replyTargetId={replyTargetId}
        onOpenReply={onOpenReply}
        onSubmitReply={onSubmitReply}
        onCancelReply={onCancelReply}
        replyLock={replyLock}
        replyAgent={replyAgent}
        onSendToAgent={onSendToAgent}
        onCardClick={onCardClick}
      />
    </div>
  );
}

export const CardRow = memo(CardRowImpl);

// ---------------------------------------------------------------------------
// <InteractiveRow>
// ---------------------------------------------------------------------------

export interface InteractiveRowProps {
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
  direction: "up" | "down" | "both";
  glyph?: string;
  gapAbove: number;
  isCursor: boolean;
  /** Dispatches the expand action into `core/expansion-state.ts`'s
   *  reducer. The component computes `count` from the click/key modifier:
   *  shift → `Math.max(gapAbove, EXPANSION_STEP)`, otherwise
   *  `EXPANSION_STEP`. */
  onActivate: (count: number) => void;
}

function expansionCount(gapAbove: number, shift: boolean): number {
  return shift ? Math.max(gapAbove, EXPANSION_STEP) : EXPANSION_STEP;
}

function InteractiveRowImpl(props: InteractiveRowProps): React.JSX.Element {
  const {
    subKind,
    boundaryRef,
    direction,
    glyph,
    gapAbove,
    isCursor,
    onActivate,
  } = props;
  const classes = ["tour-row", "tour-row-interactive"];
  if (isCursor) classes.push("is-cursor");
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActivate(expansionCount(gapAbove, e.shiftKey));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isCursor) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    onActivate(expansionCount(gapAbove, e.shiftKey));
  };
  return (
    <div
      className={classes.join(" ")}
      role="button"
      tabIndex={0}
      data-subkind={subKind}
      data-direction={direction}
      data-boundary-ref={String(boundaryRef)}
      style={ROW_STYLE}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {glyph ? <span className="tour-row-glyph">{glyph}</span> : null}
    </div>
  );
}

export const InteractiveRow = memo(InteractiveRowImpl);
