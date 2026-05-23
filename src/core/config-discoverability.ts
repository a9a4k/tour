import type { AuthorKind } from "./types.js";
import { canSendToAgent } from "./can-send-to-agent.js";

export function editorNotConfiguredMessage(configPath: string): string {
  return `o: editor not configured — set $TOUR_EDITOR, add \`editor\` to ${configPath}, or pass --editor`;
}

export function requestReplyConfigHint(configPath: string): string {
  return `Set \`reply_agent\` in ${configPath} to enable Request reply`;
}

export function shouldShowRequestReplyConfigHint(input: {
  replyAgentConfigured: boolean;
  authorKind: AuthorKind;
  hasReply: boolean;
}): boolean {
  if (input.hasReply) return false;
  return (
    canSendToAgent({
      replyAgentConfigured: input.replyAgentConfigured,
      lockHeld: false,
      authorKind: input.authorKind,
      hasReply: input.hasReply,
    }).reason === "no-reply-agent"
  );
}
