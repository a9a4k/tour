import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TourWatcher } from "../../src/core/watcher.js";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("TourWatcher", () => {
  let dir: string;
  const tourId = "2026-05-08-120000-test";
  let tourDir: string;
  let watcher: TourWatcher;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-watcher-"));
    tourDir = join(dir, ".tour", tourId);
    await mkdir(tourDir, { recursive: true });
    await writeFile(join(tourDir, "annotations.jsonl"), "");
  });

  afterEach(() => {
    if (watcher) watcher.stop();
  });

  it("emits annotation-changed when annotations file is modified", async () => {
    watcher = new TourWatcher(dir, tourId, 50);

    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();

    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"a1"}\n');

    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toBe("annotation-changed");
  });

  it("debounces rapid changes", async () => {
    watcher = new TourWatcher(dir, tourId, 100);

    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();

    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"a1"}\n');
    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"a2"}\n');
    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"a3"}\n');

    await new Promise((r) => setTimeout(r, 400));
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it("stop cleans up listeners and file handles", async () => {
    watcher = new TourWatcher(dir, tourId, 50);
    const events: string[] = [];
    watcher.on((event) => events.push(event.type));
    watcher.start();
    watcher.stop();

    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"a1"}\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(0);
  });

  it("includes tourId in events", async () => {
    watcher = new TourWatcher(dir, tourId, 50);
    let emittedId = "";
    watcher.on((event) => { emittedId = event.tourId; });
    watcher.start();

    await appendFile(join(tourDir, "annotations.jsonl"), '{"id":"a1"}\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(emittedId).toBe(tourId);
  });
});
