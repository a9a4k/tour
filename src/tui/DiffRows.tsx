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
          return (
            <box key={key} flexDirection="row" width="100%" minHeight={1}>
              <DiffLine
                gutter={splitGutter(row.leftLineNumber)}
                text={row.leftText}
                tinted={!!row.leftTinted}
                gutterAccent={!!row.leftGutter}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                width="50%"
              />
              <DiffLine
                gutter={splitGutter(row.rightLineNumber)}
                text={row.rightText}
                tinted={!!row.rightTinted}
                gutterAccent={!!row.rightGutter}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                width="50%"
              />
            </box>
          );
        }

        const text = row.type === "deletion" ? row.leftText : row.rightText;
        return (
          <DiffLine
            key={key}
            gutter={unifiedGutter(row)}
            text={text}
            tinted={!!row.rightTinted}
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
