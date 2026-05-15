import type { Comment, Tour } from "./types.js";
import { buildThreads } from "./threads.js";
import { SHIPPED_ADAPTERS, availableShippedAgents } from "../agents/index.js";

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

export interface ShippedAdapter {
  spawn(opts: SpawnOpts): SpawnedAdapter;
}

export interface SpawnReplyAgentOptions {
  agent: string;
  envelope: ReplyEnvelope;
  systemPrompt: string;
  cwd: string;
  tourDir: string;
  // Test-only override that bypasses the registry. Replaces the prior
  // shell-script `adapterPath` seam.
  adapter?: ShippedAdapter;
}

// Resolves the named shipped adapter from the registry (or uses the
// override) and spawns its inner CLI. Throws on unknown name.
export function spawnReplyAgent(opts: SpawnReplyAgentOptions): SpawnedAdapter {
  const adapter = opts.adapter ?? SHIPPED_ADAPTERS[opts.agent];
  if (!adapter) {
    throw new Error(
      `Unknown reply-agent "${opts.agent}". Available agents: ${availableShippedAgents().join(", ")}`,
    );
  }
  return adapter.spawn({
    envelope: opts.envelope,
    systemPrompt: opts.systemPrompt,
    cwd: opts.cwd,
    tourDir: opts.tourDir,
  });
}
