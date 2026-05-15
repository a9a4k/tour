import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TourWatcher, type WatchEvent } from "../../src/core/watcher.js";
import { mkdtemp, mkdir, writeFile, appendFile, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Poll until an event of the given type lands, or the deadline expires. Used
// instead of a fixed sleep so the assertion is tolerant of fs-event latency
// under parallel test load (the 50ms debounce + macOS FSEvents arming can push
// past a 300ms fixed wait when the system is busy).
async function waitForEvent<T extends WatchEvent["type"]>(
  events: WatchEvent[],
  type: T,
  timeoutMs = 3000,
): Promise<Extract<WatchEvent, { type: T }> | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find((e): e is Extract<WatchEvent, { type: T }> => e.type === type);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
}

// fs.watch() returns synchronously but FSEvents registration on darwin
// completes asynchronously. Actions fired in the same tick as start() race
// the arming and occasionally fall through under heavy parallel test load.
// Yield a small window for the kernel to register the watch before the test
// triggers the action it expects to observe.
async function armSettle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
}

describe("TourWatcher", () => {
  let dir: string;
  const tourId = "2026-05-08-120000-test";
  let tourDir: string;
  let watcher: TourWatcher;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-watcher-"));
    tourDir = join(dir, ".tour", tourId);
    await mkdir(tourDir, { recursive: true });
    await writeFile(join(tourDir, "comments.jsonl"), "");
  });

  afterEach(() => {
    if (watcher) watcher.stop();
  });

  it("emits comment-changed when comments file is modified", async () => {
    watcher = new TourWatcher(dir, tourId, 50);

    const events: WatchEvent[] = [];
    watcher.on((event) => events.push(event));
    watcher.start();
    await armSettle();

    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"a1"}\n');

    const changed = await waitForEvent(events, "comment-changed");
    expect(changed).toBeDefined();
  });

  it("debounces rapid changes", async () => {
    watcher = new TourWatcher(dir, tourId, 100);

    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();
    await armSettle();

    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"a1"}\n');
    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"a2"}\n');
    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"a3"}\n');

    await new Promise((r) => setTimeout(r, 400));
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it("stop cleans up listeners and file handles", async () => {
    watcher = new TourWatcher(dir, tourId, 50);
    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();
    watcher.stop();

    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"a1"}\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(0);
  });

  it("includes tourId in events", async () => {
    watcher = new TourWatcher(dir, tourId, 50);
    const events: WatchEvent[] = [];
    watcher.on((event) => events.push(event));
    watcher.start();
    await armSettle();

    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"a1"}\n');

    const changed = await waitForEvent(events, "comment-changed");
    expect(changed?.tourId).toBe(tourId);
  });

  it("emits reply-in-flight when .reply-lock.json appears", async () => {
    watcher = new TourWatcher(dir, tourId, 50);
    const events: WatchEvent[] = [];
    watcher.on((e) => events.push(e));
    watcher.start();
    await armSettle();

    await writeFile(
      join(tourDir, ".reply-lock.json"),
      JSON.stringify({ agent: "fixture", responding_to: "a1", started_at: new Date().toISOString(), pid: 1 }),
    );

    const inFlight = await waitForEvent(events, "reply-in-flight");
    expect(inFlight).toBeDefined();
    expect(inFlight?.tourId).toBe(tourId);
  });

  it("emits reply-cleared when .reply-lock.json is deleted", async () => {
    await writeFile(
      join(tourDir, ".reply-lock.json"),
      JSON.stringify({ agent: "fixture", responding_to: "a1", started_at: new Date().toISOString(), pid: 1 }),
    );

    watcher = new TourWatcher(dir, tourId, 50);
    const events: WatchEvent[] = [];
    watcher.on((e) => events.push(e));
    watcher.start();
    await armSettle();

    await unlink(join(tourDir, ".reply-lock.json"));

    const cleared = await waitForEvent(events, "reply-cleared");
    expect(cleared).toBeDefined();
    expect(cleared?.tourId).toBe(tourId);
  });

  // Issue #342 — Stage B on-disk slice. The on-disk filename `annotations.jsonl`
  // is being replaced by `comments.jsonl` with a permanent read-fallback
  // (ADR 0029 addendum). The watcher must fire comment-changed for writes
  // to whichever filename the Tour folder is using at the moment.
  it("emits comment-changed when comments.jsonl is modified (post-migration shape)", async () => {
    // beforeEach already seeds `comments.jsonl` (the post-migration primary
    // path), so the folder is in the desired state with no extra setup.
    watcher = new TourWatcher(dir, tourId, 50);
    const events: WatchEvent[] = [];
    watcher.on((event) => events.push(event));
    watcher.start();
    await armSettle();

    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"c1"}\n');

    const changed = await waitForEvent(events, "comment-changed");
    expect(changed).toBeDefined();
    expect(changed?.tourId).toBe(tourId);
  });

  it("emits comment-changed when annotations.jsonl is renamed to comments.jsonl and then appended", async () => {
    // Legacy-only folder. beforeEach seeds `comments.jsonl`; this test
    // exercises the read-fallback path, so unwind the seed and create the
    // legacy file in its place before arming the watcher.
    await unlink(join(tourDir, "comments.jsonl"));
    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"legacy"}\n');

    watcher = new TourWatcher(dir, tourId, 50);
    const events: WatchEvent[] = [];
    watcher.on((event) => events.push(event));
    watcher.start();
    await armSettle();

    await rename(
      join(tourDir, "annotations.jsonl"),
      join(tourDir, "comments.jsonl"),
    );
    await appendFile(join(tourDir, "comments.jsonl"), '{"id":"new"}\n');

    const changed = await waitForEvent(events, "comment-changed");
    expect(changed).toBeDefined();
  });

  it("does not emit comment-changed for .reply-lock.json events", async () => {
    watcher = new TourWatcher(dir, tourId, 50);
    const events: WatchEvent[] = [];
    watcher.on((e) => events.push(e));
    watcher.start();
    await armSettle();

    await writeFile(
      join(tourDir, ".reply-lock.json"),
      JSON.stringify({ agent: "fixture", responding_to: "a1", started_at: new Date().toISOString(), pid: 1 }),
    );

    await new Promise((r) => setTimeout(r, 300));
    expect(events.some((e) => e.type === "comment-changed")).toBe(false);
  });
});
