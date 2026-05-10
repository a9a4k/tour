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
  try {
    const raw = await readFile(replyLockPath(repoRoot, tourId), "utf-8");
    return JSON.parse(raw) as ReplyLock;
  } catch {
    return null;
  }
}

export async function writeReplyLock(
  repoRoot: string,
  tourId: string,
  lock: ReplyLock,
): Promise<void> {
  await writeFile(replyLockPath(repoRoot, tourId), JSON.stringify(lock));
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
