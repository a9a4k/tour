import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyTOML } from "smol-toml";
import { ReplyRunner } from "../../src/core/reply-runner.js";
import { appendAnnotation } from "../../src/core/annotations-store.js";
import { writeReplyLock, readReplyLock } from "../../src/core/reply-lock.js";
import type { Annotation, Tour } from "../../src/core/types.js";

const tourId = "2026-05-10-120000-test";

function mkTour(): Tour {
  return {
    id: tourId,
    title: "Test",
    status: "open",
    created_at: "2026-05-10T12:00:00Z",
    closed_at: "",
    head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    base_sha: "feedfacefeedfacefeedfacefeedfacefeedface",
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
  };
}

function mkAnn(over: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: over.id,
    file: "src/main.ts",
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "note",
    author: "anonymous",
    author_kind: "agent",
    created_at: "2026-05-10T12:00:00Z",
    ...over,
  };
}

async function makeRepo(): Promise<{ dir: string; markerFile: string; adapter: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tour-runner-"));
  await mkdir(join(dir, ".tour", tourId), { recursive: true });
  await writeFile(
    join(dir, ".tour", tourId, "tour.toml"),
    stringifyTOML(mkTour()),
  );
  await writeFile(join(dir, ".tour", tourId, "annotations.jsonl"), "");

  const markerFile = join(dir, "marker.json");
  const adapter = join(dir, "adapter.sh");
  // Adapter writes the stdin envelope to a marker file and exits 0.
  // Importantly it does NOT call `tour annotate` — we just want to verify the
  // dispatch path fires, and isolating the runner from the CLI keeps the test
  // hermetic.
  const script = `#!/usr/bin/env bash
set -e
cat > "${markerFile}"
exit 0
`;
  await writeFile(adapter, script);
  await chmod(adapter, 0o755);
  return { dir, markerFile, adapter };
}

describe("ReplyRunner", () => {
  let dir: string;
  let markerFile: string;
  let adapter: string;

  beforeEach(async () => {
    ({ dir, markerFile, adapter } = await makeRepo());
  });

  it("does not dispatch on initial prime", async () => {
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapterPath: adapter,
    });
    await runner.prime();
    await runner.tick();
    expect(existsSync(markerFile)).toBe(false);
  });

  it("dispatches when a new human-authored annotation appears", async () => {
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapterPath: adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();

    // Wait a tick for the child process to flush the marker file.
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(markerFile)).toBe(true);
  });

  it("does not dispatch on agent-authored annotations", async () => {
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapterPath: adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "agent" }));
    await runner.tick();
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(markerFile)).toBe(false);
  });

  it("respects an existing lockfile (single-flight)", async () => {
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapterPath: adapter,
    });
    await runner.prime();
    await writeReplyLock(dir, tourId, {
      agent: "claude",
      responding_to: "ax",
      started_at: new Date().toISOString(),
      pid: 99999,
    });
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(markerFile)).toBe(false);
  });

  it("clears the lockfile when the adapter exits", async () => {
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapterPath: adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    await new Promise((r) => setTimeout(r, 200));
    expect(await readReplyLock(dir, tourId)).toBeNull();
  });
});
