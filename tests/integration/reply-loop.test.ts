import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requestReply } from "../../src/core/reply-runner.js";
import { readReplyLock } from "../../src/core/reply-lock.js";
import { readAnnotations } from "../../src/core/annotations-store.js";
import type {
  ShippedAdapter,
  SpawnOpts,
  SpawnedAdapter,
} from "../../src/core/agent-adapter.js";

const exec = promisify(execFile);

const CLI = join(import.meta.dirname, "../../src/main.ts");

// Invoke the CLI via `bun` (preinstalled by setup-bun@v2 in CI; on PATH
// in dev). Avoids the `npx tsx` cold-cache install race — see the matching
// comment in tests/integration/cli.test.ts.
async function run(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec("bun", [CLI, ...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: (e.stdout ?? "").trimEnd(),
      stderr: (e.stderr ?? "").trimEnd(),
      exitCode: e.code ?? 1,
    };
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function makeRepoWithTour(): Promise<{ repo: string; tourId: string }> {
  const repo = await mkdtemp(join(tmpdir(), "tour-reply-loop-"));
  await git(["init", repo], repo);
  await git(["config", "user.email", "test@test.com"], repo);
  await git(["config", "user.name", "Test"], repo);
  await writeFile(join(repo, "hello.txt"), "hello\n");
  await git(["add", "."], repo);
  await git(["commit", "-m", "initial"], repo);
  await writeFile(join(repo, "hello.txt"), "hello world\n");
  await git(["add", "."], repo);
  await git(["commit", "-m", "update"], repo);

  const cr = await run(["create", "--head", "HEAD", "--json"], repo);
  if (cr.exitCode !== 0) throw new Error(`create failed: ${cr.stderr}`);
  const tour = JSON.parse(cr.stdout) as { id: string };

  return { repo, tourId: tour.id };
}

// In-process fake adapter: emits a canned reply on stdout, exits 0. Replaces
// the prior on-disk fixture.sh + tour-cli.sh shim machinery (issue #88).
const FIXTURE_BODY = "fixture: heard you.";

const fixtureAdapter: ShippedAdapter = {
  spawn(_opts: SpawnOpts): SpawnedAdapter {
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
    const exit = (async (): Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
    }> => {
      await Promise.all([stdoutAttachedP, stderrAttachedP]);
      for (const cb of stdoutListeners) cb(FIXTURE_BODY);
      return { code: 0, signal: null, stdout: FIXTURE_BODY };
    })();
    return {
      pid: 0,
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

describe("end-to-end reply-agent loop (TS fixture adapter)", () => {
  let repo: string;
  let tourId: string;

  beforeEach(async () => {
    ({ repo, tourId } = await makeRepoWithTour());
  });

  it("an explicit requestReply call drives the fixture adapter, which writes an agent Reply via stdout-as-reply", async () => {
    // Write the human Annotation via the CLI, then explicitly invoke
    // requestReply — the same path the TUI's `s` keymap and the webapp's
    // POST /api/tours/:id/request-reply endpoint converge on (issue #184,
    // ADR 0021). The watcher no longer auto-dispatches.
    const r = await run(
      [
        "annotate",
        tourId,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "why this change?",
        "--as-human",
        "--author", "alice",
        "--json",
      ],
      repo,
    );
    expect(r.exitCode).toBe(0);
    const created = JSON.parse(r.stdout) as { id: string };

    const result = await requestReply({
      cwd: repo,
      tourId,
      annotationId: created.id,
      agent: "fixture",
      adapter: fixtureAdapter,
    });
    expect(result).toEqual({ kind: "dispatched" });

    // requestReply resolves only after the spawn exits, so by here the
    // lock is gone and the reply is on disk.
    expect(await readReplyLock(repo, tourId)).toBeNull();

    const annotations = await readAnnotations(repo, tourId);
    const reply = annotations.find(
      (a) => a.replies_to !== undefined && a.author_kind === "agent",
    );
    expect(reply).toBeDefined();
    expect(reply?.body).toBe(FIXTURE_BODY);
    expect(reply?.author).toBe("fixture");
  }, 30_000);
});
