// Issue #389 / ADR 0036 (Slice E).
//
// Webapp delete-confirm modal cascade preview. The outcome union and the
// rendered string live in `core/delete-cascade.ts` — shared with the TUI
// so wording changes happen in one place. This file is the webapp-local
// input-shape adapter: classify a flat `Comment[]` (no Thread structure
// on the client) into the shared `DeleteCascade` shape.

import type { Comment } from "./types.js";
import type { DeleteCascade } from "../../core/delete-cascade.js";
export { renderDeleteCascade as renderDeleteCascadeNote } from "../../core/delete-cascade.js";
export type { DeleteCascade as DeleteCascadeNote } from "../../core/delete-cascade.js";

function isLive(c: Comment): boolean {
  return c.deleted === undefined;
}

export function computeDeleteCascadeNote(
  target: Comment,
  comments: ReadonlyArray<Comment>,
): DeleteCascade {
  if (target.thread_id !== undefined) {
    const parent = comments.find((c) => c.id === target.thread_id);
    const parentLive = parent !== undefined && isLive(parent);
    const liveSiblings = comments.filter(
      (c) =>
        c.thread_id === target.thread_id && c.id !== target.id && isLive(c),
    ).length;
    if (!parentLive && liveSiblings === 0) {
      return { kind: "thread-vanishes" };
    }
    return { kind: "reply-only" };
  }
  const surviving = comments.filter(
    (c) => c.thread_id === target.id && isLive(c),
  ).length;
  if (surviving === 0) return { kind: "thread-vanishes" };
  return { kind: "parent-stub", survivorCount: surviving };
}
