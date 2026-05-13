import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, appendFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyTOML } from "smol-toml";
import {
  requestReply,
  httpStatusForRequestReplyResult,
} from "../../src/core/reply-runner.js";
import { readAnnotations } from "../../src/core/annotations-store.js";
import {
  writeReplyLock,
  readReplyLock,
  replyLockPath,
} from "../../src/core/reply-lock.js";
import type {
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
  SpawnResult,
} from "../../src/core/agent-adapter.js";
import type { Annotation, Tour } from "../../src/core/types.js";

const tourId = "2026-05-12-090000-test";

function mkTour(): Tour {
  return {
    id: tourId,
    title: "Test",
    status: "open",
    created_at: "2026-05-12T09:00:00Z",
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
    created_at: "2026-05-12T09:00:00Z",
    ...over,
  };
}

async function seedAnnotation(
  cwd: string,
  tour: string,
  ann: Annotation,
): Promise<void> {
  const path = join(cwd, ".tour", tour, "annotations.jsonl");
  await appendFile(path, JSON.stringify(ann) + "\n");
}

interface FixtureAdapter extends ShippedAdapter {
  invocations: SpawnOpts[];
}

// Same per-chunk "wait until listeners attach" pattern as the existing
// ReplyRunner fixture — the runner's dispatch logger attaches stdout/stderr
// listeners asynchronously, so the fixture must wait before emitting.
function fixtureAdapter(
  result: SpawnResult & { stderr?: string },
): FixtureAdapter {
  const invocations: SpawnOpts[] = [];
  return {
    invocations,
    spawn(opts: SpawnOpts): SpawnedAdapter {
      invocations.push(opts);
      const stdoutListeners: Array<(s: string) => void> = [];
      const stderrListeners: Array<(s: string) => void> = [];
      let stdoutAttached!: () => void;
      let stderrAttached!: () => void;
      const stdoutAttachedP = new Promise<void>((r) => {
        stdoutAttached = r;
      });
      const stderrAttachedP = new Promise<void>((r) => {
        stderrAttached = r;
      });
      const exit = (async (): Promise<SpawnResult> => {
        await Promise.all([stdoutAttachedP, stderrAttachedP]);
        if (result.stdout)
          for (const cb of stdoutListeners) cb(result.stdout);
        if (result.stderr)
          for (const cb of stderrListeners) cb(result.stderr);
        return result;
      })();
      return {
        pid: 4321,
        onStdout: (cb) => {
          stdoutListeners.push(cb);
          stdoutAttached();
        },
        onStderr: (cb) => {
          stderrListeners.push(cb);
          stderrAttached();
        },
        exit,
      };
    },
  };
}

function blockingFixtureAdapter(
  result: SpawnResult & { stderr?: string },
): FixtureAdapter & { release: () => void } {
  const invocations: SpawnOpts[] = [];
  let release!: () => void;
  const releaseP = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    invocations,
    release,
    spawn(opts: SpawnOpts): SpawnedAdapter {
      invocations.push(opts);
      const stdoutListeners: Array<(s: string) => void> = [];
      const stderrListeners: Array<(s: string) => void> = [];
      let stdoutAttached!: () => void;
      let stderrAttached!: () => void;
      const stdoutAttachedP = new Promise<void>((r) => {
        stdoutAttached = r;
      });
      const stderrAttachedP = new Promise<void>((r) => {
        stderrAttached = r;
      });
      const exit = (async (): Promise<SpawnResult> => {
        await Promise.all([stdoutAttachedP, stderrAttachedP]);
        await releaseP;
        if (result.stdout)
          for (const cb of stdoutListeners) cb(result.stdout);
        if (result.stderr)
          for (const cb of stderrListeners) cb(result.stderr);
        return result;
      })();
      return {
        pid: process.pid,
        onStdout: (cb) => {
          stdoutListeners.push(cb);
          stdoutAttached();
        },
        onStderr: (cb) => {
          stderrListeners.push(cb);
          stderrAttached();
        },
        exit,
      };
    },
  };
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-request-reply-"));
  await mkdir(join(dir, ".tour", tourId), { recursive: true });
  await writeFile(
    join(dir, ".tour", tourId, "tour.toml"),
    stringifyTOML(mkTour()),
  );
  await writeFile(join(dir, ".tour", tourId, "annotations.jsonl"), "");
  return dir;
}

async function waitForReplyLockFile(
  cwd: string,
  tour: string,
  timeoutMs = 500,
): Promise<void> {
  const path = replyLockPath(cwd, tour);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`Timed out waiting for reply lock at ${path}`);
}

