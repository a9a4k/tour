import { describe, it, expect } from "vitest";
import { canSendToAgent } from "../../src/core/can-send-to-agent.js";

// Pure-predicate exhaustive table across the four input dimensions
// (replyAgentConfigured × lockHeld × authorKind × hasReply). 2×2×2×2 = 16.
// Reason precedence under conflicting blockers:
//   visibility: agent-card > no-reply-agent  (the card-level reason wins,
//     because the affordance is structurally absent on agent cards even
//     if the renderer is later restarted with --reply-agent set)
//   enabled:    already-replied > lock-held  (one-shot terminal beats the
//     transient in-flight lock — the affordance is gone for this parent
//     forever, regardless of lock state)
describe("canSendToAgent", () => {
  it("visible+enabled when human card, configured, no lock, no reply", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: true,
        lockHeld: false,
        authorKind: "human",
        hasReply: false,
      }),
    ).toEqual({ visible: true, enabled: true });
  });

  it("visible+disabled with reason=lock-held when lock is held tour-wide", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: true,
        lockHeld: true,
        authorKind: "human",
        hasReply: false,
      }),
    ).toEqual({ visible: true, enabled: false, reason: "lock-held" });
  });

  it("visible+disabled with reason=already-replied when the parent has a Reply (one-shot terminal)", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: true,
        lockHeld: false,
        authorKind: "human",
        hasReply: true,
      }),
    ).toEqual({ visible: true, enabled: false, reason: "already-replied" });
  });

  it("already-replied wins over lock-held when both are true", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: true,
        lockHeld: true,
        authorKind: "human",
        hasReply: true,
      }),
    ).toEqual({ visible: true, enabled: false, reason: "already-replied" });
  });

  it("hidden with reason=no-reply-agent when the renderer was not launched with --reply-agent", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: false,
        lockHeld: false,
        authorKind: "human",
        hasReply: false,
      }),
    ).toEqual({ visible: false, enabled: false, reason: "no-reply-agent" });
  });

  it("hidden with reason=agent-card on agent-authored cards (regardless of other inputs)", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: true,
        lockHeld: false,
        authorKind: "agent",
        hasReply: false,
      }),
    ).toEqual({ visible: false, enabled: false, reason: "agent-card" });
  });

  it("agent-card wins over no-reply-agent when both apply (card-level reason dominates)", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: false,
        lockHeld: false,
        authorKind: "agent",
        hasReply: false,
      }),
    ).toEqual({ visible: false, enabled: false, reason: "agent-card" });
  });

  it("agent-card holds even when the agent card has no reply yet and lock is held", () => {
    expect(
      canSendToAgent({
        replyAgentConfigured: true,
        lockHeld: true,
        authorKind: "agent",
        hasReply: true,
      }),
    ).toEqual({ visible: false, enabled: false, reason: "agent-card" });
  });

  // Exhaustive sweep — every remaining input combination must match the rules
  // above. The table lists (configured, lockHeld, authorKind, hasReply) and
  // the expected output.
  it.each<{
    cfg: boolean;
    lock: boolean;
    kind: "human" | "agent";
    rep: boolean;
    out: ReturnType<typeof canSendToAgent>;
  }>([
    // Configured, lock=false, human
    { cfg: true,  lock: false, kind: "human", rep: false, out: { visible: true, enabled: true } },
    { cfg: true,  lock: false, kind: "human", rep: true,  out: { visible: true, enabled: false, reason: "already-replied" } },
    // Configured, lock=true, human
    { cfg: true,  lock: true,  kind: "human", rep: false, out: { visible: true, enabled: false, reason: "lock-held" } },
    { cfg: true,  lock: true,  kind: "human", rep: true,  out: { visible: true, enabled: false, reason: "already-replied" } },
    // Configured, agent (all hidden — agent-card dominates)
    { cfg: true,  lock: false, kind: "agent", rep: false, out: { visible: false, enabled: false, reason: "agent-card" } },
    { cfg: true,  lock: false, kind: "agent", rep: true,  out: { visible: false, enabled: false, reason: "agent-card" } },
    { cfg: true,  lock: true,  kind: "agent", rep: false, out: { visible: false, enabled: false, reason: "agent-card" } },
    { cfg: true,  lock: true,  kind: "agent", rep: true,  out: { visible: false, enabled: false, reason: "agent-card" } },
    // Not configured, human (all hidden — no-reply-agent)
    { cfg: false, lock: false, kind: "human", rep: false, out: { visible: false, enabled: false, reason: "no-reply-agent" } },
    { cfg: false, lock: false, kind: "human", rep: true,  out: { visible: false, enabled: false, reason: "no-reply-agent" } },
    { cfg: false, lock: true,  kind: "human", rep: false, out: { visible: false, enabled: false, reason: "no-reply-agent" } },
    { cfg: false, lock: true,  kind: "human", rep: true,  out: { visible: false, enabled: false, reason: "no-reply-agent" } },
    // Not configured, agent (agent-card still wins over no-reply-agent)
    { cfg: false, lock: false, kind: "agent", rep: false, out: { visible: false, enabled: false, reason: "agent-card" } },
    { cfg: false, lock: false, kind: "agent", rep: true,  out: { visible: false, enabled: false, reason: "agent-card" } },
    { cfg: false, lock: true,  kind: "agent", rep: false, out: { visible: false, enabled: false, reason: "agent-card" } },
    { cfg: false, lock: true,  kind: "agent", rep: true,  out: { visible: false, enabled: false, reason: "agent-card" } },
  ])(
    "exhaustive: configured=$cfg lock=$lock kind=$kind hasReply=$rep",
    ({ cfg, lock, kind, rep, out }) => {
      expect(
        canSendToAgent({
          replyAgentConfigured: cfg,
          lockHeld: lock,
          authorKind: kind,
          hasReply: rep,
        }),
      ).toEqual(out);
    },
  );
});
