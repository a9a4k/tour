import type { ReplyEnvelope } from "../core/agent-adapter.js";

// User prompt frame shared across all shipped reply-agents. Wraps the JSON
// envelope in clear delimiters so the agent can locate the triggering
// comment and the rest of the thread chain. The "write your reply
// directly to stdout" instruction is the per-invocation reinforcement of the
// stdout-as-reply contract from ADR 0012; the canonical reinforcement lives
// in the system prompt.
export function userPrompt(envelope: ReplyEnvelope): string {
  return `A human reviewer just left a note in Tour ${envelope.tour.id}. The JSON envelope below contains the tour metadata, the triggering comment, and the full thread chain.

<envelope>
${JSON.stringify(envelope, null, 2)}
</envelope>

Read the triggering_comment and the thread, then write your reply directly to stdout. Reply to the triggering comment (id: ${envelope.triggering_comment.id}).`;
}

// Concatenated system + user prompt for CLIs whose argv has no separate
// system-prompt flag (codex, gemini, opencode). A clear delimiter keeps the
// model from blending the two roles.
export function combinedPrompt(envelope: ReplyEnvelope, systemPrompt: string): string {
  return `<system>
${systemPrompt}
</system>

${userPrompt(envelope)}`;
}
