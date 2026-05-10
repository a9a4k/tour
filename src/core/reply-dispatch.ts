import type { Annotation } from "./types.js";

// The named home for the reply-agent trigger rule. A reply-agent fires iff
// the inbound Annotation was authored by a human. Agent-authored Annotations
// (the initial review, or a reply-agent's own response) never re-trigger —
// otherwise the agent would talk to itself.
export function shouldDispatchReply(annotation: Annotation): boolean {
  return annotation.author_kind === "human";
}
