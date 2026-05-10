import type {
  PlannedRow,
  DiffRow,
  InteractiveSubKind,
  BoundaryRef,
} from "../core/diff-rows.js";
import { theme } from "../core/theme.js";
import { AnnotationCard } from "./AnnotationCard.js";
import { annotationCardSlot } from "./annotation-placement.js";
import { DiffLine } from "./DiffLine.js";
import { getSyntaxStyle, inferFiletype } from "./syntax.js";
import type { ReplyLock } from "../core/reply-lock.js";
import type { Cursor } from "../core/cursor-state.js";

interface DiffRowsProps {
  fileName: string;
  rows: PlannedRow[];
  layout: "split" | "unified";
  currentAnnotationId: string | null;
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

function splitGutter(lineNumber: number | null): string {
  return `${pad(lineNumber)} `;
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

// Match the split-side gutter footprint (LINE_NUMBER_WIDTH + " ") so the
// interactive row's text aligns with the diff column on its right.
const INTERACTIVE_PAD_GUTTER = " ".repeat(LINE_NUMBER_WIDTH + 1);

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
  currentAnnotationId,
  cursor,
  onCursorClick,
  onInteractiveClick,
  repliesCollapsed,
  replyLock,
  now,
}: DiffRowsProps) {
  const filetype = inferFiletype(fileName);
  const syntaxStyle = getSyntaxStyle();

  return (
    <>
      {rows.map((row, idx) => {
        const key = `r-${idx}`;
        if (row.kind === "hunk-header") {
          return (
            <text key={key} fg={theme.fg.muted}>
              {row.header}
            </text>
          );
        }
        if (row.kind === "interactive") {
          // Interactive row visual (ADR 0013): cursor's `▶` glyph + gutter
          // bg in the line-number column on the active side, consistent
          // with the diff-row treatment. The text body (e.g. "··· N
          // hidden ···") comes from the planner.
          const cursorActive =
            cursor != null &&
            cursor.file === fileName &&
            cursor.interactive != null &&
            cursor.interactive.subKind === row.subKind &&
            cursor.interactive.boundaryRef === row.boundaryRef;
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
              isCurrent={row.id === currentAnnotationId}
              replies={row.replies}
              repliesCollapsed={repliesCollapsed}
              replyLock={replyLock}
              now={now}
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
          cursor != null && cursor.file === fileName ? cursor : null;
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
                  gutter={splitGutter(row.leftLineNumber)}
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
              <box id={rightId} width="50%" onMouseDown={onRightMouseDown}>
                <DiffLine
                  gutter={splitGutter(row.rightLineNumber)}
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
