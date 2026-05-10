import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Annotation, Tour } from "./types.js";
import { buildThreads } from "./threads.js";

// JSON envelope handed to the adapter on stdin. Contains everything an agent
// needs to compose a reply without re-reading the tour's filesystem state.
export interface ReplyEnvelope {
  tour: Tour;
  triggering_annotation: Annotation;
  thread: Annotation[];
}

export function adapterPath(name: string): string {
  return join(homedir(), ".config", "tour", "agents", `${name}.sh`);
}

// Hard-fails at startup if the named adapter isn't present at the expected
// path — per the PRD, misconfiguration must surface up-front, not at first
// human reply.
export function assertAdapterExists(name: string): void {
  const path = adapterPath(name);
  if (!existsSync(path)) {
    throw new Error(
      `Reply agent "${name}" not found at ${path}. ` +
        `Drop an adapter script there (chmod +x), or omit --reply-agent.`,
    );
  }
}

export function buildEnvelope(
  tour: Tour,
  annotations: Annotation[],
  triggering: Annotation,
): ReplyEnvelope {
  const threads = buildThreads(annotations);
  let chain: Annotation[] = [triggering];
  if (triggering.replies_to !== undefined) {
    const root = threads.find(
      (t) => t.root.id === triggering.replies_to ||
        t.replies.some((r) => r.id === triggering.replies_to),
    );
    if (root) chain = [root.root, ...root.replies];
  } else {
    const t = threads.find((th) => th.root.id === triggering.id);
    if (t) chain = [t.root, ...t.replies];
  }
  return { tour, triggering_annotation: triggering, thread: chain };
}

export interface SpawnOptions {
  agent: string;
  envelope: ReplyEnvelope;
  cwd: string;
  tourDir: string;
  // Optional override for tests; defaults to the file at adapterPath(agent).
  adapterPath?: string;
}

export interface SpawnedAdapter {
  child: ChildProcess;
  pid: number;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

// Spawns the adapter as a child process with the JSON envelope on stdin and
// TOUR_* vars in env. The caller is responsible for the lockfile lifecycle —
// this module only owns the spawn path so it can be mocked in tests.
export function spawnAdapter(opts: SpawnOptions): SpawnedAdapter {
  const path = opts.adapterPath ?? adapterPath(opts.agent);
  const child = spawn(path, [], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      TOUR_ID: opts.envelope.tour.id,
      TOUR_HEAD_SHA: opts.envelope.tour.head_sha,
      TOUR_BASE_SHA: opts.envelope.tour.base_sha,
      TOUR_DIR: opts.tourDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (child.stdin) {
    child.stdin.write(JSON.stringify(opts.envelope));
    child.stdin.end();
  }
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  return { child, pid: child.pid ?? 0, exit };
}
