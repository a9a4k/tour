import type { Comment, CommentState, AuthorKind, TourEvent } from "./types.js";
import type { TourBundle, BundleFile } from "./tour-bundle.js";
import { generateId } from "./ids.js";
import { appendEvent, appendEvents, readEvents } from "./events-store.js";
import { foldEventsToComments } from "./events-fold.js";

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

function buildCommentCreatedEvent(input: BuildCommentInput): TourEvent & { kind: "comment.created" } {
  return {
    kind: "comment.created",
    id: generateId(),
    file: input.file,
    side: input.side,
    line_start: input.line_start,
    line_end: input.line_end,
    body: input.body,
    author: input.author ?? input.author_kind,
    author_kind: input.author_kind,
    at: new Date().toISOString(),
  };
}

function eventToComment(
  ev: TourEvent & { kind: "comment.created" },
): Comment {
  return {
    id: ev.id,
    file: ev.file,
    side: ev.side,
    line_start: ev.line_start,
    line_end: ev.line_end,
    body: ev.body,
    author: ev.author,
    author_kind: ev.author_kind,
    created_at: ev.at,
  };
}

interface BuildReplyInput {
  thread_id: string;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

function findParentOrThrow(
  thread_id: string,
  existing: CommentState[],
): CommentState {
  const parent = existing.find((a) => a.id === thread_id);
  if (!parent) {
    throw new Error(`No comment with id "${thread_id}" in this tour`);
  }
  return parent;
}

function buildReplyCreatedEvent(
  input: BuildReplyInput,
): TourEvent & { kind: "reply.created" } {
  return {
    kind: "reply.created",
    id: generateId(),
    thread_id: input.thread_id,
    body: input.body,
    author: input.author ?? input.author_kind,
    author_kind: input.author_kind,
    at: new Date().toISOString(),
  };
}

function replyEventToComment(
  ev: TourEvent & { kind: "reply.created" },
  parent: CommentState,
): Comment {
  return {
    id: ev.id,
    file: parent.file,
    side: parent.side,
    line_start: parent.line_start,
    line_end: parent.line_end,
    body: ev.body,
    author: ev.author,
    author_kind: ev.author_kind,
    thread_id: ev.thread_id,
    created_at: ev.at,
  };
}

// The Comment creation seam (PRD #140 / slice 1 #141). All four writers —
// CLI, TUI, webapp, reply-runner — funnel through `createComment`,
// `createReply`, `createComments`. Validation (body trim, author-default,
// anchor-in-diff) lives here; subsequent slices add new verbs (e.g.
// delete, ADR 0036) behind this seam.

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
  thread_id: string;
  body: string;
  author?: string;
  author_kind: AuthorKind;
}

export type CreateRequest =
  | ({ kind: "top-level" } & CreateCommentRequest)
  | ({ kind: "reply" } & CreateReplyRequest);

export async function createComment(
  tourStoreRoot: string,
  tourId: string,
  request: CreateCommentRequest,
  bundle: TourBundle,
): Promise<Comment> {
  validateBody(request.body);
  validateAnchor(request, bundle);
  const event = buildCommentCreatedEvent(request);
  await appendEvent(tourStoreRoot, tourId, event);
  return eventToComment(event);
}

// `createReply` always re-reads the on-disk event log to prove the
// parent exists at write time — callers must not pass a pre-loaded parent
// (PRD #140). The Reply inherits the parent's anchor.
export async function createReply(
  tourStoreRoot: string,
  tourId: string,
  request: CreateReplyRequest,
): Promise<Comment> {
  validateBody(request.body);
  const existing = await readComments(tourStoreRoot, tourId);
  const parent = findParentOrThrow(request.thread_id, existing);
  const event = buildReplyCreatedEvent(request);
  await appendEvent(tourStoreRoot, tourId, event);
  return replyEventToComment(event, parent);
}

// Atomic batch: build every event first (replies resolve against the
// on-disk event log read once), then a single `appendFile` for the whole
// batch. A bad reply parent rejects before any write happens.
export async function createComments(
  tourStoreRoot: string,
  tourId: string,
  requests: CreateRequest[],
  bundle: TourBundle,
): Promise<Comment[]> {
  for (const req of requests) {
    validateBody(req.body);
    if (req.kind === "top-level") validateAnchor(req, bundle);
  }
  const existing = await readComments(tourStoreRoot, tourId);
  const events: TourEvent[] = [];
  const builtComments: Comment[] = [];
  // Replies in the same batch may target top-level Comments created
  // earlier in the same batch; the on-disk read won't see them yet, so
  // track in-batch parents in a sidecar lookup.
  const inBatchById: Map<string, CommentState> = new Map();
  for (const req of requests) {
    if (req.kind === "reply") {
      const parent =
        existing.find((a) => a.id === req.thread_id) ??
        inBatchById.get(req.thread_id);
      if (!parent) {
        throw new Error(`No comment with id "${req.thread_id}" in this tour`);
      }
      const event = buildReplyCreatedEvent(req);
      events.push(event);
      builtComments.push(replyEventToComment(event, parent));
    } else {
      const event = buildCommentCreatedEvent(req);
      events.push(event);
      const comment = eventToComment(event);
      builtComments.push(comment);
      inBatchById.set(comment.id, comment);
    }
  }
  await appendEvents(tourStoreRoot, tourId, events);
  return builtComments;
}

export async function readComments(
  tourStoreRoot: string,
  tourId: string,
): Promise<CommentState[]> {
  const events = await readEvents(tourStoreRoot, tourId);
  return foldEventsToComments(events);
}

// Slice C / ADR 0036: the single write seam for `comment.deleted` events.
// Humans-only by protocol contract — agents-asserted callers reject here.
// Existence + already-deleted guards mirror `createReply`'s parent check;
// the fold's defence-in-depth (ignore-unknown, idempotent-on-duplicate)
// stays in place as a safety net behind this primary guard.
export interface CreateDeleteRequest {
  target_id: string;
  by_kind: AuthorKind;
}

export async function createDelete(
  tourStoreRoot: string,
  tourId: string,
  request: CreateDeleteRequest,
): Promise<{ target_id: string; at: string }> {
  if (request.by_kind !== "human") {
    throw new Error(
      `comment.deleted is humans-only (ADR 0036) — refused by_kind="${request.by_kind}"`,
    );
  }
  const existing = await readComments(tourStoreRoot, tourId);
  const target = existing.find((c) => c.id === request.target_id);
  if (!target) {
    throw new Error(`No comment with id "${request.target_id}" in this tour`);
  }
  if (target.deleted) {
    throw new Error(`Comment "${request.target_id}" is already deleted`);
  }
  const event: TourEvent = {
    kind: "comment.deleted",
    target_id: request.target_id,
    at: new Date().toISOString(),
  };
  await appendEvent(tourStoreRoot, tourId, event);
  return { target_id: event.target_id, at: event.at };
}
