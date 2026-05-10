import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyTOML } from "smol-toml";
import { ReplyRunner } from "../../src/core/reply-runner.js";
import { readAnnotations } from "../../src/core/annotations-store.js";
import { appendFile } from "node:fs/promises";
import { writeReplyLock, readReplyLock } from "../../src/core/reply-lock.js";
import type {
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
  SpawnResult,
} from "../../src/core/agent-adapter.js";
import type { Annotation, Tour } from "../../src/core/types.js";

// Local injection helper — writes a fully-formed Annotation record directly
// to the JSONL store. Used here so reply-runner tests can seed parent
// annotations with a known id without going through the (public) creation
// seam, which would generate its own id and timestamp. The store's primitive
// `appendAnnotation` is private to the module under PRD #140.
async function seedAnnotation(
  cwd: string,
  tourId: string,
  ann: Annotation,
): Promise<void> {
  const path = join(cwd, ".tour", tourId, "annotations.jsonl");
  await appendFile(path, JSON.stringify(ann) + "\n");
}

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

// In-memory fake reply-agent: records each invocation, fires the canned
// stdout / stderr through the per-chunk listeners (so the runner's dispatch
// logger captures content — ADR 0014) once both listener slots have been
// attached, then resolves the exit promise with the caller-supplied
// SpawnResult. The "wait until both listeners attach" gate mirrors the
// real spawn helper's behavior: a paused stream buffers data until a
// `data` listener is attached. Without this gate, the runner's async
// setup work between `spawn()` returning and `onStdout`/`onStderr` being
// called would race the fixture's emission and chunks would be lost.
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
        pid: 1234,
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "agent" }));
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
      pid: process.pid,
    });
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
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
    await seedAnnotation(
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
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
    await seedAnnotation(dir, tourId, mkAnn({ id: "a1", author_kind: "human" }));
    await runner.tick();
    const annotations = await readAnnotations(dir, tourId);
    expect(annotations.find((a) => a.replies_to === "a1")).toBeUndefined();

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("spawn failed");
    expect(stderr).toContain("ENOENT");
  });

  // ─── ADR 0014: per-dispatch reply-agent log files ────────────────────

  describe("dispatch logs (ADR 0014)", () => {
    const logsDir = (): string => join(dir, ".tour", tourId, "logs");
    const logPathFor = (annId: string): string =>
      join(logsDir(), `reply-${annId}.log`);

    it("creates the logs/ subdir lazily on first dispatch and writes a log file keyed by triggering id", async () => {
      const adapter = fixtureAdapter({
        code: 0,
        signal: null,
        stdout: "fixture reply\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      // No logs/ subdir before first dispatch.
      expect(existsSync(logsDir())).toBe(false);
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-aaaa", author_kind: "human" }),
      );
      await runner.tick();
      expect(existsSync(logsDir())).toBe(true);
      expect((await stat(logPathFor("ann-aaaa"))).isFile()).toBe(true);
      // Filename uses the FULL triggering id, not shortId().
      const log = await readFile(logPathFor("ann-aaaa"), "utf8");
      expect(log).toContain("=== triggering: ann-aaaa");
    });

    it("on success, the log captures the stdout body, header, and exit-0 footer", async () => {
      const adapter = fixtureAdapter({
        code: 0,
        signal: null,
        stdout: "first reply line\nsecond reply line\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-bbbb", author_kind: "human" }),
      );
      await runner.tick();
      const log = await readFile(logPathFor("ann-bbbb"), "utf8");
      expect(log).toContain("=== reply-agent: fixture");
      expect(log).toContain("=== triggering: ann-bbbb");
      expect(log).toContain(`=== tour: ${tourId}`);
      expect(log).toContain("=== pid: 1234");
      expect(log).toMatch(/=== envelope-bytes: \d+/);
      expect(log).toMatch(/=== system-prompt-bytes: \d+/);
      expect(log).toContain("\n---\n");
      expect(log).toContain("OUT: first reply line");
      expect(log).toContain("OUT: second reply line");
      expect(log).toMatch(/=== exit: code=0 signal=null duration_ms=\d+/);
      // Reply still landed, byte-equivalent body (ADR 0012).
      const annotations = await readAnnotations(dir, tourId);
      const reply = annotations.find((a) => a.replies_to === "ann-bbbb");
      expect(reply?.body).toBe("first reply line\nsecond reply line");
    });

    it("on non-zero exit, the log captures stderr and the runner's stderr message includes the log path", async () => {
      const adapter = fixtureAdapter({
        code: 1,
        signal: null,
        stdout: "",
        stderr: "auth lookup failed\nplease re-login\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-cccc", author_kind: "human" }),
      );
      await runner.tick();
      const path = logPathFor("ann-cccc");
      const log = await readFile(path, "utf8");
      expect(log).toContain("ERR: auth lookup failed");
      expect(log).toContain("ERR: please re-login");
      expect(log).toContain("=== exit: code=1 signal=null");
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain(`; see ${path}`);
    });

    it("on spawn-failed (ENOENT), the log has the meta header + error/exit footer and the stderr message points at it", async () => {
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
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-dddd", author_kind: "human" }),
      );
      await runner.tick();
      const path = logPathFor("ann-dddd");
      const log = await readFile(path, "utf8");
      expect(log).toContain("=== reply-agent: fixture");
      expect(log).toContain("=== triggering: ann-dddd");
      expect(log).toContain("=== error: spawn ENOENT");
      expect(log).toContain("=== exit: code=null signal=null duration_ms=");
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain(`; see ${path}`);
    });

    it("on empty-stdout success exit, the log captures stderr and the runner's stderr message includes the log path", async () => {
      const adapter = fixtureAdapter({
        code: 0,
        signal: null,
        stdout: "",
        stderr: "model returned no body\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-eeee", author_kind: "human" }),
      );
      await runner.tick();
      const path = logPathFor("ann-eeee");
      const log = await readFile(path, "utf8");
      expect(log).toContain("ERR: model returned no body");
      expect(log).toContain("=== exit: code=0 signal=null");
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toContain("produced no output");
      expect(stderr).toContain(`; see ${path}`);
    });

    it("the success path emits no new line on the parent's stderr", async () => {
      const adapter = fixtureAdapter({
        code: 0,
        signal: null,
        stdout: "fixture reply\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-ffff", author_kind: "human" }),
      );
      await runner.tick();
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderr).toBe("");
    });

    it("interleaves stdout and stderr in arrival order with correct prefixes", async () => {
      // The fixture fires stdout then stderr in microtask order; what we
      // assert is that whichever arrives first appears first AND that both
      // streams' lines carry their proper prefix.
      const adapter = fixtureAdapter({
        code: 0,
        signal: null,
        stdout: "stdout-1\nstdout-2\n",
        stderr: "stderr-1\nstderr-2\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-gggg", author_kind: "human" }),
      );
      await runner.tick();
      const log = await readFile(logPathFor("ann-gggg"), "utf8");
      expect(log).toMatch(
        /OUT: stdout-1\nOUT: stdout-2\nERR: stderr-1\nERR: stderr-2/,
      );
    });

    it("user content containing ===, OUT:, ERR: substrings stays strictly after the line prefix", async () => {
      const adapter = fixtureAdapter({
        code: 0,
        signal: null,
        stdout: "=== fake header\nOUT: pretending\n",
        stderr: "ERR: still ours\n",
      });
      const runner = new ReplyRunner({
        cwd: dir,
        tourId,
        agent: "fixture",
        adapter,
      });
      await runner.prime();
      await seedAnnotation(
        dir,
        tourId,
        mkAnn({ id: "ann-hhhh", author_kind: "human" }),
      );
      await runner.tick();
      const log = await readFile(logPathFor("ann-hhhh"), "utf8");
      expect(log).toContain("OUT: === fake header");
      expect(log).toContain("OUT: OUT: pretending");
      expect(log).toContain("ERR: ERR: still ours");
    });
  });
});
