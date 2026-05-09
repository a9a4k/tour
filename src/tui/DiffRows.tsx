import type { PlannedRow, DiffRow } from "../core/diff-rows.js";
import { theme } from "../core/theme.js";
import { AnnotationCard } from "./AnnotationCard.js";
import { annotationCardSlot } from "./annotation-placement.js";
import { DiffLine } from "./DiffLine.js";
import { getSyntaxStyle, inferFiletype } from "./syntax.js";

interface DiffRowsProps {
  fileName: string;
  rows: PlannedRow[];
  layout: "split" | "unified";
  currentAnnotationId: string | null;
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

export function DiffRows({ fileName, rows, layout, currentAnnotationId }: DiffRowsProps) {
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
          return (
            <box key={key} flexDirection="row" width="100%" minHeight={1}>
              <DiffLine
                gutter={splitGutter(row.leftLineNumber)}
                text={row.leftText}
                gutterTinted={!!row.leftTinted}
                contentTinted={!!row.leftTinted && paired}
                gutterAccent={!!row.leftGutter}
                diffBg={leftDiffBg}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                width="50%"
              />
              <DiffLine
                gutter={splitGutter(row.rightLineNumber)}
                text={row.rightText}
                gutterTinted={!!row.rightTinted}
                contentTinted={!!row.rightTinted && paired}
                gutterAccent={!!row.rightGutter}
                diffBg={rightDiffBg}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                width="50%"
              />
            </box>
          );
        }

        const text = row.type === "deletion" ? row.leftText : row.rightText;
        const isPlusMinus = row.type === "addition" || row.type === "deletion";
        const unifiedDiffBg: "addition" | "deletion" | undefined =
          row.type === "addition" ? "addition" : row.type === "deletion" ? "deletion" : undefined;
        return (
          <DiffLine
            key={key}
            gutter={unifiedGutter(row)}
            text={text}
            gutterTinted={!!row.rightTinted}
            contentTinted={!!row.rightTinted && !isPlusMinus}
            gutterAccent={!!row.rightGutter}
            diffBg={unifiedDiffBg}
            filetype={filetype}
            syntaxStyle={syntaxStyle}
            width="100%"
          />
        );
      })}
    </>
  );
}
