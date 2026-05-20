import type { AuthorKind } from "../core/types.js";

export interface BatchItem {
  file?: string;
  side?: string;
  line?: string;
  line_start?: number;
  line_end?: number;
  body?: string;
  author?: string;
  author_kind?: AuthorKind;
  thread_id?: string;
}

// Accept both JSONL (one object per line; blank lines tolerated) and a single
// JSON array. Detection: leading non-whitespace `[` → array; otherwise JSONL.
// JSONL parse errors are tagged with the source line number (1-based, counting
// blank lines), so an agent piping records can locate the offending record.
export function parseBatch(stdin: string): BatchItem[] {
  const trimmed = stdin.trim();
  if (trimmed === "") return [];

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("Batch JSON must be an array");
    }
    return parsed as BatchItem[];
  }

  const lines = stdin.split(/\r?\n/);
  const items: BatchItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    try {
      items.push(JSON.parse(line) as BatchItem);
    } catch (e) {
      throw new Error(`Line ${i + 1}: ${(e as Error).message}`);
    }
  }
  return items;
}
