import { readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Annotation } from "./types.js";

function annotationsPath(repoRoot: string, reviewId: string): string {
  return join(repoRoot, ".review", reviewId, "annotations.jsonl");
}

export async function appendAnnotation(
  repoRoot: string,
  reviewId: string,
  annotation: Annotation,
): Promise<void> {
  const path = annotationsPath(repoRoot, reviewId);
  await appendFile(path, JSON.stringify(annotation) + "\n");
}

export async function appendAnnotations(
  repoRoot: string,
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  const path = annotationsPath(repoRoot, reviewId);
  const lines = annotations.map((a) => JSON.stringify(a)).join("\n") + "\n";
  await appendFile(path, lines);
}

export async function readAnnotations(
  repoRoot: string,
  reviewId: string,
): Promise<Annotation[]> {
  const path = annotationsPath(repoRoot, reviewId);
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
    } catch {
      // skip malformed lines
    }
  }
  return annotations;
}
