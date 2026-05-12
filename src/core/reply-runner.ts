import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import {
  createReply,
  readAnnotations,
} from "./annotations-store.js";
import { getTour } from "./tour-store.js";
import { shouldDispatchReply } from "./reply-dispatch.js";
import {
  readReplyLock,
  writeReplyLock,
  deleteReplyLock,
  tryAcquireReplyLock,
} from "./reply-lock.js";
import {
  buildEnvelope,
  spawnReplyAgent,
  type ShippedAdapter,
} from "./agent-adapter.js";
import { replyAgentSystemPrompt } from "./system-prompt.js";
import { createDispatchLogger } from "./dispatch-logger.js";
import type { Annotation } from "./types.js";

export interface ReplyRunnerOptions {
  cwd: string;
  tourId: string;
  agent: string;
  // Optional override so tests can supply a fake adapter without touching
  // the shipped registry. Replaces the prior shell-script `adapterPath`
  // seam.
  adapter?: ShippedAdapter;
}

// Watches an in-memory snapshot of the tour's annotations, dispatches the
// shipped reply-agent once when a new human-authored Annotation appears,
// holds the per-tour single-flight lock, captures the agent's stdout, and
// writes that as the Reply Annotation (ADR 0012) when usable.
//
// Drives off explicit `tick()` calls — caller (renderer) wires this to the
// watcher's `annotation-changed` event so the runner re-reads
// annotations.jsonl on every change.
export class ReplyRunner {
  private readonly opts: ReplyRunnerOptions;
  private readonly seen = new Set<string>();
  private inFlight = false;
  private initialized = false;

  constructor(opts: ReplyRunnerOptions) {
    this.opts = opts;
  }

  // Seed the seen-set from the current annotations file so that pre-existing
  // human-authored Annotations don't fire the agent on first launch. Call
  // once before wiring up the watcher.
  async prime(): Promise<void> {
    const annotations = await readAnnotationsSafely(
      this.opts.cwd,
      this.opts.tourId,
    );
    for (const a of annotations) this.seen.add(a.id);
    this.initialized = true;
  }

  async tick(): Promise<void> {
    if (!this.initialized) await this.prime();
    if (this.inFlight) return;

    const annotations = await readAnnotationsSafely(
      this.opts.cwd,
      this.opts.tourId,
    );
    const newlyHuman: Annotation[] = [];
    for (const a of annotations) {
      if (this.seen.has(a.id)) continue;
      this.seen.add(a.id);
      if (shouldDispatchReply(a)) newlyHuman.push(a);
    }
    if (newlyHuman.length === 0) return;

    // Queue-of-1 semantics per the PRD: collapse multiple newly-arrived
    // human Annotations into a single dispatch on the latest one. The agent
    // re-reads the full thread state via the envelope, so older triggers
    // are not lost — they're folded into context.
    const triggering = newlyHuman[newlyHuman.length - 1];
    if (await readReplyLock(this.opts.cwd, this.opts.tourId)) return;
    await this.dispatch(triggering, annotations);
  }

  private async dispatch(
    triggering: Annotation,
    annotations: Annotation[],
  ): Promise<void> {
    this.inFlight = true;
    try {
      // Write a placeholder lock with pid=0 first so the renderer's pill
      // surfaces *before* the spawn returns. started_at is captured once so
      // the pill's age counter is stable across the placeholder/patch
      // sequence.
      const startedAt = new Date().toISOString();
      await writeReplyLock(this.opts.cwd, this.opts.tourId, {
        agent: this.opts.agent,
        responding_to: triggering.id,
        started_at: startedAt,
        pid: 0,
      });
      await runDispatch({
        cwd: this.opts.cwd,
        tourId: this.opts.tourId,
        agent: this.opts.agent,
        adapter: this.opts.adapter,
        triggering,
        annotations,
        startedAt,
      });
    } finally {
      this.inFlight = false;
    }
  }
}

