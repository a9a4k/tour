import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { Comment } from "./types.js";

export type { FileDiffMetadata };

export interface DiffFile {
  name: string;
  prevName?: string;
  type: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  additionStart: number;
  additionCount: number;
  deletionStart: number;
  deletionCount: number;
  content: DiffLine[];
}

export interface DiffLine {
  type: "context" | "addition" | "deletion" | "change";
  addition?: string;
  deletion?: string;
  context?: string;
}

export interface DiffModel {
  files: DiffFile[];
}

export function splitFileDiffByHunk(fileSegment: string): string[] {
  if (!fileSegment.trim()) return [];

  const lines = fileSegment.split("\n");
  const headerLines: string[] = [];
  const hunkLines: string[][] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      hunkLines.push([line]);
    } else if (hunkLines.length > 0) {
      hunkLines[hunkLines.length - 1].push(line);
    } else {
      headerLines.push(line);
    }
  }

  if (hunkLines.length === 0) return [];

  const header = headerLines.join("\n");
  return hunkLines.map((h) => `${header}\n${h.join("\n")}`);
}

export function resolveCommentToHunkIndex(
  file: DiffFile,
  ann: Pick<Comment, "side" | "line_start" | "line_end">,
): number | null {
  for (let i = 0; i < file.hunks.length; i++) {
    const h = file.hunks[i];
    const start = ann.side === "additions" ? h.additionStart : h.deletionStart;
    const count = ann.side === "additions" ? h.additionCount : h.deletionCount;
    if (count === 0) continue;
    const end = start + count - 1;
    if (ann.line_end >= start && ann.line_start <= end) return i;
  }
  return null;
}

export function splitRawDiffByFile(rawDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!rawDiff.trim()) return result;

  const headerRe = /^diff --git a\/(.+) b\/(.+)$/;
  const lines = rawDiff.split("\n");

  let currentName: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentName !== null) {
      result.set(currentName, currentLines.join("\n"));
    }
  };

  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      flush();
      currentName = m[2];
      currentLines = [line];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }
  flush();

  return result;
}

export function parseFileDiffMetadata(rawDiff: string): FileDiffMetadata[] {
  if (!rawDiff.trim()) return [];
  const patches = parsePatchFiles(rawDiff);
  const out: FileDiffMetadata[] = [];
  for (const patch of patches) {
    for (const file of patch.files) out.push(file);
  }
  return out;
}

export function parseDiff(rawDiff: string): DiffModel {
  if (!rawDiff.trim()) return { files: [] };

  const patches = parsePatchFiles(rawDiff);
  const files: DiffFile[] = [];

  for (const patch of patches) {
    for (const file of patch.files) {
      const hunks: DiffHunk[] = file.hunks.map((h) => ({
        additionStart: h.additionStart,
        additionCount: h.additionCount,
        deletionStart: h.deletionStart,
        deletionCount: h.deletionCount,
        content: h.hunkContent.map((c) => ({
          type: c.type as DiffLine["type"],
          addition: "addition" in c ? (c as { addition: string }).addition : undefined,
          deletion: "deletion" in c ? (c as { deletion: string }).deletion : undefined,
          context: "context" in c ? (c as { context: string }).context : undefined,
        })),
      }));
      files.push({
        name: file.name,
        prevName: "prevName" in file ? (file as { prevName: string }).prevName : undefined,
        type: "type" in file ? (file as { type: string }).type : "change",
        hunks,
      });
    }
  }

  return { files };
}
