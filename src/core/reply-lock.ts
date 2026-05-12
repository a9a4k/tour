import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface ReplyLock {
  agent: string;
  responding_to: string;
  started_at: string;
  pid: number;
}

// Default stale threshold per PRD #73 / issue #79: ~2 minutes. Configurable for
// tests but documented elsewhere as a constant the pill can rely on.
export const DEFAULT_STALE_THRESHOLD_MS = 120_000;

export function replyLockPath(repoRoot: string, tourId: string): string {
  return join(repoRoot, ".tour", tourId, ".reply-lock.json");
}

export async function readReplyLock(
  repoRoot: string,
  tourId: string,
): Promise<ReplyLock | null> {
  const path = replyLockPath(repoRoot, tourId);
  let lock: ReplyLock;
  try {
    const raw = await readFile(path, "utf-8");
    lock = JSON.parse(raw) as ReplyLock;
  } catch {
    return null;
  }
  // PID-liveness probe: dead pid means the renderer that wrote the lock is
  // gone (crashed renderer scenario). Clear the orphan and report no lock.
  // pid === 0 is the placeholder window in reply-runner between the initial
  // write and the spawn-pid patch — the existing 2-min stale threshold covers
  // the absurd case of a renderer crash inside that sub-millisecond window.
  if (lock.pid > 0) {
    try {
      process.kill(lock.pid, 0);
    } catch {
      await deleteReplyLock(repoRoot, tourId);
      return null;
    }
  }
  return lock;
}

export async function writeReplyLock(
  repoRoot: string,
  tourId: string,
  lock: ReplyLock,
): Promise<void> {
  await writeFile(replyLockPath(repoRoot, tourId), JSON.stringify(lock));
}

// Atomic try-acquire: returns true iff the caller is now the lock holder.
// First does a self-heal read (dead-pid locks clear themselves via
// `readReplyLock`), then attempts an O_CREAT|O_EXCL write. The exclusive
// flag is what makes the acquire safe against a racing concurrent caller —
// two callers seeing "no lock" in parallel still resolve to exactly one
// successful write.
export async function tryAcquireReplyLock(
  repoRoot: string,
  tourId: string,
  lock: ReplyLock,
): Promise<boolean> {
  if (await readReplyLock(repoRoot, tourId)) return false;
  try {
    await writeFile(
      replyLockPath(repoRoot, tourId),
      JSON.stringify(lock),
      { flag: "wx" },
    );
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

export async function deleteReplyLock(
  repoRoot: string,
  tourId: string,
): Promise<void> {
  try {
    await unlink(replyLockPath(repoRoot, tourId));
  } catch {
    // idempotent — no-op if the lock file doesn't exist
  }
}

export function isStale(
  lock: ReplyLock,
  now: number,
  thresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): boolean {
  const startedAt = Date.parse(lock.started_at);
  if (Number.isNaN(startedAt)) return false;
  return now - startedAt > thresholdMs;
}

export function ageMs(lock: ReplyLock, now: number): number {
  const startedAt = Date.parse(lock.started_at);
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, now - startedAt);
}
