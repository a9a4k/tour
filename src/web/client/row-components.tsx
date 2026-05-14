import React, { memo } from "react";
import type { BoundaryRef, InteractiveSubKind } from "../../core/diff-rows.js";
import type { ReplyLock } from "../../core/reply-lock.js";
import { AnnotationCard } from "./App.js";
import type { Annotation } from "./types.js";
import type { TokenLines } from "./syntax-highlight.js";

/**
 * Row primitives mounted by `<FileBlock>`. Three `React.memo`'d,
 * prop-driven components — no internal state, no DOM mutation.
 *
 * `file-grid-css` interprets the className / data-attribute vocabulary
 * these components emit (`.tour-row`, `.tour-card`, `.is-cursor`,
 * `.in-range`, `.in-range-stripe`, `[data-line-type]`, `[data-side]`).
 *
 * `useLazyHighlight` supplies the `tokensLeft` / `tokensRight` maps
 * `<DiffRow>` paints with `dangerouslySetInnerHTML`.
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
  /** Which side carries the cursor outline. Required in split layout when
   *  `isCursor=true` to scope the outline to one cell instead of the whole
   *  row. Unused in unified (the single rendered cell is the only
   *  candidate). Falls back to the kind-implied side, then `preferredSide`,
   *  then the side with content. */
  cursorSide?: Side;
  /** Whether the deletions side is in an annotation's range. Drives the
   *  range tint on `.tour-row-gutter` / `.tour-row-symbol` /
   *  `.tour-row-cell` of the deletions column, and the 3px inset stripe
   *  on the deletions gutter when this is the leftmost tinted side. */
  leftInRange?: boolean;
  /** Whether the additions side is in an annotation's range. Mirror of
   *  `leftInRange` for the additions column. */
  rightInRange?: boolean;
  /** Informs which column reads the cursor outline in split layout when
   *  the row carries content on only one side. The component falls back
   *  to `kind` when this is omitted. */
  preferredSide?: Side;
  /** Receives the column-side of the click so the App layer can seed the
   *  Line cursor for annotation creation. */
  onClick?: (side: Side) => void;
  onMouseEnter?: () => void;
  /** Issue #320: GitHub-style `+` annotate button. When wired, each gutter
   *  with a line number renders a `+`; clicking calls onAnnotate(side,
   *  lineNumber). Visibility is CSS-driven; omit the prop to hide the
   *  button on every gutter (used by rows that can't anchor annotations). */
  onAnnotate?: (side: Side, lineNumber: number) => void;
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

// Full-width banner: row spans 1 / -1 via grid-column but does NOT declare
// subgrid. The row's CSS rule overrides .tour-row's display:grid + subgrid
// template so child content flows as normal block content instead of
// slotting into the narrow leftmost auto track.
const BANNER_STYLE: React.CSSProperties = {
  gridColumn: "1 / -1",
};

function impliedSideFromKind(kind: DiffRowKind): Side | null {
  if (kind === "addition" || kind === "change-addition") return "additions";
  if (kind === "deletion" || kind === "change-deletion") return "deletions";
  return null;
}

// Maps (kind, side, lineNumber) → the glyph emitted in the row's symbol cell.
// Blank when the column doesn't carry content (lineNumber == null) or when
// the row kind doesn't imply a +/- on that side (e.g. context). For paired
// change rows in split layout (`kind === "change-addition"` with both sides
// populated) the left column reads as a deletion ("-") and the right column
// as an addition ("+").
function symbolForColumn(
  kind: DiffRowKind,
  side: Side,
  lineNumber: number | null,
): string {
  if (lineNumber == null) return "";
  if (side === "additions") {
    return kind === "addition" || kind === "change-addition" ? "+" : "";
  }
  return kind === "deletion" ||
    kind === "change-deletion" ||
    kind === "change-addition"
    ? "-"
    : "";
}

