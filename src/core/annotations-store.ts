import { readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Annotation } from "./types.js";

function annotationsPath(repoRoot: string, tourId: string): string {
  return join(repoRoot, ".tour", tourId, "annotations.jsonl");
}

export async function appendAnnotation(
  repoRoot: string,
  tourId: string,
  annotation: Annotation,
): Promise<void> {
  const path = annotationsPath(repoRoot, tourId);
  await appendFile(path, JSON.stringify(annotation) + "\n");
}

export async function appendAnnotations(
  repoRoot: string,
  tourId: string,
  annotations: Annotation[],
): Promise<void> {
  const path = annotationsPath(repoRoot, tourId);
  const lines = annotations.map((a) => JSON.stringify(a)).join("\n") + "\n";
  await appendFile(path, lines);
}

export async function readAnnotations(
  repoRoot: string,
  tourId: string,
): Promise<Annotation[]> {
  const path = annotationsPath(repoRoot, tourId);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const annotations: Annotation[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      annotations.push(JSON.parse(line) as Annotation);
    } catch {}
  }
  return annotations;
}
