import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { Annotation, AuthorKind } from "./types.js";
import { generateId } from "./ids.js";

function annotationsPath(repoRoot: string, tourId: string): string {
  return join(repoRoot, ".tour", tourId, "annotations.jsonl");
}

function isValidAuthorKind(v: unknown): v is "agent" | "human" {
  return v === "agent" || v === "human";
}

// PRD #140 rule (1/5): body must be non-empty after trimming. Whitespace-
// only bodies reject at the seam so every surface (CLI / TUI / webapp /
// reply-runner) gets the same wording (slice 2 / #142).
function validateBody(body: string): void {
  if (body.trim().length === 0) {
    throw new Error("Annotation body must not be empty or whitespace-only");
  }
}

interface BuildAnnotationInput {
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

function buildAnnotation(input: BuildAnnotationInput): Annotation {
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

interface BuildReplyInput {
  replies_to: string;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

function buildReply(input: BuildReplyInput, existing: Annotation[]): Annotation {
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

async function appendAnnotation(
  repoRoot: string,
  tourId: string,
  annotation: Annotation,
): Promise<void> {
  const path = annotationsPath(repoRoot, tourId);
  await appendFile(path, JSON.stringify(annotation) + "\n");
}

async function appendAnnotations(
  repoRoot: string,
  tourId: string,
  annotations: Annotation[],
): Promise<void> {
  const path = annotationsPath(repoRoot, tourId);
  const lines = annotations.map((a) => JSON.stringify(a)).join("\n") + "\n";
  await appendFile(path, lines);
}

// The Annotation creation seam (PRD #140 / slice 1 #141). All four writers —
// CLI, TUI, webapp, reply-runner — funnel through `createAnnotation`,
// `createReply`, `createAnnotations`. Subsequent slices add validation rules
// (body-trim, author-default, anchor-in-diff) behind this seam; slice 1
// keeps behaviour identical and only narrows the public surface.

export interface CreateAnnotationRequest {
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

export interface CreateReplyRequest {
  replies_to: string;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

export type CreateRequest =
  | ({ kind: "top-level" } & CreateAnnotationRequest)
  | ({ kind: "reply" } & CreateReplyRequest);

export async function createAnnotation(
  repoRoot: string,
  tourId: string,
  request: CreateAnnotationRequest,
): Promise<Annotation> {
  validateBody(request.body);
  const ann = buildAnnotation(request);
  await appendAnnotation(repoRoot, tourId, ann);
  return ann;
}

// `createReply` always re-reads `annotations.jsonl` to prove the parent
// exists at write time — callers must not pass a pre-loaded parent (PRD
// #140). The Reply inherits the parent's anchor.
export async function createReply(
  repoRoot: string,
  tourId: string,
  request: CreateReplyRequest,
): Promise<Annotation> {
  validateBody(request.body);
  const existing = await readAnnotations(repoRoot, tourId);
  const reply = buildReply(request, existing);
  await appendAnnotation(repoRoot, tourId, reply);
  return reply;
}

// Atomic batch: build every record first (replies resolve against
// `annotations.jsonl` read once), then a single `appendFile` for the
// whole batch. A bad reply parent rejects before any write happens.
export async function createAnnotations(
  repoRoot: string,
  tourId: string,
  requests: CreateRequest[],
): Promise<Annotation[]> {
  for (const req of requests) validateBody(req.body);
  const existing = await readAnnotations(repoRoot, tourId);
  const built: Annotation[] = requests.map((req) => {
    if (req.kind === "reply") {
      return buildReply(req, existing);
    }
    return buildAnnotation(req);
  });
  await appendAnnotations(repoRoot, tourId, built);
  return built;
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
