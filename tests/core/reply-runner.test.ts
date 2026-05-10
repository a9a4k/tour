import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyTOML } from "smol-toml";
import { ReplyRunner } from "../../src/core/reply-runner.js";
import {
  appendAnnotation,
  readAnnotations,
} from "../../src/core/annotations-store.js";
import { writeReplyLock, readReplyLock } from "../../src/core/reply-lock.js";
import type {
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
  SpawnResult,
} from "../../src/core/agent-adapter.js";
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

interface FixtureAdapter extends ShippedAdapter {
  invocations: SpawnOpts[];
}

// In-memory fake reply-agent: records each invocation and resolves the
// exit promise with a caller-supplied SpawnResult. Replaces the prior
// shell-script fixture with a TS-injected one (issue #88).
function fixtureAdapter(result: SpawnResult): FixtureAdapter {
  const invocations: SpawnOpts[] = [];
  return {
    invocations,
    spawn(opts: SpawnOpts): SpawnedAdapter {
      invocations.push(opts);
      return { pid: 1234, exit: Promise.resolve(result) };
    },
  };
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-runner-"));
  await mkdir(join(dir, ".tour", tourId), { recursive: true });
  await writeFile(
    join(dir, ".tour", tourId, "tour.toml"),
    stringifyTOML(mkTour()),
  );
  await writeFile(join(dir, ".tour", tourId, "annotations.jsonl"), "");
  return dir;
}

describe("ReplyRunner", () => {
  let dir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await makeRepo();
    // Suppress the runner's "no reply written" stderr lines so the test
    // output stays clean. Spy so individual tests can still assert on the
    // captured calls when relevant.
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("does not dispatch on initial prime", async () => {
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await runner.tick();
    expect(adapter.invocations).toHaveLength(0);
  });

  it("dispatches when a new human-authored annotation appears", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "fixture reply",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    expect(adapter.invocations).toHaveLength(1);
    expect(adapter.invocations[0].envelope.triggering_annotation.id).toBe("a1");
    expect(adapter.invocations[0].systemPrompt).toContain("Tour's reply-agent");
  });

  it("does not dispatch on agent-authored annotations", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "agent" }));
    await runner.tick();
    expect(adapter.invocations).toHaveLength(0);
  });

  it("respects an existing lockfile (single-flight)", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
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
    expect(adapter.invocations).toHaveLength(0);
  });

  it("clears the lockfile when the adapter exits", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "fixture reply",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    expect(await readReplyLock(dir, tourId)).toBeNull();
  });

  it("writes a Reply Annotation when the adapter exits 0 with non-empty stdout (ADR 0012)", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "  fixture: heard you.\n  ",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(
      dir,
      tourId,
      mkAnn({
        id: "a1",
        author_kind: "human",
        file: "src/main.ts",
        side: "additions",
        line_start: 7,
        line_end: 9,
      }),
    );
    await runner.tick();

    const annotations = await readAnnotations(dir, tourId);
    const reply = annotations.find((a) => a.replies_to === "a1");
    expect(reply).toBeDefined();
    // Stdout is trimmed verbatim — surrounding whitespace stripped, body
    // preserved.
    expect(reply?.body).toBe("fixture: heard you.");
    expect(reply?.author).toBe("fixture");
    expect(reply?.author_kind).toBe("agent");
    // Reply inherits the parent's anchor.
    expect(reply?.file).toBe("src/main.ts");
    expect(reply?.side).toBe("additions");
    expect(reply?.line_start).toBe(7);
    expect(reply?.line_end).toBe(9);
  });

  it("does not write a Reply when the adapter prints whitespace-only stdout", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "   \n  \t\n",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "a1")).toBeUndefined();

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("fixture");
    expect(stderr).toContain("no output");
  });

  it("does not write a Reply when the adapter exits non-zero", async () => {
    const adapter = fixtureAdapter({
      code: 1,
      signal: null,
      stdout: "would-have-replied",
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "a1")).toBeUndefined();

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("fixture");
    expect(stderr).toContain("exited with code 1");
  });

  it("does not write a Reply when the spawn itself fails (e.g. CLI not on PATH)", async () => {
    const adapter = fixtureAdapter({
      code: null,
      signal: null,
      stdout: "",
      error: new Error("spawn ENOENT"),
    });
    const runner = new ReplyRunner({
      cwd: dir,
      tourId,
      agent: "fixture",
      adapter,
    });
    await runner.prime();
    await appendAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "a1")).toBeUndefined();

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("spawn failed");
    expect(stderr).toContain("ENOENT");
  });
});
