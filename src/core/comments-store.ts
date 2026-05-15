import { readFile, appendFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Comment, AuthorKind } from "./types.js";
import type { TourBundle, BundleFile } from "./tour-bundle.js";
import { generateId } from "./ids.js";

// Stage B on-disk filename (issue #342 / PRD #335 / ADR 0029 addendum).
// The canonical on-disk filename for the per-Tour Comment log is
// `comments.jsonl`. The pre-Stage-B name `annotations.jsonl` is the
// fallback: the reader uses it when `comments.jsonl` is absent; the writer
// one-shot-renames it to `comments.jsonl` on first write. The fallback
// path stays in the codebase indefinitely per ADR 0029 addendum — no
// release ever drops it, so pre-Stage-B `.tour/` dirs in the wild keep
// working without an explicit migration step.
const COMMENTS_FILENAME = "comments.jsonl";
const LEGACY_ANNOTATIONS_FILENAME = "annotations.jsonl";

function tourDir(repoRoot: string, tourId: string): string {
  return join(repoRoot, ".tour", tourId);
}

function commentsPath(repoRoot: string, tourId: string): string {
  return join(tourDir(repoRoot, tourId), COMMENTS_FILENAME);
}

function legacyCommentLogPath(repoRoot: string, tourId: string): string {
  return join(tourDir(repoRoot, tourId), LEGACY_ANNOTATIONS_FILENAME);
}

// Returns the path to read records from: `comments.jsonl` if it exists,
// otherwise `annotations.jsonl`. Returns `null` when neither file exists
// (a freshly-created Tour with no Comments yet). Reads must never write;
// the rename happens in the write path only. ADR 0029 addendum: this
// fallback stays forever.
function readPath(repoRoot: string, tourId: string): string | null {
  const newPath = commentsPath(repoRoot, tourId);
  if (existsSync(newPath)) return newPath;
  const oldPath = legacyCommentLogPath(repoRoot, tourId);
  if (existsSync(oldPath)) return oldPath;
  return null;
}

// Resolves the path the next append should write to. On a Tour folder
// that has only `annotations.jsonl`, performs an atomic rename to
// `comments.jsonl` and returns the new path. The rename uses
// `fs.promises.rename`, which is atomic on POSIX for same-volume renames
// (Tour is single-machine, single-volume per ADR 0020). If both files
// exist (impossible in practice — would mean a partial migration), the
// writer treats `comments.jsonl` as authoritative, logs a stderr warning,
// and leaves the legacy file alone. The append runs inside the same
// serialised section the writer already holds (per-Tour reply lock,
// ADR 0015), so no additional locking is needed across the rename.
async function ensureWritePath(repoRoot: string, tourId: string): Promise<string> {
  const newPath = commentsPath(repoRoot, tourId);
  const oldPath = legacyCommentLogPath(repoRoot, tourId);
  const hasNew = existsSync(newPath);
  const hasOld = existsSync(oldPath);
  if (hasOld && !hasNew) {
    await rename(oldPath, newPath);
    return newPath;
  }
  if (hasOld && hasNew) {
    process.stderr.write(
      `tour: warning: both annotations.jsonl and comments.jsonl exist in .tour/${tourId}/; treating comments.jsonl as authoritative (ADR 0029 addendum)\n`,
    );
  }
  return newPath;
}

function isValidAuthorKind(v: unknown): v is "agent" | "human" {
  return v === "agent" || v === "human";
}

// PRD #140 rule (1/5): body must be non-empty after trimming. Whitespace-
// only bodies reject at the seam so every surface (CLI / TUI / webapp /
// reply-runner) gets the same wording (slice 2 / #142).
function validateBody(body: string): void {
  if (body.trim().length === 0) {
    throw new Error("Comment body must not be empty or whitespace-only");
  }
}