describe("requestReply", () => {
  let dir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await makeRepo();
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("on the happy path: dispatches, captures stdout as Reply body, releases lock", async () => {
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "human" }));
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "  fixture: heard you.\n",
    });

    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      agent: "fixture",
      adapter,
    });

    expect(result).toEqual({ kind: "dispatched" });
    expect(adapter.invocations).toHaveLength(1);
    expect(adapter.invocations[0].envelope.triggering_annotation.id).toBe("ann-1");

    const annotations = await readAnnotations(dir, tourId);
    const reply = annotations.find((a) => a.replies_to === "ann-1");
    expect(reply).toBeDefined();
    expect(reply?.body).toBe("fixture: heard you.");
    expect(reply?.author).toBe("fixture");
    expect(reply?.author_kind).toBe("agent");

    expect(await readReplyLock(dir, tourId)).toBeNull();
  });

  it("returns { kind: 'busy' } when the lock is already held by another in-flight dispatch", async () => {
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "human" }));
    // Held by this very test's process so the pid-liveness probe stays alive.
    await writeReplyLock(dir, tourId, {
      agent: "claude",
      responding_to: "ann-other",
      started_at: new Date().toISOString(),
      pid: process.pid,
    });

    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      agent: "fixture",
      adapter,
    });

    expect(result).toEqual({ kind: "busy" });
    expect(adapter.invocations).toHaveLength(0);
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "ann-1")).toBeUndefined();
  });

  it("returns { kind: 'invalid-annotation' } when no annotation with that id exists", async () => {
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "missing",
      agent: "fixture",
      adapter,
    });
    expect(result).toEqual({ kind: "invalid-annotation" });
    expect(adapter.invocations).toHaveLength(0);
    expect(await readReplyLock(dir, tourId)).toBeNull();
  });

  it("returns { kind: 'invalid-annotation' } on an agent-authored annotation (precondition: shouldDispatchReply)", async () => {
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "agent" }));
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      agent: "fixture",
      adapter,
    });
    expect(result).toEqual({ kind: "invalid-annotation" });
    expect(adapter.invocations).toHaveLength(0);
    expect(await readReplyLock(dir, tourId)).toBeNull();
  });

  it("returns { kind: 'invalid-annotation' } when the parent already has a Reply (one-shot terminal)", async () => {
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "human" }));
    await seedAnnotation(
      dir,
      tourId,
      mkAnn({ id: "ann-1-reply", author_kind: "agent", replies_to: "ann-1" }),
    );
    const adapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });
    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      agent: "fixture",
      adapter,
    });
    expect(result).toEqual({ kind: "invalid-annotation" });
    expect(adapter.invocations).toHaveLength(0);
    expect(await readReplyLock(dir, tourId)).toBeNull();
  });

  it("returns { kind: 'no-reply-agent' } when the renderer was launched without --reply-agent", async () => {
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "human" }));
    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      // No `agent` supplied — the renderer was launched without --reply-agent.
    });
    expect(result).toEqual({ kind: "no-reply-agent" });
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "ann-1")).toBeUndefined();
    expect(await readReplyLock(dir, tourId)).toBeNull();
  });

  it("releases the lock even on adapter non-zero exit (no Reply written)", async () => {
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "human" }));
    const adapter = fixtureAdapter({
      code: 1,
      signal: null,
      stdout: "would-have-replied",
    });
    const result = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      agent: "fixture",
      adapter,
    });
    expect(result).toEqual({ kind: "dispatched" });
    expect(await readReplyLock(dir, tourId)).toBeNull();
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "ann-1")).toBeUndefined();
  });

  it("rejects with { kind: 'busy' } on a concurrent second call without spawning a second adapter", async () => {
    // Two requestReply calls fired back-to-back against the same tour. The
    // first acquires the lock and proceeds; the second must observe the
    // lock and return busy without invoking its adapter.
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-1", author_kind: "human" }));
    await seedAnnotation(dir, tourId, mkAnn({ id: "ann-2", author_kind: "human" }));
    const slowAdapter = blockingFixtureAdapter({
      code: 0,
      signal: null,
      stdout: "first reply",
    });
    const fastAdapter = fixtureAdapter({
      code: 0,
      signal: null,
      stdout: "should not run",
    });

    const first = requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-1",
      agent: "fixture",
      adapter: slowAdapter,
    });
    // Wait until the first call has actually written its lock. A single
    // microtask yield was flaky because requestReply does async validation
    // before the lock write.
    await waitForReplyLockFile(dir, tourId);
    const second = await requestReply({
      cwd: dir,
      tourId,
      annotationId: "ann-2",
      agent: "fixture",
      adapter: fastAdapter,
    });

    expect(second).toEqual({ kind: "busy" });
    expect(fastAdapter.invocations).toHaveLength(0);

    // Wait for the first to finish so we leave a clean filesystem.
    slowAdapter.release();
    expect(await first).toEqual({ kind: "dispatched" });
    expect(slowAdapter.invocations).toHaveLength(1);
  });
});

describe("httpStatusForRequestReplyResult (issue #184)", () => {
  // The mapping is a user-facing contract pinned by the PRD: the
  // webapp's `POST /api/tours/:id/request-reply` endpoint translates
  // requestReply's discriminated result into one of four HTTP statuses.
  // Locked into a unit test so a future refactor of the endpoint cannot
  // silently drift the contract.
  it("maps `dispatched` → 202 (Accepted)", () => {
    expect(httpStatusForRequestReplyResult({ kind: "dispatched" })).toBe(202);
  });
  it("maps `busy` → 409 (Conflict)", () => {
    expect(httpStatusForRequestReplyResult({ kind: "busy" })).toBe(409);
  });
  it("maps `invalid-annotation` → 404 (Not Found)", () => {
    expect(httpStatusForRequestReplyResult({ kind: "invalid-annotation" })).toBe(404);
  });
  it("maps `no-reply-agent` → 400 (Bad Request)", () => {
    expect(httpStatusForRequestReplyResult({ kind: "no-reply-agent" })).toBe(400);
  });
});
