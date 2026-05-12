import type { AuthorKind } from "./types.js";

// Pure predicate consumed by both surfaces (TUI footer hint + webapp card
// action) to decide visibility and enabled state of the "Send to {agent}"
// affordance on an Annotation card.
//
// Visibility hides the affordance entirely (no muted button, no footer
// hint). Disabled keeps it visible but unclickable / dimmed.
//
// Conflict precedence:
//   - agent-card > no-reply-agent: the card-level reason wins. An agent-
//     authored card never carries the affordance even if the renderer is
//     later restarted with --reply-agent.
//   - already-replied > lock-held: one-shot terminal beats the transient
//     in-flight lock. Once a Reply has landed, the affordance is hidden
//     forever for this parent, regardless of whether the lock is currently
//     held by some other dispatch on the tour.
export interface CanSendToAgentInput {
  replyAgentConfigured: boolean;
  lockHeld: boolean;
  authorKind: AuthorKind;
  hasReply: boolean;
}

export type CanSendToAgentReason =
  | "no-reply-agent"
  | "lock-held"
  | "agent-card"
  | "already-replied";

export interface CanSendToAgentResult {
  visible: boolean;
  enabled: boolean;
  reason?: CanSendToAgentReason;
}

export function canSendToAgent(
  input: CanSendToAgentInput,
): CanSendToAgentResult {
  if (input.authorKind === "agent") {
    return { visible: false, enabled: false, reason: "agent-card" };
  }
  if (!input.replyAgentConfigured) {
    return { visible: false, enabled: false, reason: "no-reply-agent" };
  }
  if (input.hasReply) {
    return { visible: false, enabled: false, reason: "already-replied" };
  }
  if (input.lockHeld) {
    return { visible: true, enabled: false, reason: "lock-held" };
  }
  return { visible: true, enabled: true };
}
