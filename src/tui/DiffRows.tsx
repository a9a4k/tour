import type { StyledText } from "@opentui/core";
import type {
  PlannedRow,
  DiffRow,
  InteractiveSubKind,
  BoundaryRef,
} from "../core/diff-rows.js";
import { theme } from "../core/theme.js";
import { CommentCard } from "./CommentCard.js";
import { commentCardSlot } from "./comment-placement.js";
import { DiffLine } from "./DiffLine.js";
import type { ReplyLock } from "../core/reply-lock.js";
import type { Cursor } from "../core/cursor-state.js";
import { textSelectionSafeActivation } from "./text-selection-gesture.js";

interface DiffRowsProps {
  fileName: string;
  rows: ReadonlyArray<PlannedRow>;
  layout: "split" | "unified";
  /** Comment id the unified cursor sits on, or null when the cursor is
   *  on a row / interactive / null. Drives the three-cue active treatment
   *  on the matching CommentCard (PRD #192 / ADR 0022 — same pixels as
   *  the prior `currentCommentId`, new meaning "cursor is here"). */
  cursorCardId: string | null;
  cursor?: Cursor | null;
  /** Mouse-click handler for cursor placement (issue #104). Side derivation
   *  is UI-coordinate-dependent and lives at the click site:
   *  - split: column index → side (left → deletions, right → additions);
   *    single-side rows force the populated side regardless of column.
   *  - unified: row type → side (deletion → deletions; addition / context
   *    → additions per CONTEXT.md convention).
   *  Hunk-header and comment rows do not invoke the handler. */
  onCursorClick?: (
    file: string,
    side: "additions" | "deletions",
    lineNumber: number,
  ) => void;
  /** Mouse-click handler for an interactive row (PRD #107). No `side`
   *  argument — interactive rows are addressed by `(file, subKind,
   *  boundaryRef)`. */
  onInteractiveClick?: (
    file: string,
    subKind: InteractiveSubKind,
    boundaryRef: BoundaryRef,
  ) => void;
  /** Mouse-click handler for a comment card (issue #261). ADR 0022
   *  unified the cursor — CardAnchor is first-class — so clicking a card
   *  must place the cursor on it, mirroring the webapp's
   *  `setCursorFromCardClick`. In split layout, only the half hosting
   *  the card carries the handler; the empty sibling stays a no-op.
   *  Clicks on replies nested inside the card flow up to the same
   *  wrapper handler — the cursor walks top-level comments only. */
  onCardClick?: (commentId: string) => void;
  /** PRD #397 / ADR 0038. Mouse-click toggle for a Card's header
   *  chevron (`▾` expanded / `▸` collapsed). Threaded to CommentCard
   *  as `onToggleCollapse`; the App-side handler dispatches
   *  `thread.toggle` on the parent's id (the chevron lives on the
   *  top-level Comment, no Reply normalisation needed). */
  onCardToggleCollapse?: (commentId: string) => void;
  editingTargetId?: string | null;
  editingBody?: string;
  editingSubmitting?: boolean;
  editingError?: string | null;
  onEditInput?: (body: string) => void;
  onEditSubmit?: () => void;
  /** PRD #397 / ADR 0038. Top-level Comment ids the user has minimised
   *  to a one-liner via per-Thread `Enter` (or the header chevron).
   *  Threaded into each CommentCard so the Card paints the one-liner
   *  shape when its parent id is in the set. */
  collapsedThreads?: ReadonlySet<string>;
  replyLock?: ReplyLock | null;
  now?: number;
  /** 1-based nav-order index per top-level comment id, for the `i / n`
   *  counter in each CommentCard header. */
  navIndexById?: ReadonlyMap<string, number>;
  navTotal?: number;
  /** Issue #305: focus-aware cursor. `true` when the diff pane holds focus
   *  → cursored rows paint the bright `cursorRow.tui` + `❯` glyph; for
   *  hunk-header / `expand-down` banners the focus tint paints on the
   *  right cell (issue #379), not the saturated button cell. `false`
   *  when the sidebar has focus → dim `accentCursor.tui` + no glyph.
   *  Defaults to `true` so test callers and pre-#305 fixtures see the
   *  historic bright treatment. */
  paneFocused?: boolean;
  /** Issue #376: per-source-line styled output from
   *  `useTuiHighlight(oldContent, deletionsLang)`. One `StyledText`
   *  per source line (1-indexed via `leftLineNumber`). `null` until
   *  tokenisation resolves, then a complete array. Looked up by the
   *  row's `leftLineNumber` and passed down as `styledLine` on
   *  the deletions-side `DiffLine`. */
  stylesLeft?: ReadonlyArray<StyledText> | null;
  /** Companion to `stylesLeft` for the additions side. Looked up by
   *  the row's `rightLineNumber`. */
  stylesRight?: ReadonlyArray<StyledText> | null;
}

