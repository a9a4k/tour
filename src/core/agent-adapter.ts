import type { Comment, Tour } from "./types.js";
import { buildThreads } from "./threads.js";
import { combinedPrompt, userPrompt } from "../agents/prompt.js";
import { spawnCli as spawnCliDefault } from "../agents/spawn.js";
import { assertRenderedCommand, renderCommandTemplate } from "./command-template.js";
import { REPLY_AGENT_PLACEHOLDERS } from "./reply-agent-template.js";

// JSON envelope handed to a shipped reply-agent's argv-builder. Contains
// everything an agent needs to compose a reply without re-reading the
// tour's filesystem state.
export interface ReplyEnvelope {
  tour: Tour;
  triggering_comment: Comment;
  thread: Comment[];
}

export function buildEnvelope(
  tour: Tour,
  comments: Comment[],
  triggering: Comment,
): ReplyEnvelope {
  const thread = buildThreads(comments).find(
    (t) =>
      t.root.id === triggering.id ||
      t.replies.some((r) => r.id === triggering.id),
  );
  const chain = thread ? [thread.root, ...thread.replies] : [triggering];
  return { tour, triggering_comment: triggering, thread: chain };
}

export interface SpawnOpts {
  envelope: ReplyEnvelope;
  systemPrompt: string;
  cwd: string;
  tourDir: string;
}

export interface SpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  // Set when the spawn itself failed (e.g. ENOENT for an inner CLI not on
  // PATH). The runner surfaces this on stderr instead of swallowing it.
  error?: Error;
}

// Per-chunk callback for an observable stream. The runner attaches one to
// each of stdout / stderr to drive the dispatch logger (ADR 0014); the
// shared spawn helper also feeds the buffered `result.stdout` for the
// stdout-as-reply contract (ADR 0012). Chunks are decoded utf8 strings.
export type StreamListener = (chunk: string) => void;

export interface SpawnedAdapter {
  pid: number;
  // Register a per-chunk listener for stdout / stderr. May be called
  // multiple times to attach multiple listeners; chunks are delivered in
  // arrival order to all attached listeners.
  onStdout: (cb: StreamListener) => void;
  onStderr: (cb: StreamListener) => void;
  exit: Promise<SpawnResult>;
}

export type ReplyAgentSpawner = (
  cmd: string,
  args: string[],
  opts: SpawnOpts,
) => SpawnedAdapter;

export interface SpawnReplyAgentOptions {
  // Command template configured through --reply-agent or reply_agent.
  agent: string;
  envelope: ReplyEnvelope;
  systemPrompt: string;
  cwd: string;
  tourDir: string;
  // Test-only override for the process spawn seam.
  spawnCli?: ReplyAgentSpawner;
}

// Renders the configured command template and spawns its inner CLI.
export function spawnReplyAgent(opts: SpawnReplyAgentOptions): SpawnedAdapter {
  const substitutions = {
    systemPrompt: opts.systemPrompt,
    userPrompt: userPrompt(opts.envelope),
    combinedPrompt: combinedPrompt(opts.envelope, opts.systemPrompt),
  };
  const argv = assertRenderedCommand(
    renderCommandTemplate(opts.agent, substitutions, REPLY_AGENT_PLACEHOLDERS),
  );
  const [cmd, ...args] = argv;
  if (!cmd) throw new Error("Reply-agent template rendered an empty command");
  const spawnCli = opts.spawnCli ?? spawnCliDefault;
  return spawnCli(cmd, args, {
    envelope: opts.envelope,
    systemPrompt: opts.systemPrompt,
    cwd: opts.cwd,
    tourDir: opts.tourDir,
  });
}