// Picks which split-layout side reads `.is-cursor` on its `.tour-row-cell`.
// Resolution order: explicit `cursorSide` → kind-implied side →
// `preferredSide` → side with content. The last fallback handles the
// addition-only / deletion-only row when `cursorSide` disagrees: scope to
// the side that actually carries content.
function resolveCursorSide(args: {
  isCursor: boolean;
  cursorSide?: Side;
  kind: DiffRowKind;
  preferredSide?: Side;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
}): Side | null {
  if (!args.isCursor) return null;
  const implied = impliedSideFromKind(args.kind);
  const candidate =
    args.cursorSide ?? implied ?? args.preferredSide ?? "additions";
  const candidateHasContent =
    candidate === "additions"
      ? args.rightLineNumber != null
      : args.leftLineNumber != null;
  if (candidateHasContent) return candidate;
  if (args.rightLineNumber != null) return "additions";
  if (args.leftLineNumber != null) return "deletions";
  return candidate;
}

// Resolves which sides carry the range tint in split layout. The planner
// sets at most one of `leftInRange` / `rightInRange` per annotation, but
// rows can land in both ranges (rare multi-line annotation case). When a
// flag points at a side with no content (defensive fallback), reroute to
// the side that actually carries a line number.
function resolveRangeSides(args: {
  leftInRange?: boolean;
  rightInRange?: boolean;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
}): { left: boolean; right: boolean } {
  let left = !!args.leftInRange;
  let right = !!args.rightInRange;
  const onlyLeftContent =
    args.leftLineNumber != null && args.rightLineNumber == null;
  const onlyRightContent =
    args.rightLineNumber != null && args.leftLineNumber == null;
  if (onlyLeftContent && right && !left) {
    left = true;
    right = false;
  } else if (onlyRightContent && left && !right) {
    left = false;
    right = true;
  }
  return { left, right };
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
    cursorSide,
    leftInRange,
    rightInRange,
    preferredSide,
    onClick,
    onMouseEnter,
    onAnnotate,
  } = props;

  // `.is-cursor` and `.in-range` live per-cell so split layout scopes both
  // decorations to one half instead of spanning both columns.
  const cursorOnSide = resolveCursorSide({
    isCursor,
    cursorSide,
    kind,
    preferredSide,
    leftLineNumber,
    rightLineNumber,
  });
  const range = resolveRangeSides({
    leftInRange,
    rightInRange,
    leftLineNumber,
    rightLineNumber,
  });
  // 3px stripe sits at the leftmost edge of the row's tinted region.
  // Deletions gutter is the row's leftmost edge, so it wins in the
  // both-sides fallback case as well.
  const stripeSide: Side | null = range.left
    ? "deletions"
    : range.right
      ? "additions"
      : null;

  const handleColumnClick = (side: Side) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(side);
  };

  // Issue #303 follow-up: layout-invariant row id mirrors `flatRowFromLines`
  // in `core/flat-rows.ts` — paired/additions rows key off rightLineNumber,
  // pure-deletion rows off leftLineNumber. `findCursorRowEl` (App.tsx)
  // queries by this attribute so the cursor's row resolves in BOTH split
  // and unified, including paired-context cursors on the deletions side
  // (where `data-side` on the rendered gutter diverges from the FlatRow's
  // canonical `additions`).
  const rowDataId =
    rightLineNumber !== null
      ? `additions-${rightLineNumber}`
      : leftLineNumber !== null
        ? `deletions-${leftLineNumber}`
        : undefined;

  if (layout === "split") {
    return (
      <div
        className="tour-row"
        data-line-type={kind}
        data-row-id={rowDataId}
        style={ROW_STYLE}
        onMouseEnter={onMouseEnter}
      >
        <Column
          side="deletions"
          lineNumber={leftLineNumber}
          text={leftText}
          tokens={tokensLeft}
          symbol={symbolForColumn(kind, "deletions", leftLineNumber)}
          isCursor={cursorOnSide === "deletions"}
          isInRange={range.left}
          hasStripe={stripeSide === "deletions"}
          onClick={onClick ? handleColumnClick("deletions") : undefined}
          onAnnotate={onAnnotate}
        />
        <Column
          side="additions"
          lineNumber={rightLineNumber}
          text={rightText}
          tokens={tokensRight}
          symbol={symbolForColumn(kind, "additions", rightLineNumber)}
          isCursor={cursorOnSide === "additions"}
          isInRange={range.right}
          hasStripe={stripeSide === "additions"}
          onClick={onClick ? handleColumnClick("additions") : undefined}
          onAnnotate={onAnnotate}
        />
      </div>
    );
  }

  // Unified — a single gutter + symbol + code column. The side echoed back
  // to `onClick` is determined by `kind` (an addition row is unambiguous);
  // for context rows the caller's `preferredSide` wins, defaulting to
  // additions (same fallback rule as the TUI's context-row pairing).
  const impliedSide = impliedSideFromKind(kind);
  const sideForClick: Side = impliedSide ?? preferredSide ?? "additions";
  const lineNumber = rightLineNumber ?? leftLineNumber;
  const text = impliedSide === "deletions" ? leftText : rightText;
  const tokens = impliedSide === "deletions" ? tokensLeft : tokensRight;
  // Unified collapses sides; either tinted flag lights the single column,
  // and the stripe sits at the (only) gutter's left edge.
  const unifiedInRange = range.left || range.right;
  return (
    <div
      className="tour-row"
      data-line-type={kind}
      data-row-id={rowDataId}
      style={ROW_STYLE}
      onMouseEnter={onMouseEnter}
    >
      <Column
        side={sideForClick}
        lineNumber={lineNumber}
        text={text}
        tokens={tokens}
        symbol={symbolForColumn(kind, sideForClick, lineNumber)}
        isCursor={isCursor}
        isInRange={unifiedInRange}
        hasStripe={unifiedInRange}
        onClick={onClick ? handleColumnClick(sideForClick) : undefined}
        onAnnotate={onAnnotate}
      />
    </div>
  );
}

