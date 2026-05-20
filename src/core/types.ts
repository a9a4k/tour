export interface Tour {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
  created_in_worktree: string;
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
  // Issue #389 / ADR 0036 (Slice E): C4 cascade marker. Set internally
  // on every deleted comment during the fold; only ever observable on
  // `[deleted]` parent stubs in the projection that consumers see —
  // leaf-deleted replies and fully-deleted threads are filtered out
  // before emit. The fold lives in `events-fold.ts`; the surfaces
  // consuming projections (CLI / TUI / webapp / pickup / reply-runner)
  // switch on this field to render the stub.
  deleted?: { at: string };
}

// Slice B compatibility alias. The fold-emitted projection used to be
// modelled as `CommentState extends Comment` while the disk-shape
// `Comment` stayed narrow; with the `deleted` field now living on
// `Comment` itself (issue #389), the two are structurally identical.
// Existing consumers (`readComments` return, pickup) keep importing
// `CommentState` for documentary intent.
export type CommentState = Comment;

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
