import { readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Annotation, AuthorKind } from "./types.js";
import { generateId } from "./ids.js";

function annotationsPath(repoRoot: string, tourId: string): string {
  return join(repoRoot, ".tour", tourId, "annotations.jsonl");
}

function isValidAuthorKind(v: unknown): v is "agent" | "human" {
  return v === "agent" || v === "human";
}

export interface BuildAnnotationInput {
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

export function buildAnnotation(input: BuildAnnotationInput): Annotation {
  return {
    id: generateId(),
    file: input.file,
    side: input.side,
    line_start: input.line_start,
    line_end: input.line_end,
    body: input.body,
    author: input.author ?? "unknown",
    author_kind: input.author_kind,
    created_at: new Date().toISOString(),
  };
}

export interface BuildReplyInput {
  replies_to: string;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

/**
 * Build a Reply Annotation from a parent already in the tour. The Reply
 * inherits the parent's `(file, side, line_start, line_end)` anchor so
 * readers don't need to walk the chain to resolve where the Reply paints
 * its cues — see PRD #73 / Slice 1 (#75).
 */
export function buildReply(input: BuildReplyInput, existing: Annotation[]): Annotation {
  const parent = existing.find((a) => a.id === input.replies_to);
  if (!parent) {
    throw new Error(`No annotation with id "${input.replies_to}" in this tour`);
  }
  return {
    id: generateId(),
    file: parent.file,
    side: parent.side,
    line_start: parent.line_start,
    line_end: parent.line_end,
    body: input.body,
    author: input.author ?? "unknown",
    author_kind: input.author_kind,
    replies_to: input.replies_to,
    created_at: new Date().toISOString(),
  };
}

// Build the agent's Reply Annotation under the stdout-as-reply contract
// (ADR 0012 / PRD #94 / slice #95). Body is trimmed because the runner
// captures stdout verbatim — surrounding whitespace from the inner CLI's
// flush is not part of the reply.
export function buildReplyAnnotation(
  triggering: Annotation,
  agentName: string,
  body: string,
): Annotation {
  return {
    id: generateId(),
    file: triggering.file,
    side: triggering.side,
    line_start: triggering.line_start,
    line_end: triggering.line_end,
    body: body.trim(),
    author: agentName,
    author_kind: "agent",
    replies_to: triggering.id,
    created_at: new Date().toISOString(),
  };
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const ann = parsed as Annotation;
    if (!isValidAuthorKind(ann.author_kind)) {
      throw new Error(
        `Annotation ${ann.id ?? "(no id)"} in tour ${tourId} is missing or has invalid "author_kind" — pre-bidirectional .tour/ data is not supported`,
      );
    }
    annotations.push(ann);
  }
  return annotations;
}
