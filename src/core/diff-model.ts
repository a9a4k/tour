import { parsePatchFiles } from "@pierre/diffs";

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
