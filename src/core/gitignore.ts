import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENTRY = ".tour/";

export async function ensureTourIgnored(repoRoot: string): Promise<void> {
  const path = join(repoRoot, ".gitignore");
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    content = "";
  }
  const lines = content.split("\n");
  if (lines.some((l) => l.trim() === ENTRY)) return;
  const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await writeFile(path, content + sep + ENTRY + "\n");
}
