import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ageMs,
  DEFAULT_STALE_THRESHOLD_MS,
  deleteReplyLock,
  isStale,
  readReplyLock,
  replyLockPath,
  writeReplyLock,
  type ReplyLock,
} from "../../src/core/reply-lock.js";

const tourId = "2026-05-10-120000-test";

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-reply-lock-"));
  await mkdir(join(dir, tourId), { recursive: true });
  return dir;
}

// Spawn a no-op child, wait for exit, return its (now-dead) pid. Used to
// exercise the PID-liveness probe without mocking process.kill.
async function spawnAndExit(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) throw new Error("spawn returned no pid");
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  return pid;
}

describe("reply-lock", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  it("read returns null when no lock exists", async () => {
    expect(await readReplyLock(repo, tourId)).toBeNull();
  });

  it("write then read round-trips", async () => {
    const lock: ReplyLock = {
      agent: "fixture",
      responding_to: "ann-1",
      started_at: "2026-05-10T12:00:00Z",
      pid: process.pid,
    };
    await writeReplyLock(repo, tourId, lock);
    expect(existsSync(replyLockPath(repo, tourId))).toBe(true);
    const got = await readReplyLock(repo, tourId);
    expect(got).toEqual(lock);
  });

  it("delete removes the lock and is idempotent on second call", async () => {
    const lock: ReplyLock = {
      agent: "fixture",
      responding_to: "ann-1",
      started_at: "2026-05-10T12:00:00Z",
      pid: process.pid,
    };
    await writeReplyLock(repo, tourId, lock);
    await deleteReplyLock(repo, tourId);
    expect(existsSync(replyLockPath(repo, tourId))).toBe(false);
    await deleteReplyLock(repo, tourId);
    expect(existsSync(replyLockPath(repo, tourId))).toBe(false);
  });

  it("isStale: false when within threshold", () => {
    const startedAt = "2026-05-10T12:00:00Z";
    const now = Date.parse(startedAt) + 30_000;
    const lock: ReplyLock = {
      agent: "fixture",
      responding_to: "ann-1",
      started_at: startedAt,
      pid: 1,
    };
    expect(isStale(lock, now)).toBe(false);
  });

  it("isStale: true when older than the default threshold (~2 min)", () => {
    const startedAt = "2026-05-10T12:00:00Z";
    const now = Date.parse(startedAt) + DEFAULT_STALE_THRESHOLD_MS + 1;
    const lock: ReplyLock = {
      agent: "fixture",
      responding_to: "ann-1",
      started_at: startedAt,
      pid: 1,
    };
    expect(isStale(lock, now)).toBe(true);
  });

  it("isStale: respects a custom threshold", () => {
    const startedAt = "2026-05-10T12:00:00Z";
    const lock: ReplyLock = {
      agent: "fixture",
      responding_to: "ann-1",
      started_at: startedAt,
      pid: 1,
    };
    expect(isStale(lock, Date.parse(startedAt) + 1500, 1000)).toBe(true);
    expect(isStale(lock, Date.parse(startedAt) + 500, 1000)).toBe(false);
  });

  it("ageMs reports milliseconds since started_at, clamped at zero", () => {
    const startedAt = "2026-05-10T12:00:00Z";
    const lock: ReplyLock = {
      agent: "fixture",
      responding_to: "ann-1",
      started_at: startedAt,
      pid: 1,
    };
    expect(ageMs(lock, Date.parse(startedAt) + 5000)).toBe(5000);
    expect(ageMs(lock, Date.parse(startedAt) - 1000)).toBe(0);
  });

  describe("PID-liveness on read", () => {
    it("returns the lock unchanged when pid is alive (lockfile untouched)", async () => {
      const lock: ReplyLock = {
        agent: "fixture",
        responding_to: "ann-1",
        started_at: "2026-05-10T12:00:00Z",
        pid: process.pid,
      };
      await writeReplyLock(repo, tourId, lock);
      const got = await readReplyLock(repo, tourId);
      expect(got).toEqual(lock);
      expect(existsSync(replyLockPath(repo, tourId))).toBe(true);
    });

    it("returns null and deletes the lockfile when pid > 0 is dead", async () => {
      const deadPid = await spawnAndExit();
      const lock: ReplyLock = {
        agent: "fixture",
        responding_to: "ann-1",
        started_at: "2026-05-10T12:00:00Z",
        pid: deadPid,
      };
      await writeReplyLock(repo, tourId, lock);
      const got = await readReplyLock(repo, tourId);
      expect(got).toBeNull();
      expect(existsSync(replyLockPath(repo, tourId))).toBe(false);
    });

    it("returns the lock as-is when pid === 0 (placeholder window)", async () => {
      const lock: ReplyLock = {
        agent: "fixture",
        responding_to: "ann-1",
        started_at: "2026-05-10T12:00:00Z",
        pid: 0,
      };
      await writeReplyLock(repo, tourId, lock);
      const got = await readReplyLock(repo, tourId);
      expect(got).toEqual(lock);
      expect(existsSync(replyLockPath(repo, tourId))).toBe(true);
    });
  });
});
