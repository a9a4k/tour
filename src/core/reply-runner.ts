import { join } from "node:path";
import {
  appendAnnotation,
  buildReplyAnnotation,
  readAnnotations,
} from "./annotations-store.js";
import { getTour } from "./tour-store.js";
import { shouldDispatchReply } from "./reply-dispatch.js";
import {
  readReplyLock,
  writeReplyLock,
  deleteReplyLock,
} from "./reply-lock.js";
import {
  buildEnvelope,
  spawnReplyAgent,
  type ShippedAdapter,
} from "./agent-adapter.js";
import { replyAgentSystemPrompt } from "./system-prompt.js";
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
    const annotations = await this.readSafely();
    for (const a of annotations) this.seen.add(a.id);
    this.initialized = true;
  }

  async tick(): Promise<void> {
    if (!this.initialized) await this.prime();
    if (this.inFlight) return;

    const annotations = await this.readSafely();
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

  private async readSafely(): Promise<Annotation[]> {
    try {
      return await readAnnotations(this.opts.cwd, this.opts.tourId);
    } catch {
      return [];
    }
  }

  private async dispatch(
    triggering: Annotation,
    annotations: Annotation[],
  ): Promise<void> {
    this.inFlight = true;
    try {
      const tour = await getTour(this.opts.cwd, this.opts.tourId);
      const envelope = buildEnvelope(tour, annotations, triggering);
      const tourDir = join(this.opts.cwd, ".tour", this.opts.tourId);

      // Write a placeholder lock with pid=0 first so the renderer's pill
      // surfaces *before* the spawn returns. started_at is captured once so
      // the pill's age counter is stable across the placeholder/patch
      // sequence.
      const startedAt = new Date().toISOString();
      const lockBase = {
        agent: this.opts.agent,
        responding_to: triggering.id,
        started_at: startedAt,
      };
      await writeReplyLock(this.opts.cwd, this.opts.tourId, {
        ...lockBase,
        pid: 0,
      });

      const spawned = spawnReplyAgent({
        agent: this.opts.agent,
        envelope,
        systemPrompt: replyAgentSystemPrompt(),
        cwd: this.opts.cwd,
        tourDir,
        adapter: this.opts.adapter,
      });
      await writeReplyLock(this.opts.cwd, this.opts.tourId, {
        ...lockBase,
        pid: spawned.pid,
      });

      const result = await spawned.exit;
      await this.persistReply(triggering, result);
    } finally {
      await deleteReplyLock(this.opts.cwd, this.opts.tourId);
      this.inFlight = false;
    }
  }

  // Stdout-as-reply contract (ADR 0012): trim, then write iff the agent
  // exited cleanly with a non-empty body. Spawn errors, non-zero exits and
  // empty stdout all log a clear stderr line and skip the write.
  private async persistReply(
    triggering: Annotation,
    result: { code: number | null; stdout: string; error?: Error },
  ): Promise<void> {
    const agent = this.opts.agent;
    if (result.error) {
      process.stderr.write(
        `reply-agent ${agent}: spawn failed: ${result.error.message}\n`,
      );
      return;
    }
    if (result.code !== 0) {
      process.stderr.write(
        `reply-agent ${agent}: exited with code ${result.code} — no reply written\n`,
      );
      return;
    }
    const body = result.stdout.trim();
    if (body === "") {
      process.stderr.write(
        `reply-agent ${agent}: produced no output — no reply written\n`,
      );
      return;
    }
    const reply = buildReplyAnnotation(triggering, agent, body);
    await appendAnnotation(this.opts.cwd, this.opts.tourId, reply);
  }
}
