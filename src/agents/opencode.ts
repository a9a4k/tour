import type {
  ReplyEnvelope,
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
} from "../core/agent-adapter.js";
import { spawnCli } from "./spawn.js";
import { combinedPrompt } from "./prompt.js";

// Tour reply-agent for the `opencode` CLI.
//
// Per ADR 0012 the agent has zero tools. The previous bash adapter
// materialised an ephemeral opencode.json with permission rules to gate
// tool access; with zero-tools-by-prompt that machinery is gone. opencode
// has no per-invocation `--system-prompt` flag, so the canonical system
// prompt is folded into the user prompt.
export function buildArgs(envelope: ReplyEnvelope, systemPrompt: string): string[] {
  return [
    "run",
    combinedPrompt(envelope, systemPrompt),
  ];
}

export const opencodeAdapter: ShippedAdapter = {
  spawn(opts: SpawnOpts): SpawnedAdapter {
    return spawnCli("opencode", buildArgs(opts.envelope, opts.systemPrompt), opts);
  },
};
