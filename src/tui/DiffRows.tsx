import type { PlannedRow, DiffRow } from "../core/diff-rows.js";
import { AnnotationCard } from "./AnnotationCard.js";

interface DiffRowsProps {
  rows: PlannedRow[];
  layout: "split" | "unified";
  currentAnnotationId: string | null;
}

const LINE_NUMBER_WIDTH = 5;

function pad(n: number | null): string {
  if (n === null) return " ".repeat(LINE_NUMBER_WIDTH);
  return String(n).padStart(LINE_NUMBER_WIDTH, " ");
}

function unifiedPrefix(row: DiffRow): string {
  switch (row.type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}

function renderSplit(row: DiffRow, key: string) {
  return (
    <text key={key}>
      {`${pad(row.leftLineNumber)}  ${row.leftText}    ${pad(row.rightLineNumber)}  ${row.rightText}`}
    </text>
  );
}

function renderUnified(row: DiffRow, key: string) {
  const text = row.type === "deletion" ? row.leftText : row.rightText;
  return (
    <text key={key}>
      {`${pad(row.leftLineNumber)} ${pad(row.rightLineNumber)} ${unifiedPrefix(row)} ${text}`}
    </text>
  );
}

export function DiffRows({ rows, layout, currentAnnotationId }: DiffRowsProps) {
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
        return layout === "split" ? renderSplit(row, key) : renderUnified(row, key);
      })}
    </>
  );
}
