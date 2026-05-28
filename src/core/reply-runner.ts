import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import {
  createReply,
  readComments,
} from "./comments-store.js";
import { getTour } from "./tour-store.js";
import { shouldDispatchReply } from "./reply-dispatch.js";
import {
  writeReplyLock,
  deleteReplyLock,
  tryAcquireReplyLock,
} from "./reply-lock.js";
import {
  buildEnvelope,
  spawnReplyAgent,
  type ReplyAgentSpawner,
} from "./agent-adapter.js";
import { replyAgentSystemPrompt } from "./system-prompt.js";
import { createDispatchLogger } from "./dispatch-logger.js";
import type { Comment } from "./types.js";

// The single dispatch entry point both surfaces converge on (issue #182).
// Validates the comment, atomically acquires the per-tour reply lock,
// and delegates to the shared `runDispatch` helper. The watcher's
// auto-dispatch path was removed in issue #184 (ADR 0021); user action
// — `s` in the TUI, "Request reply" in the webapp — is the only path
// to a reply-agent spawn now.
export interface RequestReplyOptions {
  cwd: string;
  tourStoreRoot?: string;
  tourId: string;
  commentId: string;
  // The renderer-configured reply-agent template. Absent / empty means the
  // renderer was launched without `--reply-agent` and dispatch is refused
  // at the seam.
  agent?: string;
  // Test-only override so callers can inject a fake process spawn.
  spawnCli?: ReplyAgentSpawner;
}

export type RequestReplyResult =
  | { kind: "dispatched" }
  | { kind: "busy" }
  | { kind: "invalid-comment" }
  | { kind: "no-reply-agent" };

// HTTP status mapping for `POST /api/tours/:id/request-reply` (issue
// #184). Extracted so it's unit-testable in isolation and so both the
// server endpoint and any future surface (e.g. a JSON-RPC bridge) use
// the same mapping. The mapping is the user-facing contract — the
// PRD pins it explicitly: 202 dispatched / 409 busy / 404 invalid-
// comment / 400 no-reply-agent.
export function httpStatusForRequestReplyResult(
  result: RequestReplyResult,
): number {
  switch (result.kind) {
    case "dispatched":
      return 202;
    case "busy":
      return 409;
    case "invalid-comment":
      return 404;
    case "no-reply-agent":
      return 400;
  }
}

export async function requestReply(
  opts: RequestReplyOptions,
): Promise<RequestReplyResult> {
  if (!opts.agent) return { kind: "no-reply-agent" };
  const tourStoreRoot = opts.tourStoreRoot ?? opts.cwd;

  const comments = await readCommentsSafely(tourStoreRoot, opts.tourId);
  const triggering = comments.find((a) => a.id === opts.commentId);
  // Three precondition rejections collapse to one result kind — the caller
  // only needs "this comment isn't a valid dispatch target", not the
  // sub-reason (the UI already encoded those at affordance-visibility time
  // via `canSendToAgent`; defence-in-depth here is enough).
  if (!triggering) return { kind: "invalid-comment" };
  if (!shouldDispatchReply(triggering)) return { kind: "invalid-comment" };
  if (comments.some((a) => a.thread_id === opts.commentId)) {
    return { kind: "invalid-comment" };
  }

  const startedAt = new Date().toISOString();
  const acquired = await tryAcquireReplyLock(tourStoreRoot, opts.tourId, {
    agent: opts.agent,
    responding_to: opts.commentId,
    started_at: startedAt,
    pid: 0,
  });
  if (!acquired) return { kind: "busy" };

  await runDispatch({
    cwd: opts.cwd,
    tourStoreRoot,
    tourId: opts.tourId,
    agent: opts.agent,
    spawnCli: opts.spawnCli,
    triggering,
    comments,
    startedAt,
  });
  return { kind: "dispatched" };
}

async function readCommentsSafely(
  tourStoreRoot: string,
  tourId: string,
): Promise<Comment[]> {
  try {
    return await readComments(tourStoreRoot, tourId);
  } catch {
    return [];
  }
}