const LINE_NUMBER_WIDTH = 5;

function pad(n: number | null): string {
  if (n === null) return " ".repeat(LINE_NUMBER_WIDTH);
  return String(n).padStart(LINE_NUMBER_WIDTH, " ");
}

function unifiedSign(row: DiffRow): string {
  switch (row.type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}

// Issue #257 — per-side sign for split layout. Mirrors `unifiedSign`'s
// vocabulary (`+` / `-` / blank) but resolves the sign from the row's
// type + which side carries content, because in split layout the
// planner emits both pure adds and pure dels as `type: "change"` and
// the populated side (left vs right line number) discriminates them.
// Context rows render a blank sign on both sides.
function splitSign(row: DiffRow, side: "left" | "right"): string {
  if (row.type !== "change") return " ";
  if (side === "left") return row.leftLineNumber !== null ? "-" : " ";
  return row.rightLineNumber !== null ? "+" : " ";
}

function splitGutter(lineNumber: number | null, sign: string): string {
  return `${pad(lineNumber)} ${sign} `;
}

function unifiedGutter(row: DiffRow): string {
  return `${pad(row.leftLineNumber)} ${pad(row.rightLineNumber)} ${unifiedSign(row)} `;
}

function rowId(file: string, side: "additions" | "deletions", lineNumber: number): string {
  return `diff-row-${file}-${side}-${lineNumber}`;
}

function interactiveRowId(
  file: string,
  subKind: InteractiveSubKind,
  boundaryRef: BoundaryRef,
): string {
  return `interactive-row-${file}-${subKind}-${boundaryRef}`;
}

// Issue #280: hunk-header banner cursor id mirrors the flat-rows
// projection — file-top banner uses `boundary-top`, mid-file uses
// `hunk-separator`.
function hunkHeaderRowId(
  file: string,
  hunkIndex: number,
): string {
  const subKind: InteractiveSubKind =
    hunkIndex === 0 ? "boundary-top" : "hunk-separator";
  const boundaryRef: BoundaryRef = hunkIndex === 0 ? "top" : hunkIndex;
  return interactiveRowId(file, subKind, boundaryRef);
}

// Match the split-side gutter footprint (LINE_NUMBER_WIDTH + " " + sign
// + " " — post-#257) so the interactive row's text aligns with the diff
// column on its right.
const INTERACTIVE_PAD_GUTTER = " ".repeat(LINE_NUMBER_WIDTH + 3);

// Issue #380: the hunk-header banner + standalone expand-down button
// cell widens from a fixed 5-cell footprint to the gutter-aligned
// footprint of the adjacent diff rows. The button cell occupies the
// pre-content column block — 1-cell accent stripe + gutter text —
// so the right cell starts at the same column as the diff code in
// the surrounding DiffLine rows.
//
//   split   = 1 (stripe) + LINE_NUMBER_WIDTH + " " + sign + " "  = 9
//   unified = 1 (stripe) + LINE_NUMBER_WIDTH + " " + LINE_NUMBER_WIDTH
//             + " " + sign + " "                                  = 15
//
// Expressed in terms of LINE_NUMBER_WIDTH so the alignment stays
// correct if the gutter format ever changes.
function buttonCellWidth(layout: "split" | "unified"): number {
  return layout === "split"
    ? 1 + LINE_NUMBER_WIDTH + 3
    : 1 + LINE_NUMBER_WIDTH * 2 + 4;
}

// Issue #280: hunk-header banner left-cell glyph. `↑` for `primaryExpand`
// = "up", `↕` for "all".
function hunkHeaderGlyph(primaryExpand: "up" | "all"): string {
  return primaryExpand === "up" ? "↑" : "↕";
}

function splitClickTarget(
  row: DiffRow,
  column: "left" | "right",
): { side: "additions" | "deletions"; lineNumber: number } | null {
  // Paired row: column maps directly to its side.
  if (row.leftLineNumber !== null && row.rightLineNumber !== null) {
    return column === "left"
      ? { side: "deletions", lineNumber: row.leftLineNumber }
      : { side: "additions", lineNumber: row.rightLineNumber };
  }
  // Single-side row: both columns force the populated side.
  if (row.leftLineNumber !== null) return { side: "deletions", lineNumber: row.leftLineNumber };
  if (row.rightLineNumber !== null) return { side: "additions", lineNumber: row.rightLineNumber };
  return null;
}

function unifiedClickTarget(
  row: DiffRow,
): { side: "additions" | "deletions"; lineNumber: number } | null {
  // Row type → side. Pure deletion rows address the deletions side;
  // addition / context rows address the additions side (CONTEXT.md).
  if (row.type === "deletion" && row.leftLineNumber !== null) {
    return { side: "deletions", lineNumber: row.leftLineNumber };
  }
  if (row.rightLineNumber !== null) {
    return { side: "additions", lineNumber: row.rightLineNumber };
  }
  return null;
}

export function DiffRows({
  fileName,
  rows,
  layout,
  cursorCardId,
  cursor,
  onCursorClick,
  onInteractiveClick,
  onCardClick,
  onCardToggleCollapse,
  editingTargetId,
  editingBody,
  editingSubmitting,
  editingError,
  onEditInput,
  onEditSubmit,
  collapsedThreads,
  replyLock,
  now,
  navIndexById,
  navTotal,
  paneFocused = true,
  stylesLeft,
  stylesRight,
}: DiffRowsProps) {
  // Narrow once: row-shaped cursor is the only kind that drives the per-
  // row outline. A CardAnchor's per-card outline is handled by
  // `cursorCardId` on the CommentCard side.
  const rowCursor = cursor && cursor.kind === "row" ? cursor : null;

  function styledFor(
    styles: ReadonlyArray<StyledText> | null | undefined,
    lineNumber: number | null,
  ): StyledText | undefined {
    if (!styles || lineNumber === null) return undefined;
    return styles[lineNumber - 1];
  }

  return (
    <>
      {rows.map((row, idx) => {
        const key = `r-${idx}`;
        if (row.kind === "hunk-header") {
          // Issue #280: two-cell banner mirroring the webapp. Left cell
          // hosts the primary expand affordance (`↑` / `↕`) with
          // saturated `bg.accentEmphasis` background; right cell hosts
          // the muted `@@` text. The whole row is cursor-walkable
          // (flat-rows projects to `boundary-top` / `hunk-separator`);
          // cursor signal paints on the right cell (issue #379). Issue
          // #359: the planner skips emission at `gapAbove === 0`, so
          // every hunk-header row reaching this renderer is interactive.
          //
          // `height={1}` on the inner `<text>` glyph + `<text>` header
          // defends against wrap-induced sibling stretch. The right cell
          // can host a long `@@` context (e.g.
          // `@@ -172,9 +170,10 @@ export function App({ … })`); when
          // the file card's available width is narrow enough, the
          // default `wrapMode="word"` wraps that text to 2 visual rows,
          // and Yoga's default `alignItems: stretch` on the row-direction
          // parent stretches the button cell to match — banner ends up
          // visually 2 rows tall for a single planned row. Pinning each
          // text's height to 1 clips the overflow vertically and keeps
          // the banner at 1 grid row regardless of `@@` length or
          // viewport width. `wrapMode="none"` is a viable alternative
          // (clips horizontally instead) but `height={1}` is the same
          // workaround DiffLine.tsx uses, so we match it for parity.
          // Repro verified in-session: a banner with a ~95-char `@@`
          // header inside a single-bordered file card at 100-col
          // viewport wraps to 2 rows by default; either fix pins it.
          const cursorActive =
            rowCursor != null &&
            rowCursor.file === fileName &&
            rowCursor.interactive != null &&
            (rowCursor.interactive.subKind === "boundary-top" ||
              rowCursor.interactive.subKind === "hunk-separator") &&
            rowCursor.interactive.boundaryRef ===
              (row.hunkIndex === 0 ? "top" : row.hunkIndex);
          const id = hunkHeaderRowId(fileName, row.hunkIndex);
          const mouseHandlers = onInteractiveClick
            ? textSelectionSafeActivation(() =>
                onInteractiveClick(
                  fileName,
                  row.hunkIndex === 0 ? "boundary-top" : "hunk-separator",
                  row.hunkIndex === 0 ? "top" : row.hunkIndex,
                ),
              )
            : undefined;
          // Issue #379: focus tint lives on the right (text) cell, not
          // the saturated button cell. The button stays `accentEmphasis`
          // in every state so it never visually dims on cursor. The
          // right cell flips from its uncursored `accentSubtle.tui` to
          // `cursorRow.tui` (cursored + diff pane focused) or
          // `accentCursor.tui` (cursored + sidebar parked) — same
          // focus-aware token pair the regular diff rows use, mirroring
          // the webapp's "row lights up on the right; button stays
          // bright" decision from #305.
          const buttonBg = theme.bg.accentEmphasis;
          const textBg = cursorActive
            ? (paneFocused ? theme.bg.cursorRow.tui : theme.bg.accentCursor.tui)
            : theme.bg.accentSubtle.tui;
          return (
            <box
              key={key}
              id={id}
              flexDirection="row"
              width="100%"
              onMouseDown={mouseHandlers?.onMouseDown}
              onMouseDrag={mouseHandlers?.onMouseDrag}
              onMouseUp={mouseHandlers?.onMouseUp}
            >
              <box
                flexShrink={0}
                width={buttonCellWidth(layout)}
                alignItems="center"
                backgroundColor={buttonBg}
              >
                <text height={1} fg={theme.fg.onEmphasis} selectable={false}>
                  {hunkHeaderGlyph(row.primaryExpand)}
                </text>
              </box>
              <box flexGrow={1} backgroundColor={textBg}>
                <text height={1} fg={theme.fg.muted}>{row.header}</text>
              </box>
            </box>
          );
        }
        if (row.kind === "interactive") {
          const cursorActive =
            rowCursor != null &&
            rowCursor.file === fileName &&
            rowCursor.interactive != null &&
            rowCursor.interactive.subKind === row.subKind &&
            rowCursor.interactive.boundaryRef === row.boundaryRef;
          const id = interactiveRowId(fileName, row.subKind, row.boundaryRef);
          const mouseHandlers = onInteractiveClick
            ? textSelectionSafeActivation(() =>
                onInteractiveClick(fileName, row.subKind, row.boundaryRef),
              )
            : undefined;
          // Issue #292: standalone `expand-down` row mirrors the
          // hunk-header banner's two-cell layout — saturated button
          // cell carrying `↓` + empty right cell. Issue #380 widened
          // the button cell to the gutter footprint (split = 9,
          // unified = 15) so the right cell starts at the same
          // column as the diff code in adjacent rows. `height={1}` on
          // the inner `<text>` glyph defensively pins the cell to 1
          // grid row — same shape as the hunk-header banner above;
          // see that comment. The right cell is empty so wrap can't
          // fire here, but matching the banner keeps the pattern
          // consistent if someone later puts text in this cell.
          if (row.subKind === "expand-down") {
            // Issue #379: focus tint lives on the (empty) right cell,
            // not the button. Button stays `accentEmphasis` always; the
            // right cell flips to `cursorRow.tui` / `accentCursor.tui`
            // on cursor + focus, mirroring the hunk-header banner.
            const buttonBg = theme.bg.accentEmphasis;
            const textBg = cursorActive
              ? (paneFocused ? theme.bg.cursorRow.tui : theme.bg.accentCursor.tui)
              : theme.bg.accentSubtle.tui;
            return (
              <box
                key={key}
                id={id}
                flexDirection="row"
                width="100%"
                onMouseDown={mouseHandlers?.onMouseDown}
                onMouseDrag={mouseHandlers?.onMouseDrag}
                onMouseUp={mouseHandlers?.onMouseUp}
              >
                <box
                  flexShrink={0}
                  width={buttonCellWidth(layout)}
                  alignItems="center"
                  backgroundColor={buttonBg}
                >
                  <text height={1} fg={theme.fg.onEmphasis} selectable={false}>↓</text>
                </box>
                <box flexGrow={1} backgroundColor={textBg} />
              </box>
            );
          }
          // Interactive row visual (ADR 0013): cursor's `❯` glyph + gutter
          // bg in the line-number column on the active side, consistent
          // with the diff-row treatment. The text body (e.g. "··· N
          // hidden ···") comes from the planner.
          return (
            <box
              key={key}
              id={id}
              width="100%"
              onMouseDown={mouseHandlers?.onMouseDown}
              onMouseDrag={mouseHandlers?.onMouseDrag}
              onMouseUp={mouseHandlers?.onMouseUp}
            >
              <DiffLine
                gutter={INTERACTIVE_PAD_GUTTER}
                text={row.text ?? ""}
                gutterTinted={false}
                contentTinted={false}
                gutterAccent={false}
                cursorActive={cursorActive}
                paneFocused={paneFocused}
                width="100%"
              />
            </box>
          );
        }
        if (row.kind === "comment") {
          const slot = commentCardSlot(layout, row.comment.side);
          // ADR 0037 — the Card chrome lights up whenever the cursor sits
          // on any node in the Thread (parent or Reply). `activeNodeId`
          // narrows the within-Card `●` glyph + reply chrome to the
          // specific cursored node.
          const isCurrent =
            cursorCardId !== null &&
            (cursorCardId === row.comment.id ||
              row.replies.some((r) => r.id === cursorCardId));
          const card = (
            <CommentCard
              key={`ann-${row.id}`}
              comment={row.comment}
              isCurrent={isCurrent}
              activeNodeId={isCurrent ? cursorCardId : null}
              replies={row.replies}
              collapsed={collapsedThreads?.has(row.comment.id) ?? false}
              replyLock={replyLock}
              now={now}
              navIndex={navIndexById?.get(row.comment.id) ?? null}
              navTotal={navTotal ?? 0}
              onToggleCollapse={onCardToggleCollapse}
              editingTargetId={editingTargetId}
              editingBody={editingBody}
              editingSubmitting={editingSubmitting}
              editingError={editingError}
              onEditInput={onEditInput}
              onEditSubmit={onEditSubmit}
            />
          );
          // Issue #261: click anywhere on the card (or a nested reply)
          // bubbles to this wrapper's onMouseDown, dispatching the
          // top-level comment id to onCardClick. ADR 0022's cursor
          // walks top-level comments only, so the row's `id` (the
          // top-level comment id, not a reply id) is the right value.
          const cardMouseHandlers = onCardClick
            ? textSelectionSafeActivation(() => onCardClick(row.comment.id))
            : undefined;
          if (slot === "full") {
            // Unified layout: wrap the card so the wrapper can carry the
            // click handler. Function-component cards can't host
            // `onMouseDown` directly under OpenTUI.
            return (
              <box
                key={`ann-${row.id}`}
                width="100%"
                onMouseDown={cardMouseHandlers?.onMouseDown}
                onMouseDrag={cardMouseHandlers?.onMouseDrag}
                onMouseUp={cardMouseHandlers?.onMouseUp}
              >
                {card}
              </box>
            );
          }
          // Split layout: match the per-row split shape (two 50% cells)
          // so the card lines up with the diff column it discusses.
          // Empty sibling reserves the opposite half so subsequent rows
          // keep their column alignment — and stays a no-op on click.
          return (
            <box key={`ann-${row.id}`} flexDirection="row" width="100%">
              <box
                width="50%"
                onMouseDown={slot === "left" ? cardMouseHandlers?.onMouseDown : undefined}
                onMouseDrag={slot === "left" ? cardMouseHandlers?.onMouseDrag : undefined}
                onMouseUp={slot === "left" ? cardMouseHandlers?.onMouseUp : undefined}
              >
                {slot === "left" ? card : null}
              </box>
              <box
                width="50%"
                onMouseDown={slot === "right" ? cardMouseHandlers?.onMouseDown : undefined}
                onMouseDrag={slot === "right" ? cardMouseHandlers?.onMouseDrag : undefined}
                onMouseUp={slot === "right" ? cardMouseHandlers?.onMouseUp : undefined}
              >
                {slot === "right" ? card : null}
              </box>
            </box>
          );
        }

        const cursorOnFile =
          rowCursor != null && rowCursor.file === fileName ? rowCursor : null;
        const leftCursorActive =
          cursorOnFile != null &&
          cursorOnFile.side === "deletions" &&
          cursorOnFile.lineNumber === row.leftLineNumber;
        const rightCursorActive =
          cursorOnFile != null &&
          cursorOnFile.side === "additions" &&
          cursorOnFile.lineNumber === row.rightLineNumber;

        if (layout === "split") {
          // Content tint only when both sides have a line number — i.e. a
          // context-paired row. One-sided rows (additions / deletions inside
          // a change block) keep their content un-tinted so the +/- structural
          // signal survives. ADR 0008.
          const paired = row.leftLineNumber !== null && row.rightLineNumber !== null;
          // Diff +/- bg (issue #74). A change row's left side is a deletion
          // and its right side is an addition; an empty side (null line
          // number) gets no bg so the empty cell stays blank.
          const leftDiffBg =
            row.type === "change" && row.leftLineNumber !== null ? "deletion" : undefined;
          const rightDiffBg =
            row.type === "change" && row.rightLineNumber !== null ? "addition" : undefined;
          // Empty-side neutral fill (issue #260). On single-side change
          // rows the side with no line number recedes behind canvas via
          // theme.canvas.inset — webapp #227 parity. Context rows have
          // both sides populated; paired-change rows have both sides
          // populated; only pure-add / pure-del trip this flag.
          const leftEmptySide = row.type === "change" && row.leftLineNumber === null;
          const rightEmptySide = row.type === "change" && row.rightLineNumber === null;
          const leftId =
            row.leftLineNumber !== null ? rowId(fileName, "deletions", row.leftLineNumber) : undefined;
          const rightId =
            row.rightLineNumber !== null ? rowId(fileName, "additions", row.rightLineNumber) : undefined;
          const leftClick = splitClickTarget(row, "left");
          const rightClick = splitClickTarget(row, "right");
          const leftMouseHandlers =
            onCursorClick && leftClick
              ? textSelectionSafeActivation(() =>
                  onCursorClick(fileName, leftClick.side, leftClick.lineNumber),
                )
              : undefined;
          const rightMouseHandlers =
            onCursorClick && rightClick
              ? textSelectionSafeActivation(() =>
                  onCursorClick(fileName, rightClick.side, rightClick.lineNumber),
                )
              : undefined;
          // Issue #267 — flexDirection="row" on each 50%-width half
          // wrapper. The wrapper hosts a single DiffLine child; swapping
          // the wrapper's main axis from column to row leaves child
          // placement structurally unchanged but flips alignItems=stretch
          // (default) onto the cross axis = vertical. When the sibling
          // half wraps to N visual rows, the outer split-row container
          // stretches both wrappers to N rows tall; with row-direction
          // wrappers, that height is now transmitted to the DiffLine's
          // outer <box>, whose internal sub-boxes (accent stripe, gutter
          // bg, content-bg wrapper) already escape its own
          // alignItems="flex-start" via alignSelf="stretch" — so every
          // bg layer paints across the wrapped rows and the empty half
          // no longer leaves a black gap below visual row 1.
          return (
            <box key={key} flexDirection="row" width="100%" minHeight={1}>
              <box
                id={leftId}
                width="50%"
                flexDirection="row"
                onMouseDown={leftMouseHandlers?.onMouseDown}
                onMouseDrag={leftMouseHandlers?.onMouseDrag}
                onMouseUp={leftMouseHandlers?.onMouseUp}
              >
                <DiffLine
                  gutter={splitGutter(row.leftLineNumber, splitSign(row, "left"))}
                  text={row.leftText}
                  gutterTinted={!!row.leftTinted}
                  contentTinted={!!row.leftTinted && paired}
                  gutterAccent={!!row.leftGutter}
                  diffBg={leftDiffBg}
                  emptySide={leftEmptySide}
                  cursorActive={leftCursorActive}
                  paneFocused={paneFocused}
                  styledLine={styledFor(stylesLeft, row.leftLineNumber)}
                  width="100%"
                />
              </box>
              {/* Issue #258 / #269 — terminal-native equivalent of the
                  webapp #251 vertical rule between the deletions and
                  additions halves. A 1-cell-wide `alignSelf="stretch"`
                  box painted in `theme.border.muted` via
                  `backgroundColor`. Same paint mechanism as the
                  comment accent stripe inside `DiffLine` — bg on
                  a stretched box (no glyph child) so the column
                  fills the row's full visual height through wraps.
                  Pre-#269 this was a single `│` text glyph, which
                  rendered only on visual row 1 of a wrapped row and
                  left N − 1 cells of unpainted terminal background
                  below. Banner rows (hunk-header, interactive) take
                  the full-width branch and skip this composition,
                  so the rule naturally breaks at each banner. */}
              <box
                width={1}
                alignSelf="stretch"
                flexShrink={0}
                backgroundColor={theme.border.muted}
              />
              <box
                id={rightId}
                width="50%"
                flexDirection="row"
                onMouseDown={rightMouseHandlers?.onMouseDown}
                onMouseDrag={rightMouseHandlers?.onMouseDrag}
                onMouseUp={rightMouseHandlers?.onMouseUp}
              >
                <DiffLine
                  gutter={splitGutter(row.rightLineNumber, splitSign(row, "right"))}
                  text={row.rightText}
                  gutterTinted={!!row.rightTinted}
                  contentTinted={!!row.rightTinted && paired}
                  gutterAccent={!!row.rightGutter}
                  diffBg={rightDiffBg}
                  emptySide={rightEmptySide}
                  cursorActive={rightCursorActive}
                  paneFocused={paneFocused}
                  styledLine={styledFor(stylesRight, row.rightLineNumber)}
                  width="100%"
                />
              </box>
            </box>
          );
        }

        const text = row.type === "deletion" ? row.leftText : row.rightText;
        const isPlusMinus = row.type === "addition" || row.type === "deletion";
        const unifiedDiffBg = isPlusMinus ? row.type : undefined;
        // Unified rows show one source-of-truth line per row: the
        // deletion row pulls from the old (left) content; addition and
        // context rows pull from the new (right) content. Mirror the
        // text-selection logic to pick the right styled line.
        const unifiedStyledLine = row.type === "deletion"
          ? styledFor(stylesLeft, row.leftLineNumber)
          : styledFor(stylesRight, row.rightLineNumber);
        // Unified rows have one DiffLine; the cursor visual lights up
        // whenever the cursor matches either side (a unified context row
        // can be addressed from either side; pure +/- rows force their
        // populated side).
        const unifiedCursorActive = leftCursorActive || rightCursorActive;
        const unifiedTarget = unifiedClickTarget(row);
        const unifiedRowId = unifiedTarget
          ? rowId(fileName, unifiedTarget.side, unifiedTarget.lineNumber)
          : undefined;
        const unifiedMouseHandlers =
          onCursorClick && unifiedTarget
            ? textSelectionSafeActivation(() =>
                onCursorClick(fileName, unifiedTarget.side, unifiedTarget.lineNumber),
              )
            : undefined;
        return (
          <box
            key={key}
            id={unifiedRowId}
            width="100%"
            onMouseDown={unifiedMouseHandlers?.onMouseDown}
            onMouseDrag={unifiedMouseHandlers?.onMouseDrag}
            onMouseUp={unifiedMouseHandlers?.onMouseUp}
          >
            <DiffLine
              gutter={unifiedGutter(row)}
              text={text}
              gutterTinted={!!row.rightTinted}
              contentTinted={!!row.rightTinted && !isPlusMinus}
              gutterAccent={!!row.rightGutter}
              diffBg={unifiedDiffBg}
              cursorActive={unifiedCursorActive}
              paneFocused={paneFocused}
              styledLine={unifiedStyledLine}
              width="100%"
            />
          </box>
        );
      })}
    </>
  );
}
