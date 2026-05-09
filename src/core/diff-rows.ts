import type { FileDiffMetadata } from "@pierre/diffs";
import type { Annotation } from "./types.js";

export type PlannedRow = DiffRow | HunkHeaderRow | AnnotationRow;

export interface DiffRow {
  kind: "diff-row";
  type: "context" | "addition" | "deletion" | "change";
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string;
  rightText: string;
}

export interface HunkHeaderRow {
  kind: "hunk-header";
  header: string;
  hunkIndex: number;
}

export interface AnnotationRow {
  kind: "annotation";
  annotation: Annotation;
  id: string;
}

export function planRows(
  file: FileDiffMetadata,
  annotations: Annotation[],
  layout: "split" | "unified",
): PlannedRow[] {
  const diffRows = walkHunks(file, layout);
  return interleaveAnnotations(diffRows, annotations);
}

function walkHunks(file: FileDiffMetadata, layout: "split" | "unified"): PlannedRow[] {
  const rows: PlannedRow[] = [];

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const hunk = file.hunks[hunkIndex];
    rows.push({
      kind: "hunk-header",
      header: hunk.hunkSpecs ?? "",
      hunkIndex,
    });

    let leftLine = hunk.deletionStart;
    let rightLine = hunk.additionStart;

    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let i = 0; i < block.lines; i++) {
          const text =
            file.additionLines[block.additionLineIndex + i] ??
            file.deletionLines[block.deletionLineIndex + i] ??
            "";
          rows.push({
            kind: "diff-row",
            type: "context",
            leftLineNumber: leftLine,
            rightLineNumber: rightLine,
            leftText: text,
            rightText: text,
          });
          leftLine++;
          rightLine++;
        }
      } else {
        if (layout === "split") {
          const max = Math.max(block.deletions, block.additions);
          for (let i = 0; i < max; i++) {
            const isDel = i < block.deletions;
            const isAdd = i < block.additions;
            rows.push({
              kind: "diff-row",
              type: "change",
              leftLineNumber: isDel ? leftLine + i : null,
              rightLineNumber: isAdd ? rightLine + i : null,
              leftText: isDel ? file.deletionLines[block.deletionLineIndex + i] ?? "" : "",
              rightText: isAdd ? file.additionLines[block.additionLineIndex + i] ?? "" : "",
            });
          }
        } else {
          for (let i = 0; i < block.deletions; i++) {
            rows.push({
              kind: "diff-row",
              type: "deletion",
              leftLineNumber: leftLine + i,
              rightLineNumber: null,
              leftText: file.deletionLines[block.deletionLineIndex + i] ?? "",
              rightText: "",
            });
          }
          for (let i = 0; i < block.additions; i++) {
            rows.push({
              kind: "diff-row",
              type: "addition",
              leftLineNumber: null,
              rightLineNumber: rightLine + i,
              leftText: "",
              rightText: file.additionLines[block.additionLineIndex + i] ?? "",
            });
          }
        }
        leftLine += block.deletions;
        rightLine += block.additions;
      }
    }
  }

  return rows;
}

function interleaveAnnotations(rows: PlannedRow[], annotations: Annotation[]): PlannedRow[] {
  if (annotations.length === 0) return rows;

  const sorted = [...annotations].sort((a, b) => {
    if (a.created_at < b.created_at) return -1;
    if (a.created_at > b.created_at) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const insertions = new Map<number, Annotation[]>();
  for (const ann of sorted) {
    const idx = findAnchorRowIndex(rows, ann);
    if (idx === -1) continue;
    const list = insertions.get(idx) ?? [];
    list.push(ann);
    insertions.set(idx, list);
  }

  if (insertions.size === 0) return rows;

  const out: PlannedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i]);
    const anns = insertions.get(i);
    if (!anns) continue;
    for (const ann of anns) {
      out.push({ kind: "annotation", annotation: ann, id: ann.id });
    }
  }
  return out;
}

function findAnchorRowIndex(rows: PlannedRow[], ann: Annotation): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "diff-row") continue;
    if (ann.side === "additions") {
      if (row.rightLineNumber === ann.line_end) return i;
    } else {
      if (row.leftLineNumber === ann.line_end) return i;
    }
  }
  return -1;
}