// Shared spawn-and-persist-and-release helper. Assumes the caller has
// already written the pid=0 placeholder lock so the renderer's pill is
// visible during spawn setup; releases the lock in its own `finally`.
interface RunDispatchOptions {
  cwd: string;
  tourStoreRoot: string;
  tourId: string;
  agent: string;
  spawnCli?: ReplyAgentSpawner;
  triggering: Comment;
  comments: Comment[];
  startedAt: string;
}

async function runDispatch(opts: RunDispatchOptions): Promise<void> {
  try {
    const tour = await getTour(opts.tourStoreRoot, opts.tourId);
    const envelope = buildEnvelope(tour, opts.comments, opts.triggering);
    const tourDir = join(opts.tourStoreRoot, opts.tourId);
    const systemPrompt = replyAgentSystemPrompt();
    const logPath = join(tourDir, "logs", `reply-${opts.triggering.id}.log`);

    const spawned = spawnReplyAgent({
      agent: opts.agent,
      envelope,
      systemPrompt,
      cwd: opts.cwd,
      tourDir,
      spawnCli: opts.spawnCli,
    });
    await writeReplyLock(opts.tourStoreRoot, opts.tourId, {
      agent: opts.agent,
      responding_to: opts.triggering.id,
      started_at: opts.startedAt,
      pid: spawned.pid,
    });

    const logger = await createDispatchLogger(logPath, {
      agent: opts.agent,
      triggeringId: opts.triggering.id,
      tourId: opts.tourId,
      startedAt: opts.startedAt,
      pid: spawned.pid,
      envelopeBytes: Buffer.byteLength(JSON.stringify(envelope), "utf8"),
      systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
    });
    spawned.onStdout((chunk) => {
      void logger.onStdout(chunk);
    });
    spawned.onStderr((chunk) => {
      void logger.onStderr(chunk);
    });

    const result = await spawned.exit;
    await logger.finalize({
      code: result.code,
      signal: result.signal,
      durationMs: Date.now() - Date.parse(opts.startedAt),
      error: result.error,
    });
    await persistReply(opts.tourStoreRoot, opts.tourId, opts.agent, opts.triggering, result, logPath);
  } finally {
    await deleteReplyLock(opts.tourStoreRoot, opts.tourId);
  }
}

// Stdout-as-reply contract (ADR 0012): trim, then write iff the agent
// exited cleanly with a non-empty body. Spawn errors, non-zero exits and
// empty stdout all log a clear stderr line and skip the write. Each
// failure-mode line carries a `; see <log path>` suffix (ADR 0014) so the
// user can inspect the dispatch log to find out *why*.
async function persistReply(
  cwd: string,
  tourId: string,
  agent: string,
  triggering: Comment,
  result: { code: number | null; stdout: string; error?: Error },
  logPath: string,
): Promise<void> {
  if (result.error) {
    process.stderr.write(
      `reply-agent ${agent}: spawn failed: ${result.error.message}; see ${logPath}\n`,
    );
    return;
  }
  if (result.code !== 0) {
    process.stderr.write(
      `reply-agent ${agent}: exited with code ${result.code} — no reply written; see ${logPath}\n`,
    );
    return;
  }
  const body = result.stdout.trim();
  if (body === "") {
    // Empty stdout is a normal dispatch completion (ADR 0015) — the seam
    // would reject the empty body anyway (PRD #140 rule 1/5), so we
    // short-circuit, record a rejection entry in the dispatch log (header
    // already carries agent + triggering id), and skip the write. The
    // lock clears via the caller's finally.
    await appendFile(logPath, "=== rejected: empty body — no reply written\n");
    process.stderr.write(
      `reply-agent ${agent}: produced no output — no reply written; see ${logPath}\n`,
    );
    return;
  }
  await createReply(cwd, tourId, {
    thread_id: triggering.thread_id ?? triggering.id,
    body,
    author: "agent",
    author_kind: "agent",
  });
}
