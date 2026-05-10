import type {
  ReplyEnvelope,
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
} from "../core/agent-adapter.js";
import { spawnCli } from "./spawn.js";
import { userPrompt } from "./prompt.js";

// Tour reply-agent for the `pi` CLI (pi-coding-agent).
//
// Per ADR 0012 the agent has zero tools. Earlier the bash adapter passed
// `--tools bash` plus `--no-extensions/--no-skills/--no-prompt-templates/
// --no-context-files` to gate tool access; with stdout-as-reply those gates
// fall out — the only thing pi has to do is print the reply.
export function buildArgs(envelope: ReplyEnvelope, systemPrompt: string): string[] {
  return [
    "--print",
    "--system-prompt",
    systemPrompt,
    userPrompt(envelope),
  ];
}

export const piAdapter: ShippedAdapter = {
  spawn(opts: SpawnOpts): SpawnedAdapter {
    return spawnCli("pi", buildArgs(opts.envelope, opts.systemPrompt), opts);
  },
};