// The single dispatch entry point both surfaces converge on (issue #182).
// Validates the annotation, atomically acquires the per-tour reply lock,
// and delegates to the shared `runDispatch` helper. The watcher-driven
// `ReplyRunner` path remains for back-compat; subsequent slices will
// retire it in favour of explicit user-triggered dispatch.
export interface RequestReplyOptions {
  cwd: string;
  tourId: string;
  annotationId: string;
  // The renderer-configured reply-agent name. Absent / empty means the
  // renderer was launched without `--reply-agent` and dispatch is refused
  // at the seam.
  agent?: string;
  // Test-only override so callers can inject a fake adapter without
  // touching the shipped registry. Mirrors `ReplyRunnerOptions.adapter`.
  adapter?: ShippedAdapter;
}

export type RequestReplyResult =
  | { kind: "dispatched" }
  | { kind: "busy" }
  | { kind: "invalid-annotation" }
  | { kind: "no-reply-agent" };

export async function requestReply(
  opts: RequestReplyOptions,
): Promise<RequestReplyResult> {
  if (!opts.agent) return { kind: "no-reply-agent" };

  const annotations = await readAnnotationsSafely(opts.cwd, opts.tourId);
  const triggering = annotations.find((a) => a.id === opts.annotationId);
  // Three precondition rejections collapse to one result kind — the caller
  // only needs "this annotation isn't a valid dispatch target", not the
  // sub-reason (the UI already encoded those at affordance-visibility time
  // via `canSendToAgent`; defence-in-depth here is enough).
  if (!triggering) return { kind: "invalid-annotation" };
  if (!shouldDispatchReply(triggering)) return { kind: "invalid-annotation" };
  if (annotations.some((a) => a.replies_to === opts.annotationId)) {
    return { kind: "invalid-annotation" };
  }

  const startedAt = new Date().toISOString();
  const acquired = await tryAcquireReplyLock(opts.cwd, opts.tourId, {
    agent: opts.agent,
    responding_to: opts.annotationId,
    started_at: startedAt,
    pid: 0,
  });
  if (!acquired) return { kind: "busy" };

  await runDispatch({
    cwd: opts.cwd,
    tourId: opts.tourId,
    agent: opts.agent,
    adapter: opts.adapter,
    triggering,
    annotations,
    startedAt,
  });
  return { kind: "dispatched" };
}

async function readAnnotationsSafely(
  cwd: string,
  tourId: string,
): Promise<Annotation[]> {
  try {
    return await readAnnotations(cwd, tourId);
  } catch {
    return [];
  }
}

// Shared spawn-and-persist-and-release helper used by both `ReplyRunner`
// and `requestReply`. Assumes the caller has already written the
// pid=0 placeholder lock so the renderer's pill is visible during spawn
// setup; releases the lock in its own `finally`.
interface RunDispatchOptions {
  cwd: string;
  tourId: string;
  agent: string;
  adapter?: ShippedAdapter;
  triggering: Annotation;
  annotations: Annotation[];
  startedAt: string;
}

async function runDispatch(opts: RunDispatchOptions): Promise<void> {
  try {
    const tour = await getTour(opts.cwd, opts.tourId);
    const envelope = buildEnvelope(tour, opts.annotations, opts.triggering);
    const tourDir = join(opts.cwd, ".tour", opts.tourId);
    const systemPrompt = replyAgentSystemPrompt();
    const logPath = join(tourDir, "logs", `reply-${opts.triggering.id}.log`);

    const spawned = spawnReplyAgent({
      agent: opts.agent,
      envelope,
      systemPrompt,
      cwd: opts.cwd,
      tourDir,
      adapter: opts.adapter,
    });
    await writeReplyLock(opts.cwd, opts.tourId, {
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
    await persistReply(opts.cwd, opts.tourId, opts.agent, opts.triggering, result, logPath);
  } finally {
    await deleteReplyLock(opts.cwd, opts.tourId);
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
  triggering: Annotation,
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
    replies_to: triggering.id,
    body,
    author: agent,
    author_kind: "agent",
  });
}
