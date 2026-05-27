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

function findThreadRootOrThrow(
  thread_id: string,
  commentsById: ReadonlyMap<string, CommentState>,
): CommentState {
  const root = commentsById.get(thread_id);
  if (!root) {
    throw new Error(`No comment with id "${thread_id}" in this tour`);
  }
  if (root.thread_id !== undefined) {
    throw new Error(
      `thread_id "${thread_id}" is a Reply (root of its Thread is "${root.thread_id}"); pass thread_id="${root.thread_id}"`,
    );
  }
  return root;
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
  const commentsById = new Map(existing.map((a) => [a.id, a]));
  const threadRoot = findThreadRootOrThrow(request.thread_id, commentsById);
  const event = buildReplyCreatedEvent(request);
  await appendEvent(tourStoreRoot, tourId, event);
  return replyEventToComment(event, threadRoot);
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
  // earlier in the same batch; seed the lookup with on-disk Comments,
  // then extend it as batch items are built.
  const inBatchById: Map<string, CommentState> = new Map(
    existing.map((a) => [a.id, a]),
  );
  for (const req of requests) {
    if (req.kind === "reply") {
      const threadRoot = findThreadRootOrThrow(req.thread_id, inBatchById);
      const event = buildReplyCreatedEvent(req);
      events.push(event);
      const comment = replyEventToComment(event, threadRoot);
      builtComments.push(comment);
      inBatchById.set(comment.id, comment);
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

export interface CreateEditRequest {
  target_id: string;
  body: string;
  by_kind: AuthorKind;
}

export async function createEdit(
  tourStoreRoot: string,
  tourId: string,
  request: CreateEditRequest,
): Promise<{ target_id: string; body: string; at: string }> {
  if (request.by_kind !== "human") {
    throw new Error(
      `comment.edited is humans-only (ADR 0043) — refused by_kind="${request.by_kind}"`,
    );
  }
  validateBody(request.body);
  const existing = await readComments(tourStoreRoot, tourId);
  const target = existing.find((c) => c.id === request.target_id);
  if (!target) {
    throw new Error(`No comment with id "${request.target_id}" in this tour`);
  }
  if (target.deleted) {
    throw new Error(`Comment "${request.target_id}" is already deleted`);
  }
  if (target.body.trim() === request.body.trim()) {
    throw new Error(`Comment "${request.target_id}" has no changes after trim`);
  }
  const event: TourEvent = {
    kind: "comment.edited",
    target_id: request.target_id,
    body: request.body,
    at: new Date().toISOString(),
  };
  await appendEvent(tourStoreRoot, tourId, event);
  return { target_id: event.target_id, body: event.body, at: event.at };
}
