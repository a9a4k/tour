import type { PlannedRow, DiffRow } from "../core/diff-rows.js";
import { AnnotationCard } from "./AnnotationCard.js";

interface DiffRowsProps {
  rows: PlannedRow[];
  layout: "split" | "unified";
  currentAnnotationId: string | null;
}

export const TINT_BG = "#1e2a44";
export const ACCENT_FG = "#58a6ff";
export const GUTTER_CHAR = "▎";

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

function gutterSpan(active: boolean | undefined, key: string) {
  return (
    <span key={key} fg={active ? ACCENT_FG : undefined}>
      {active ? GUTTER_CHAR : " "}
    </span>
  );
}

function bgIf(active: boolean | undefined): string | undefined {
  return active ? TINT_BG : undefined;
}

function renderSplit(row: DiffRow, key: string) {
  const leftHasLine = row.leftLineNumber !== null;
  const rightHasLine = row.rightLineNumber !== null;
  const leftContentTint = row.leftTinted && leftHasLine && rightHasLine;
  const rightContentTint = row.rightTinted && leftHasLine && rightHasLine;

  return (
    <text key={key}>
      {gutterSpan(row.leftGutter, `${key}-gl`)}
      <span bg={bgIf(row.leftTinted)}>{pad(row.leftLineNumber)}</span>
      <span bg={bgIf(leftContentTint)}>{`  ${row.leftText}    `}</span>
      {gutterSpan(row.rightGutter, `${key}-gr`)}
      <span bg={bgIf(row.rightTinted)}>{pad(row.rightLineNumber)}</span>
      <span bg={bgIf(rightContentTint)}>{`  ${row.rightText}`}</span>
    </text>
  );
}

function renderUnified(row: DiffRow, key: string) {
  const text = row.type === "deletion" ? row.leftText : row.rightText;
  const isPlusMinus = row.type === "addition" || row.type === "deletion";
  const contentTint = row.rightTinted && !isPlusMinus;

  return (
    <text key={key}>
      {gutterSpan(row.rightGutter, `${key}-g`)}
      <span bg={bgIf(row.rightTinted)}>{`${pad(row.leftLineNumber)} ${pad(row.rightLineNumber)}`}</span>
      <span bg={bgIf(contentTint)}>{` ${unifiedPrefix(row)} ${text}`}</span>
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