interface ColumnProps {
  side: Side;
  lineNumber: number | null;
  text: string;
  tokens?: TokenLines | null;
  symbol: string;
  isCursor: boolean;
  isInRange: boolean;
  hasStripe: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onAnnotate?: (side: Side, lineNumber: number) => void;
}

function Column({
  side,
  lineNumber,
  text,
  tokens,
  symbol,
  isCursor,
  isInRange,
  hasStripe,
  onClick,
  onAnnotate,
}: ColumnProps): React.JSX.Element {
  const html = lineNumber != null ? tokens?.get(lineNumber) : undefined;
  const gutterClasses = ["tour-row-gutter"];
  if (isInRange) gutterClasses.push("in-range");
  if (hasStripe) gutterClasses.push("in-range-stripe");
  const symbolClasses = ["tour-row-symbol"];
  if (isInRange) symbolClasses.push("in-range");
  const cellClasses = ["tour-row-cell"];
  if (isCursor) cellClasses.push("is-cursor");
  if (isInRange) cellClasses.push("in-range");
  // Issue #320: `tabIndex={-1}` keeps the button out of Tab order (the
  // keyboard `a` shortcut is the canonical keyboard path); `stopPropagation`
  // stops the cell's row-click handler from seeding the cursor before the
  // App-level annotate branch runs. Visibility is CSS-driven — see
  // `.tour-row-annotate-btn` in file-grid-css.
  const showAnnotateButton = onAnnotate !== undefined && lineNumber != null;
  const handleAnnotateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAnnotate && lineNumber != null) onAnnotate(side, lineNumber);
  };
  return (
    <>
      <span
        className={gutterClasses.join(" ")}
        data-side={side}
        data-line-number={lineNumber ?? ""}
      >
        {lineNumber ?? ""}
        {showAnnotateButton ? (
          <button
            type="button"
            className="tour-row-annotate-btn"
            tabIndex={-1}
            aria-label={`Add comment on line ${lineNumber}`}
            onClick={handleAnnotateClick}
          >
            +
          </button>
        ) : null}
      </span>
      <span className={symbolClasses.join(" ")} data-side={side} aria-hidden="true">
        {symbol}
      </span>
      <span className={cellClasses.join(" ")} data-side={side} onClick={onClick}>
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
// CSS only. Split layout has 6 tracks (gutter-L, symbol-L, code-L,
// gutter-R, symbol-R, code-R), so deletion cards span cols 1-3 and
// addition cards span cols 4-end.
function cardGridColumn(layout: Layout, side: Side): string {
  if (layout === "unified") return "1 / -1";
  return side === "deletions" ? "1 / 4" : "4 / -1";
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
   *  reducer. The component always passes `EXPANSION_STEP` — issue #280
   *  removed `expand-all` from the standalone `InteractiveSubKind`
   *  vocabulary (now hosted on the hunk-header banner's left cell). The
   *  Shift modifier carries no special meaning (PRD #270 Slice 5 / issue
   *  #275). */
  onActivate: (count: number) => void;
}

function InteractiveRowImpl(props: InteractiveRowProps): React.JSX.Element {
  const {
    subKind,
    boundaryRef,
    direction,
    glyph,
    isCursor,
    onActivate,
  } = props;
  const classes = ["tour-row", "tour-row-interactive"];
  if (isCursor) classes.push("is-cursor");
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActivate(EXPANSION_STEP);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isCursor) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    onActivate(EXPANSION_STEP);
  };
  return (
    <div
      className={classes.join(" ")}
      role="button"
      tabIndex={0}
      data-subkind={subKind}
      data-direction={direction}
      data-boundary-ref={String(boundaryRef)}
      style={BANNER_STYLE}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {glyph ? <span className="tour-row-glyph">{glyph}</span> : null}
    </div>
  );
}

export const InteractiveRow = memo(InteractiveRowImpl);

// ---------------------------------------------------------------------------
// <HunkHeaderBanner>
// ---------------------------------------------------------------------------

// Canonical hunk-header form: `@@ -a,b +c,d @@` followed optionally by a
// function-context tail (e.g. ` function foo() {`). The `,b` / `,d` count
// is optional (single-line hunks omit it). Planner emits the header with
// git's trailing newline, so we strip trailing whitespace before matching.
const HUNK_HEADER_REGEX =
  /^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)\s*(.*)$/;

