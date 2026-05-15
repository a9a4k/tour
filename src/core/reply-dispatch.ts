import type { Comment } from "./types.js";

// The named home for the reply-agent trigger rule. A reply-agent fires iff
// the inbound Comment was authored by a human. Agent-authored Comments
// (the initial review, or a reply-agent's own response) never re-trigger —
// otherwise the agent would talk to itself.
export function shouldDispatchReply(comment: Comment): boolean {
  return comment.author_kind === "human";
}
