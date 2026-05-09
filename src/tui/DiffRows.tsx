import type { PlannedRow, DiffRow } from "../core/diff-rows.js";
import { AnnotationCard } from "./AnnotationCard.js";
import { DiffLine, ACCENT_FG, GUTTER_CHAR, TINT_BG } from "./DiffLine.js";
import { getSyntaxStyle, inferFiletype } from "./syntax.js";

export { ACCENT_FG, GUTTER_CHAR, TINT_BG };

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
            <text key={key} fg="gray">
              {row.header}
            </text>
          );
        }
        if (row.kind === "annotation") {
          return (
            <AnnotationCard
              key={`ann-${row.id}`}
              annotation={row.annotation}
              isCurrent={row.id === currentAnnotationId}
            />
          );
        }

        if (layout === "split") {
          // Content tint only when both sides have a line number — i.e. a
          // context-paired row. One-sided rows (additions / deletions inside
          // a change block) keep their content un-tinted so the +/- structural
          // signal survives. ADR 0008.
          const paired = row.leftLineNumber !== null && row.rightLineNumber !== null;
          return (
            <box key={key} flexDirection="row" width="100%" minHeight={1}>
              <DiffLine
                gutter={splitGutter(row.leftLineNumber)}
                text={row.leftText}
                gutterTinted={!!row.leftTinted}
                contentTinted={!!row.leftTinted && paired}
                gutterAccent={!!row.leftGutter}
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
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                width="50%"
              />
            </box>
          );
        }

        const text = row.type === "deletion" ? row.leftText : row.rightText;
        const isPlusMinus = row.type === "addition" || row.type === "deletion";
        return (
          <DiffLine
            key={key}
            gutter={unifiedGutter(row)}
            text={text}
            gutterTinted={!!row.rightTinted}
            contentTinted={!!row.rightTinted && !isPlusMinus}
            gutterAccent={!!row.rightGutter}
            filetype={filetype}
            syntaxStyle={syntaxStyle}
            width="100%"
          />
        );
      })}
    </>
  );
}