export function parseHunkHeader(header: string): {
  range: string;
  context: string;
} {
  const trimmed = header.replace(/\s+$/, "");
  const m = HUNK_HEADER_REGEX.exec(trimmed);
  if (!m) return { range: trimmed, context: "" };
  return { range: m[1], context: m[2] };
}

export interface HunkHeaderBannerProps {
  header: string;
  boundaryRef: BoundaryRef;
  direction: "up" | "both";
  /** Issue #280: when set the banner's left cell is an interactive
   *  expand button. `"up"` paints `↑` and dispatches `direction: "up"`
   *  with `count = EXPANSION_STEP`; `"all"` paints `↕` and dispatches
   *  `direction: "both"` with `count = gapAbove`. `null` paints an inert
   *  `…` placeholder; the row is not cursor-walkable. */
  primaryExpand: "up" | "all" | null;
  /** Remaining hidden gap above this hunk-header. Threaded so the `all`
   *  dispatch can carry `count = gapAbove` (single-Enter full reveal). */
  gapAbove: number;
  /** `.is-cursor` outline applies when the cursor lands on this banner —
   *  reachable iff `primaryExpand !== null` (`flat-rows` skips banners
   *  with a null primaryExpand). */
  isCursor: boolean;
  /** Dispatches the expand action when the left cell is clicked or
   *  Enter is pressed while cursored. Called with `direction` (matching
   *  `primaryExpand`) and `count` (`EXPANSION_STEP` for "up", `gapAbove`
   *  for "all"). No-op when `primaryExpand === null`. */
  onActivate?: (direction: "up" | "both", count: number) => void;
}

// `data-subkind` derives from `boundaryRef`: `"top"` (file-top) maps to
// `"boundary-top"`, a numeric hunk-index maps to `"hunk-separator"`.
// Mirrors the `InteractiveSubKind` vocabulary so row-lookup selectors
// resolve banners alongside interactive rows.
function hunkHeaderSubKind(
  boundaryRef: BoundaryRef,
): "boundary-top" | "hunk-separator" {
  return boundaryRef === "top" ? "boundary-top" : "hunk-separator";
}

