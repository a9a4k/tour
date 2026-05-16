export interface Tour {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string;
  head_sha: string;
  base_sha: string;
  head_source: string;
  base_source: string;
  wip_snapshot: boolean;
}

export type AuthorKind = "agent" | "human";

export interface Comment {
  id: string;
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author: string;
  author_kind: AuthorKind;
  replies_to?: string;
  created_at: string;
}

// Projected Comment shape. Extends today's `Comment` with an optional
// `deleted?: { at }` marker stamped at fold time when a `comment.deleted`
// event targets this comment. The field is shaped now (ADR 0036) even
// though Slice B never emits delete events — Slice C lights it up. Every
// surface consumes the projection; nothing parses the event log directly.
export interface CommentState extends Comment {
  deleted?: { at: string };
}

// On-disk event union for `.tour/<id>/tour-events.jsonl` (ADR 0036).
// Append-only JSONL — one event per line, kind-discriminated. Future
// verbs (edit, resolve, re-anchor) extend the union without changing
// the storage seam.
export type TourEvent =
  | {
      kind: "comment.created";
      id: string;
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
      body: string;
      author: string;
      author_kind: AuthorKind;
      at: string;
    }
  | {
      kind: "reply.created";
      id: string;
      replies_to: string;
      body: string;
      author: string;
      author_kind: AuthorKind;
      at: string;
    }
  | {
      kind: "comment.deleted";
      target_id: string;
      at: string;
    };
