import type {
  ReplyEnvelope,
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
} from "../core/agent-adapter.js";
import { spawnCli } from "./spawn.js";
import { userPrompt } from "./prompt.js";

// Tour reply-agent for Anthropic's `claude` CLI (Claude Code).
//
// Per ADR 0012 the agent has zero tools — no `--allowedTools`, no
// `--disallowedTools`. Tour spawns claude in non-interactive print mode,
// captures stdout, and writes that as the Reply Comment body. The
// system prompt does the rest of the work.
export function buildArgs(envelope: ReplyEnvelope, systemPrompt: string): string[] {
  return [
    "--print",
    "--system-prompt",
    systemPrompt,
    userPrompt(envelope),
  ];
}

export const claudeAdapter: ShippedAdapter = {
  spawn(opts: SpawnOpts): SpawnedAdapter {
    return spawnCli("claude", buildArgs(opts.envelope, opts.systemPrompt), opts);
  },
};
