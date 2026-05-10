import type { PlannedRow, DiffRow } from "../core/diff-rows.js";
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

export function DiffRows({
  fileName,
  rows,
  layout,
  currentAnnotationId,
  cursor,
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
          return (
            <box key={key} flexDirection="row" width="100%" minHeight={1}>
              <box id={leftId} width="50%">
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
              <box id={rightId} width="50%">
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
        // The id keys off the row's natural addressable side: pure deletion
        // rows are deletions-side; everything else (context, addition) is
        // additions-side.
        let unifiedRowId: string | undefined;
        if (row.type === "deletion" && row.leftLineNumber !== null) {
          unifiedRowId = rowId(fileName, "deletions", row.leftLineNumber);
        } else if (row.rightLineNumber !== null) {
          unifiedRowId = rowId(fileName, "additions", row.rightLineNumber);
        }
        return (
          <box key={key} id={unifiedRowId} width="100%">
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
