import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReviewWatcher } from "../../src/core/watcher.js";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ReviewWatcher", () => {
  let dir: string;
  const reviewId = "2026-05-08-120000-test";
  let reviewDir: string;
  let watcher: ReviewWatcher;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "review-watcher-"));
    reviewDir = join(dir, ".review", reviewId);
    await mkdir(reviewDir, { recursive: true });
    await writeFile(join(reviewDir, "annotations.jsonl"), "");
  });

  afterEach(() => {
    if (watcher) watcher.stop();
  });

  it("emits annotation-changed when annotations file is modified", async () => {
    watcher = new ReviewWatcher(dir, reviewId, 50);

    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();

    await appendFile(join(reviewDir, "annotations.jsonl"), '{"id":"a1"}\n');

    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toBe("annotation-changed");
  });

  it("debounces rapid changes", async () => {
    watcher = new ReviewWatcher(dir, reviewId, 100);

    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();

    await appendFile(join(reviewDir, "annotations.jsonl"), '{"id":"a1"}\n');
    await appendFile(join(reviewDir, "annotations.jsonl"), '{"id":"a2"}\n');
    await appendFile(join(reviewDir, "annotations.jsonl"), '{"id":"a3"}\n');

    await new Promise((r) => setTimeout(r, 400));
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it("stop cleans up listeners and file handles", async () => {
    watcher = new ReviewWatcher(dir, reviewId, 50);
    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();
    watcher.stop();

    await appendFile(join(reviewDir, "annotations.jsonl"), '{"id":"a1"}\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(0);
  });

  it("includes reviewId in events", async () => {
    watcher = new ReviewWatcher(dir, reviewId, 50);
    let emittedId = "";
    watcher.on((event) => { emittedId = event.reviewId; });
    watcher.start();

    await appendFile(join(reviewDir, "annotations.jsonl"), '{"id":"a1"}\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(emittedId).toBe(reviewId);
  });
});
