// Issue #389 / ADR 0036 (Slice E).
//
// Webapp delete-confirm modal cascade preview. Mirrors the C4 cascade
// from `core/events-fold.ts`: the user reads the note BEFORE the fold
// projects the deletion, so the message describes what they're about
// to set in motion. Three cases:
//
//   1. The target is the last live node in its Thread — the whole
//      Thread vanishes per C4.
//   2. The target is a Reply with siblings or a live parent — only
//      this Reply leaves the projection.
//   3. The target is a parent with ≥1 surviving Reply — the parent
//      collapses to a `[deleted]` stub and the Replies stay under it.

import type { Comment } from "./types.js";

export type DeleteCascadeNote =
  | { kind: "reply-only" }
  | { kind: "parent-stub"; surviving: number }
  | { kind: "thread-vanishes" };

function isLive(c: Comment): boolean {
  return c.deleted === undefined;
}

export function computeDeleteCascadeNote(
  target: Comment,
  comments: ReadonlyArray<Comment>,
): DeleteCascadeNote {
  if (target.replies_to !== undefined) {
    const parent = comments.find((c) => c.id === target.replies_to);
    const parentLive = parent !== undefined && isLive(parent);
    const liveSiblings = comments.filter(
      (c) =>
        c.replies_to === target.replies_to && c.id !== target.id && isLive(c),
    ).length;
    if (!parentLive && liveSiblings === 0) {
      return { kind: "thread-vanishes" };
    }
    return { kind: "reply-only" };
  }
  const surviving = comments.filter(
    (c) => c.replies_to === target.id && isLive(c),
  ).length;
  if (surviving === 0) return { kind: "thread-vanishes" };
  return { kind: "parent-stub", surviving };
}

export function renderDeleteCascadeNote(note: DeleteCascadeNote): string {
  switch (note.kind) {
    case "reply-only":
      return "this reply will be removed from the thread.";
    case "thread-vanishes":
      return "the thread will vanish.";
    case "parent-stub": {
      const replyWord = note.surviving === 1 ? "reply" : "replies";
      return `${note.surviving} ${replyWord} will remain under [deleted].`;
    }
  }
}
