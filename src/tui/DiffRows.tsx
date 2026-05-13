import type {
  PlannedRow,
  DiffRow,
  InteractiveSubKind,
  BoundaryRef,
} from "../core/diff-rows.js";
import { GAP_TWO_ROW_THRESHOLD } from "../core/diff-rows.js";
import { theme } from "../core/theme.js";
import { AnnotationCard } from "./AnnotationCard.js";
import { annotationCardSlot } from "./annotation-placement.js";
import { DiffLine } from "./DiffLine.js";
import { getSyntaxStyle, inferFiletype } from "./syntax.js";
import type { ReplyLock } from "../core/reply-lock.js";
import type { Cursor } from "../core/cursor-state.js";

interface DiffRowsProps {
  fileName: string;
  rows: ReadonlyArray<PlannedRow>;
  layout: "split" | "unified";
  /** Annotation id the unified cursor sits on, or null when the cursor is
   *  on a row / interactive / null. Drives the three-cue active treatment
   *  on the matching AnnotationCard (PRD #192 / ADR 0022 — same pixels as
   *  the prior `currentAnnotationId`, new meaning "cursor is here"). */
  cursorCardId: string | null;
  cursor?: Cursor | null;
  /** Mouse-click handler for cursor placement (issue #104). Side derivation
   *  is UI-coordinate-dependent and lives at the click site:
   *  - split: column index → side (left → deletions, right → additions);
   *    single-side rows force the populated side regardless of column.
   *  - unified: row type → side (deletion → deletions; addition / context
   *    → additions per CONTEXT.md convention).
   *  Hunk-header and annotation rows do not invoke the handler. */
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
  repliesCollapsed?: boolean;
  replyLock?: ReplyLock | null;
  now?: number;
  /** 1-based nav-order index per top-level annotation id, for the `i / n`
   *  counter in each AnnotationCard header. */
  navIndexById?: ReadonlyMap<string, number>;
  navTotal?: number;
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

// Match the split-side gutter footprint (LINE_NUMBER_WIDTH + " " + sign
// + " " — post-#257) so the interactive row's text aligns with the diff
// column on its right.
const INTERACTIVE_PAD_GUTTER = " ".repeat(LINE_NUMBER_WIDTH + 3);

// Issue #258 — terminal-native equivalent of the webapp #251 vertical
// rule between the deletions and additions halves. `│` (U+2502 BOX
// DRAWINGS LIGHT VERTICAL) painted in `theme.border.muted` — same token
// the webapp picked for parity, and a lighter weight than the
// file-block's outer border so the inner divider doesn't compete.
// Banner rows (hunk-header, interactive) take the full-width branch and
// skip this composition entirely, so the rule naturally breaks at each
// banner — matches GitHub.
const DIVIDER_GLYPH = "│";

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
  repliesCollapsed,
  replyLock,
  now,
  navIndexById,
  navTotal,
}: DiffRowsProps) {
  // Narrow once: row-shaped cursor is the only kind that drives the per-
  // row outline. A CardAnchor's per-card outline is handled by
  // `cursorCardId` on the AnnotationCard side.
  const rowCursor = cursor && cursor.kind === "row" ? cursor : null;
  const filetype = inferFiletype(fileName);
  const syntaxStyle = getSyntaxStyle();

  return (
    <>
      {rows.map((row, idx) => {
        const key = `r-${idx}`;
        if (row.kind === "hunk-header") {
          const interactive = row.gapAbove > 0;
          if (!interactive) {
            return (
              <text key={key} fg={theme.fg.muted}>
                {row.header}
              </text>
            );
          }
          // Promoted to first-class interactive row (PRD #151, ADR 0018).
          // Direction glyph per D1 (row position == end of gap):
          //   hunkIndex===0 → `↑` (file-top, lines reveal toward line 1)
          //   gapAbove > 2N → `↓` (mid-file large, paired with gap-mid-top above)
          //   else          → `↕` (mid-file small, symmetric)
          const isFirstHunk = row.hunkIndex === 0;
          let glyph: "↑" | "↓" | "↕";
          if (isFirstHunk) glyph = "↑";
          else if (row.gapAbove > GAP_TWO_ROW_THRESHOLD) glyph = "↓";
          else glyph = "↕";
          const text = `${row.header} ${glyph} ··· ${row.gapAbove} hidden ···`;
          const subKind: InteractiveSubKind = isFirstHunk
            ? "boundary-top"
            : "hunk-separator";
          const boundaryRef: BoundaryRef = isFirstHunk ? "top" : row.hunkIndex;
          const cursorActive =
            rowCursor != null &&
            rowCursor.file === fileName &&
            rowCursor.interactive != null &&
            rowCursor.interactive.subKind === subKind &&
            rowCursor.interactive.boundaryRef === boundaryRef;
          const id = interactiveRowId(fileName, subKind, boundaryRef);
          const onMouseDown = onInteractiveClick
            ? () => onInteractiveClick(fileName, subKind, boundaryRef)
            : undefined;
          return (
            <box key={key} id={id} width="100%" onMouseDown={onMouseDown}>
              <DiffLine
                gutter={INTERACTIVE_PAD_GUTTER}
                text={text}
                gutterTinted={false}
                contentTinted={false}
                gutterAccent={false}
                cursorActive={cursorActive}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                mutedText
                width="100%"
              />
            </box>
          );
        }
        if (row.kind === "interactive") {
          // Interactive row visual (ADR 0013): cursor's `❯` glyph + gutter
          // bg in the line-number column on the active side, consistent
          // with the diff-row treatment. The text body (e.g. "··· N
          // hidden ···") comes from the planner.
          const cursorActive =
            rowCursor != null &&
            rowCursor.file === fileName &&
            rowCursor.interactive != null &&
            rowCursor.interactive.subKind === row.subKind &&
            rowCursor.interactive.boundaryRef === row.boundaryRef;
          const id = interactiveRowId(fileName, row.subKind, row.boundaryRef);
          const onMouseDown = onInteractiveClick
            ? () => onInteractiveClick(fileName, row.subKind, row.boundaryRef)
            : undefined;
          return (
            <box key={key} id={id} width="100%" onMouseDown={onMouseDown}>
              <DiffLine
                gutter={INTERACTIVE_PAD_GUTTER}
                text={row.text ?? ""}
                gutterTinted={false}
                contentTinted={false}
                gutterAccent={false}
                cursorActive={cursorActive}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                width="100%"
              />
            </box>
          );
        }
        if (row.kind === "annotation") {
          const slot = annotationCardSlot(layout, row.annotation.side);
          const card = (
            <AnnotationCard
              key={`ann-${row.id}`}
              annotation={row.annotation}
              isCurrent={row.id === cursorCardId}
              replies={row.replies}
              repliesCollapsed={repliesCollapsed}
              replyLock={replyLock}
              now={now}
              navIndex={navIndexById?.get(row.annotation.id) ?? null}
              navTotal={navTotal ?? 0}
            />
          );
          if (slot === "full") return card;
          // Match the per-row split shape (two 50% cells) so the card lines
          // up with the diff column it discusses. Empty sibling reserves the
          // opposite half so subsequent rows keep their column alignment.
          return (
            <box key={`ann-${row.id}`} flexDirection="row" width="100%">
              <box width="50%">{slot === "left" ? card : null}</box>
              <box width="50%">{slot === "right" ? card : null}</box>
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
          const leftId =
            row.leftLineNumber !== null ? rowId(fileName, "deletions", row.leftLineNumber) : undefined;
          const rightId =
            row.rightLineNumber !== null ? rowId(fileName, "additions", row.rightLineNumber) : undefined;
          const leftClick = splitClickTarget(row, "left");
          const rightClick = splitClickTarget(row, "right");
          const onLeftMouseDown =
            onCursorClick && leftClick
              ? () => onCursorClick(fileName, leftClick.side, leftClick.lineNumber)
              : undefined;
          const onRightMouseDown =
            onCursorClick && rightClick
              ? () => onCursorClick(fileName, rightClick.side, rightClick.lineNumber)
              : undefined;
          return (
            <box key={key} flexDirection="row" width="100%" minHeight={1}>
              <box id={leftId} width="50%" onMouseDown={onLeftMouseDown}>
                <DiffLine
                  gutter={splitGutter(row.leftLineNumber, splitSign(row, "left"))}
                  text={row.leftText}
                  gutterTinted={!!row.leftTinted}
                  contentTinted={!!row.leftTinted && paired}
                  gutterAccent={!!row.leftGutter}
                  diffBg={leftDiffBg}
                  cursorActive={leftCursorActive}
                  filetype={filetype}
                  syntaxStyle={syntaxStyle}
                  width="100%"
                />
              </box>
              <box width={1} alignSelf="stretch" flexShrink={0}>
                <text fg={theme.border.muted}>{DIVIDER_GLYPH}</text>
              </box>
              <box id={rightId} width="50%" onMouseDown={onRightMouseDown}>
                <DiffLine
                  gutter={splitGutter(row.rightLineNumber, splitSign(row, "right"))}
                  text={row.rightText}
                  gutterTinted={!!row.rightTinted}
                  contentTinted={!!row.rightTinted && paired}
                  gutterAccent={!!row.rightGutter}
                  diffBg={rightDiffBg}
                  cursorActive={rightCursorActive}
                  filetype={filetype}
                  syntaxStyle={syntaxStyle}
                  width="100%"
                />
              </box>
            </box>
          );
        }

        const text = row.type === "deletion" ? row.leftText : row.rightText;
        const isPlusMinus = row.type === "addition" || row.type === "deletion";
        const unifiedDiffBg = isPlusMinus ? row.type : undefined;
        // Unified rows have one DiffLine; the cursor visual lights up
        // whenever the cursor matches either side (a unified context row
        // can be addressed from either side; pure +/- rows force their
        // populated side).
        const unifiedCursorActive = leftCursorActive || rightCursorActive;
        const unifiedTarget = unifiedClickTarget(row);
        const unifiedRowId = unifiedTarget
          ? rowId(fileName, unifiedTarget.side, unifiedTarget.lineNumber)
          : undefined;
        const onUnifiedMouseDown =
          onCursorClick && unifiedTarget
            ? () => onCursorClick(fileName, unifiedTarget.side, unifiedTarget.lineNumber)
            : undefined;
        return (
          <box key={key} id={unifiedRowId} width="100%" onMouseDown={onUnifiedMouseDown}>
            <DiffLine
              gutter={unifiedGutter(row)}
              text={text}
              gutterTinted={!!row.rightTinted}
              contentTinted={!!row.rightTinted && !isPlusMinus}
              gutterAccent={!!row.rightGutter}
              diffBg={unifiedDiffBg}
              cursorActive={unifiedCursorActive}
              filetype={filetype}
              syntaxStyle={syntaxStyle}
              width="100%"
            />
          </box>
        );
      })}
    </>
  );
}
