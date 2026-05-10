import type {
  ReplyEnvelope,
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
} from "../core/agent-adapter.js";
import { spawnCli } from "./spawn.js";
import { combinedPrompt } from "./prompt.js";

// Tour reply-agent for Google's `gemini` CLI.
//
// Per ADR 0012 the agent has zero tools — no `--allowed-tools`, no
// `--exclude-tools`. Gemini has no separate `--system-prompt` flag, so the
// canonical system prompt is folded into the user prompt.
export function buildArgs(envelope: ReplyEnvelope, systemPrompt: string): string[] {
  return [
    "--prompt",
    combinedPrompt(envelope, systemPrompt),
  ];
}

export const geminiAdapter: ShippedAdapter = {
  spawn(opts: SpawnOpts): SpawnedAdapter {
    return spawnCli("gemini", buildArgs(opts.envelope, opts.systemPrompt), opts);
  },
};
