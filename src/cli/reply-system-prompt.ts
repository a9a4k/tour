import { replyAgentSystemPrompt } from "../core/system-prompt.js";

export function replySystemPrompt(): void {
  process.stdout.write(replyAgentSystemPrompt());
}
