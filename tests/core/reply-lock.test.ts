import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  await mkdir(join(dir, ".tour", tourId), { recursive: true });
  return dir;
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
      pid: 12345,
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
      pid: 12345,
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
});
