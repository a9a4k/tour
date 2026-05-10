import type {
  ReplyEnvelope,
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
} from "../core/agent-adapter.js";
import { spawnCli } from "./spawn.js";
import { combinedPrompt } from "./prompt.js";

// Tour reply-agent for OpenAI's `codex` CLI.
//
// Per ADR 0012 the agent has zero tools — no allow/deny configuration.
// `codex exec` is the non-interactive single-shot subcommand; codex has no
// per-invocation `--system-prompt` flag, so the canonical system prompt is
// folded into the user prompt with a clear delimiter (see `combinedPrompt`).
// `--skip-git-repo-check` lets codex run inside Tour's working directory
// without insisting it be a fresh repo — Tour pins the diff itself.
export function buildArgs(envelope: ReplyEnvelope, systemPrompt: string): string[] {
  return [
    "exec",
    "--skip-git-repo-check",
    combinedPrompt(envelope, systemPrompt),
  ];
}

export const codexAdapter: ShippedAdapter = {
  spawn(opts: SpawnOpts): SpawnedAdapter {
    return spawnCli("codex", buildArgs(opts.envelope, opts.systemPrompt), opts);
  },
};
