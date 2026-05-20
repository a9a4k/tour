import type { Comment } from "./types.js";

export interface Thread {
  root: Comment;
  replies: Comment[];
}

function compareComments(a: Comment, b: Comment): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function buildThreads(comments: Comment[]): Thread[] {
  const repliesByRootId = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.thread_id === undefined) continue;
    const replies = repliesByRootId.get(c.thread_id) ?? [];
    replies.push(c);
    repliesByRootId.set(c.thread_id, replies);
  }

  const threadsByRootId = new Map<string, Thread>();
  for (const c of comments) {
    if (c.thread_id !== undefined) continue;
    threadsByRootId.set(c.id, {
      root: c,
      replies: repliesByRootId.get(c.id) ?? [],
    });
  }

  for (const t of threadsByRootId.values()) {
    t.replies.sort(compareComments);
  }

  return [...threadsByRootId.values()].sort((a, b) =>
    compareComments(a.root, b.root),
  );
}

function findLatest(
  topLevel: Comment,
  descendants: Comment[],
): Comment {
  let latest: Comment = topLevel;
  for (const a of descendants) {
    if (compareComments(a, latest) > 0) latest = a;
  }
  return latest;
}

// The human Comment that should carry the webapp "Send to {agent}"
// button in a Thread, or null when no Send button should appear anywhere
// (issue #190, PRD #181). At most one Send per Thread.
//
// Rule: the latest Comment in the Thread (by `created_at`, id
// ascending tiebreak — matching `buildThreads`) is always a leaf in a
// well-formed tree (its parent must have an earlier or equal
// `created_at`). So "latest human leaf" collapses to "latest overall,
// if human; otherwise null". If the latest turn is agent-authored, the
// user is expected to write a human Reply first — which then becomes
// the new latest leaf and surfaces the Send button.
//
// Pure thread-level computation; `canSendToAgent` stays a pure
// per-Comment predicate, and the gating lives at the render site.
export function latestHumanLeafId(
  topLevel: Comment,
  descendants: Comment[],
): string | null {
  const latest = findLatest(topLevel, descendants);
  return latest.author_kind === "human" ? latest.id : null;
}

// The id of the latest Comment in the Thread (by `created_at`, id
// ascending tiebreak). Used by the webapp's single bottom action row
// (issue #191): the Reply button's onOpenReply fires with this id so
// a new Reply continues from where the conversation is, not from
// where it started.
export function latestCommentId(
  topLevel: Comment,
  descendants: Comment[],
): string {
  return findLatest(topLevel, descendants).id;
}

export function topLevelComments(comments: Comment[]): Comment[] {
  return comments.filter((c) => c.thread_id === undefined);
}
