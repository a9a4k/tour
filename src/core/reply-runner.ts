import { join } from "node:path";
import { readAnnotations } from "./annotations-store.js";
import { getTour } from "./tour-store.js";
import { shouldDispatchReply } from "./reply-dispatch.js";
import {
  readReplyLock,
  writeReplyLock,
  deleteReplyLock,
} from "./reply-lock.js";
import { buildEnvelope, spawnAdapter } from "./agent-adapter.js";
import { buildThreads } from "./threads.js";
import type { Annotation } from "./types.js";

export interface ReplyRunnerOptions {
  cwd: string;
  tourId: string;
  agent: string;
  // Optional override so tests can supply a fake adapter without dropping a
  // real script under the user's $HOME/.config/tour/agents.
  adapterPath?: string;
}

// Watches an in-memory snapshot of the tour's annotations, dispatches the
// adapter once when a new human-authored Annotation appears, holds the
// per-tour single-flight lock, and clears it when the adapter exits.
//
// Drives off explicit `tick()` calls — caller (renderer) wires this to the
// watcher's `annotation-changed` event so the runner re-reads
// annotations.jsonl on every change.
export class ReplyRunner {
  private readonly opts: ReplyRunnerOptions;
  private readonly seen = new Set<string>();
  private inFlight = false;
  private initialized = false;
  private primePromise: Promise<void> | null = null;

  constructor(opts: ReplyRunnerOptions) {
    this.opts = opts;
  }

  // Seed the seen-set from the current annotations file so that pre-existing
  // entries don't all re-fire on first launch. Per-thread exception: if a
  // thread's last entry is `author_kind === "human"`, the agent owes a reply
  // — leave the trailing human entry OUT of seen so the next tick() picks it
  // up and dispatches. Handles both (a) the user wrote during prime() race
  // and (b) the user wrote while the server was off, then started the server.
  //
  // Memoized so concurrent prime()/tick() calls await the same promise rather
  // than racing parallel reads of the file.
  prime(): Promise<void> {
    if (!this.primePromise) {
      this.primePromise = (async () => {
        const annotations = await this.readSafely();
        for (const a of annotations) this.seen.add(a.id);
        for (const t of buildThreads(annotations)) {
          const chain = [t.root, ...t.replies];
          const last = chain[chain.length - 1];
          if (last && last.author_kind === "human") {
            this.seen.delete(last.id);
          }
        }
        this.initialized = true;
      })();
    }
    return this.primePromise;
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
      // surfaces *before* the spawn returns — fs.spawn is fast but the pill
      // needs to be visible from the moment of the human's reply, not from
      // the moment the child is up. started_at is captured once so the
      // pill's age counter is stable across the placeholder/patch sequence.
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

      const spawned = spawnAdapter({
        agent: this.opts.agent,
        envelope,
        cwd: this.opts.cwd,
        tourDir,
        adapterPath: this.opts.adapterPath,
      });
      // Now patch the pid in. The renderer reads the lock per pill render
      // tick, so the eventual-consistency is fine.
      await writeReplyLock(this.opts.cwd, this.opts.tourId, {
        ...lockBase,
        pid: spawned.pid,
      });

      await spawned.exit;
    } finally {
      await deleteReplyLock(this.opts.cwd, this.opts.tourId);
      this.inFlight = false;
    }
  }
}