// Issue #280: two-cell banner matching GitHub's `@@` row structure.
//   Left cell  — ~44px, saturated `bg.accentEmphasis` background.
//                Carries the `↑` / `↕` glyph when `primaryExpand !== null`
//                AND `role="button"` / `tabIndex={0}` for click + Enter
//                dispatch. When `primaryExpand === null` paints an inert
//                `…` placeholder; no click target, no cursor walk.
//   Right cell — accent-subtle wash, range + function-context spans.
//                Always display-only (matches GitHub: clicking the `@@`
//                text does nothing).
// `.is-cursor` outlines the whole row when set (cursored hunk-headers
// only reach this branch when `primaryExpand !== null`; flat-rows skips
// banners with a null primaryExpand).
function HunkHeaderBannerImpl(
  props: HunkHeaderBannerProps,
): React.JSX.Element {
  const { header, boundaryRef, direction, primaryExpand, gapAbove, isCursor, onActivate } = props;
  const classes = ["tour-row", "tour-hunk-header"];
  if (isCursor) classes.push("is-cursor");
  const { range, context } = parseHunkHeader(header);
  const interactive = primaryExpand !== null;
  const buttonGlyph =
    primaryExpand === "up" ? "↑" : primaryExpand === "all" ? "↕" : "…";
  const dispatch = () => {
    if (!interactive || !onActivate) return;
    if (primaryExpand === "up") onActivate("up", EXPANSION_STEP);
    else onActivate("both", gapAbove);
  };
  const onButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch();
  };
  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (!isCursor || e.key !== "Enter") return;
    e.preventDefault();
    dispatch();
  };
  const buttonClasses = ["tour-hunk-header-button"];
  if (!interactive) buttonClasses.push("is-placeholder");
  return (
    <div
      className={classes.join(" ")}
      data-subkind={hunkHeaderSubKind(boundaryRef)}
      data-direction={direction}
      data-boundary-ref={String(boundaryRef)}
      data-primary-expand={primaryExpand ?? "none"}
      style={BANNER_STYLE}
    >
      <span
        className={buttonClasses.join(" ")}
        data-primary-expand={primaryExpand ?? "none"}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          primaryExpand === "up"
            ? "Expand Up"
            : primaryExpand === "all"
              ? `Expand All ${gapAbove} lines`
              : undefined
        }
        onClick={interactive ? onButtonClick : undefined}
        onKeyDown={interactive ? onButtonKeyDown : undefined}
      >
        {buttonGlyph}
      </span>
      <span className="tour-hunk-header-text">
        <span className="tour-hunk-header-range">{range}</span>
        {context ? (
          <span className="tour-hunk-header-context">{context}</span>
        ) : null}
      </span>
    </div>
  );
}

export const HunkHeaderBanner = memo(HunkHeaderBannerImpl);

// ---------------------------------------------------------------------------
// <ExpandDownStandalone>
// ---------------------------------------------------------------------------

export interface ExpandDownStandaloneProps {
  boundaryRef: BoundaryRef;
  /** `.is-cursor` outline applies when the cursor lands on this row. */
  isCursor: boolean;
  /** Dispatches the expand action on click / cursored-Enter. Always called
   *  with `EXPANSION_STEP` — Shift carries no special meaning (#275). The
   *  reducer clamps the step against the remaining gap. */
  onActivate: (count: number) => void;
}

// Issue #292: standalone `expand-down` row matches the hunk-header banner's
// two-cell layout — a 44px saturated `bg.accentEmphasis` button cell on the
// left + an empty `bg.accentSubtle.web` right cell. Mirrors GitHub's
// `tr.js-expandable-line` shape (same structure as the hunk-header banner;
// only the right cell's content differs — empty here, `@@ ...` text on the
// banner). Reuses `.tour-hunk-header` / `.tour-hunk-header-button` /
// `.tour-hunk-header-text` so the Down standalone row's button lines up
// vertically with the hunk-header banner's Up button in the mid-file
// large-gap case.
function ExpandDownStandaloneImpl(
  props: ExpandDownStandaloneProps,
): React.JSX.Element {
  const { boundaryRef, isCursor, onActivate } = props;
  const classes = ["tour-row", "tour-hunk-header"];
  if (isCursor) classes.push("is-cursor");
  const onButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActivate(EXPANSION_STEP);
  };
  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (!isCursor || e.key !== "Enter") return;
    e.preventDefault();
    onActivate(EXPANSION_STEP);
  };
  return (
    <div
      className={classes.join(" ")}
      data-subkind="expand-down"
      data-direction="down"
      data-boundary-ref={String(boundaryRef)}
      style={BANNER_STYLE}
    >
      <span
        className="tour-hunk-header-button"
        role="button"
        tabIndex={0}
        aria-label="Expand Down"
        onClick={onButtonClick}
        onKeyDown={onButtonKeyDown}
      >
        ↓
      </span>
      <span className="tour-hunk-header-text" />
    </div>
  );
}

export const ExpandDownStandalone = memo(ExpandDownStandaloneImpl);