function lineCount(content: string | undefined): number {
  if (!content) return 0;
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

// PRD #140 rule (4/5): the anchor must resolve inside the Tour's Diff.
// The `file` must be in `bundle.files`, the line range must satisfy
// `1 ≤ line_start ≤ line_end ≤ lineCount(file, side)`. Anchors landing in
// Hidden context (between or outside hunks) are legal — file membership
// and line-range bounds are the only checks here, hunk membership is a
// render-time concern (orphan-window already handles placement). See
// ADR 0017.
function validateAnchor(
  request: { file: string; side: "additions" | "deletions"; line_start: number; line_end: number },
  bundle: TourBundle,
): void {
  if (bundle.kind !== "ok") {
    throw new Error(
      "Cannot validate comment anchor against a snapshot-lost tour bundle",
    );
  }
  const file: BundleFile | undefined = bundle.files.find((f) => f.name === request.file);
  if (!file) {
    throw new Error(
      `Comment file "${request.file}" is not in the Tour's diff (no renderer can display anchors outside the diff)`,
    );
  }
  if (request.line_start < 1) {
    throw new Error(
      `Comment line_start must be >= 1 (got ${request.line_start})`,
    );
  }
  if (request.line_end < request.line_start) {
    throw new Error(
      `Comment line_end (${request.line_end}) must be >= line_start (${request.line_start})`,
    );
  }
  const max =
    request.side === "additions"
      ? lineCount(file.newContent)
      : lineCount(file.oldContent);
  if (request.line_end > max) {
    throw new Error(
      `Comment line_end (${request.line_end}) exceeds ${request.file}'s line count on ${request.side} side (${max})`,
    );
  }
}

interface BuildCommentInput {
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

function buildComment(input: BuildCommentInput): Comment {
  return {
    id: generateId(),
    file: input.file,
    side: input.side,
    line_start: input.line_start,
    line_end: input.line_end,
    body: input.body,
    author: input.author ?? input.author_kind,
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

function buildReply(input: BuildReplyInput, existing: Comment[]): Comment {
  const parent = existing.find((a) => a.id === input.replies_to);
  if (!parent) {
    throw new Error(`No comment with id "${input.replies_to}" in this tour`);
  }
  return {
    id: generateId(),
    file: parent.file,
    side: parent.side,
    line_start: parent.line_start,
    line_end: parent.line_end,
    body: input.body,
    author: input.author ?? input.author_kind,
    author_kind: input.author_kind,
    replies_to: input.replies_to,
    created_at: new Date().toISOString(),
  };
}

async function appendComment(
  repoRoot: string,
  tourId: string,
  comment: Comment,
): Promise<void> {
  const path = await ensureWritePath(repoRoot, tourId);
  await appendFile(path, JSON.stringify(comment) + "\n");
}

async function appendComments(
  repoRoot: string,
  tourId: string,
  comments: Comment[],
): Promise<void> {
  const path = await ensureWritePath(repoRoot, tourId);
  const lines = comments.map((a) => JSON.stringify(a)).join("\n") + "\n";
  await appendFile(path, lines);
}

// The Comment creation seam (PRD #140 / slice 1 #141). All four writers —
// CLI, TUI, webapp, reply-runner — funnel through `createComment`,
// `createReply`, `createComments`. Subsequent slices add validation rules
// (body-trim, author-default, anchor-in-diff) behind this seam; slice 1
// keeps behaviour identical and only narrows the public surface.

export interface CreateCommentRequest {
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
  | ({ kind: "top-level" } & CreateCommentRequest)
  | ({ kind: "reply" } & CreateReplyRequest);

export async function createComment(
  repoRoot: string,
  tourId: string,
  request: CreateCommentRequest,
  bundle: TourBundle,
): Promise<Comment> {
  validateBody(request.body);
  validateAnchor(request, bundle);
  const ann = buildComment(request);
  await appendComment(repoRoot, tourId, ann);
  return ann;
}

// `createReply` always re-reads the on-disk Comment log to prove the
// parent exists at write time — callers must not pass a pre-loaded parent
// (PRD #140). The Reply inherits the parent's anchor.
export async function createReply(
  repoRoot: string,
  tourId: string,
  request: CreateReplyRequest,
): Promise<Comment> {
  validateBody(request.body);
  const existing = await readComments(repoRoot, tourId);
  const reply = buildReply(request, existing);
  await appendComment(repoRoot, tourId, reply);
  return reply;
}

// Atomic batch: build every record first (replies resolve against the
// on-disk Comment log read once), then a single `appendFile` for the
// whole batch. A bad reply parent rejects before any write happens.
export async function createComments(
  repoRoot: string,
  tourId: string,
  requests: CreateRequest[],
  bundle: TourBundle,
): Promise<Comment[]> {
  for (const req of requests) {
    validateBody(req.body);
    if (req.kind === "top-level") validateAnchor(req, bundle);
  }
  const existing = await readComments(repoRoot, tourId);
  const built: Comment[] = requests.map((req) => {
    if (req.kind === "reply") {
      return buildReply(req, existing);
    }
    return buildComment(req);
  });
  await appendComments(repoRoot, tourId, built);
  return built;
}

export async function readComments(
  repoRoot: string,
  tourId: string,
): Promise<Comment[]> {
  const path = readPath(repoRoot, tourId);
  if (path === null) return [];
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const comments: Comment[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const ann = parsed as Comment;
    if (!isValidAuthorKind(ann.author_kind)) {
      throw new Error(
        `Comment ${ann.id ?? "(no id)"} in tour ${tourId} is missing or has invalid "author_kind" — pre-bidirectional .tour/ data is not supported`,
      );
    }
    comments.push(ann);
  }
  return comments;
}
