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

// Walk the replies_to chain up to the top-level comment. Returns null if
// the chain hits an unknown id (orphan) or a cycle (malformed input).
function findRoot(start: Comment, byId: Map<string, Comment>): Comment | null {
  let cur = start;
  const seen = new Set<string>([cur.id]);
  while (cur.replies_to !== undefined) {
    const parent = byId.get(cur.replies_to);
    if (!parent) return null;
    if (seen.has(parent.id)) return null;
    seen.add(parent.id);
    cur = parent;
  }
  return cur;
}

export function buildThreads(comments: Comment[]): Thread[] {
  const byId = new Map<string, Comment>();
  for (const a of comments) byId.set(a.id, a);

  const threadsByRootId = new Map<string, Thread>();
  for (const a of comments) {
    if (a.replies_to === undefined) {
      threadsByRootId.set(a.id, { root: a, replies: [] });
    }
  }

  for (const a of comments) {
    if (a.replies_to === undefined) continue;
    const root = findRoot(a, byId);
    if (!root) continue;
    const t = threadsByRootId.get(root.id);
    if (!t) continue;
    t.replies.push(a);
  }

  for (const t of threadsByRootId.values()) {
    t.replies.sort(compareComments);
  }

  return [...threadsByRootId.values()].sort((a, b) =>
    compareComments(a.root, b.root),
  );
}

export function isTopLevel(a: Comment): boolean {
  return a.replies_to === undefined;
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
  return comments.filter(isTopLevel);
}
