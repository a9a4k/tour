import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { ReplyRunner } from "../../src/core/reply-runner.js";
import { readReplyLock } from "../../src/core/reply-lock.js";

const exec = promisify(execFile);

const CLI = join(import.meta.dirname, "../../src/main.ts");
const FIXTURE_ADAPTER_SRC = join(
  import.meta.dirname,
  "../fixtures/agents/fixture.sh",
);

async function run(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec("npx", ["tsx", CLI, ...args], {
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

async function makeRepoWithTour(): Promise<{ repo: string; tourId: string; adapter: string }> {
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

  // Drop the fixture adapter into a place the runner can reach via
  // adapterPath override. Real users would put it at
  // ~/.config/tour/agents/<name>.sh; tests bypass that to stay hermetic.
  const adapter = join(repo, "fixture.sh");
  await copyFile(FIXTURE_ADAPTER_SRC, adapter);
  await chmod(adapter, 0o755);

  return { repo, tourId: tour.id, adapter };
}

describe("end-to-end reply-agent loop (fixture adapter)", () => {
  let repo: string;
  let tourId: string;
  let adapter: string;

  beforeEach(async () => {
    ({ repo, tourId, adapter } = await makeRepoWithTour());
  });

  it("a human-authored Annotation triggers the fixture adapter, which writes an agent Reply", async () => {
    // Tour wraps the local CLI for the fixture's `tour annotate` invocation.
    // Prod adapters expect `tour` on PATH; tests just pin TOUR_CLI to a
    // tsx-wrapped shim so we don't need to install the binary.
    const wrapper = join(repo, "tour-cli.sh");
    await writeFile(
      wrapper,
      `#!/usr/bin/env bash\nexec npx tsx ${CLI} "$@"\n`,
    );
    await chmod(wrapper, 0o755);
    process.env.TOUR_CLI = wrapper;
    process.env.TOUR_FIXTURE_BODY = "fixture: heard you.";

    const runner = new ReplyRunner({
      cwd: repo,
      tourId,
      agent: "fixture",
      adapterPath: adapter,
    });
    // Prime first, then write the human note, then tick — this is the
    // sequence the renderer uses (prime on mount, watcher fires tick on
    // each annotations.jsonl write).
    await runner.prime();

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

    await runner.tick();

    // Wait for the adapter to finish — `tick()` resolves only after the spawn
    // exits, so by here the lock is gone. The polling loop is defensive
    // against any future async tweaks to the runner.
    let waited = 0;
    while (waited < 20_000) {
      const lock = await readReplyLock(repo, tourId);
      if (lock === null) break;
      await new Promise((rr) => setTimeout(rr, 200));
      waited += 200;
    }
    expect(await readReplyLock(repo, tourId)).toBeNull();

    const showResult = await run(["show", tourId, "--json"], repo);
    const data = JSON.parse(showResult.stdout) as {
      annotations: Array<{
        id: string;
        body: string;
        author_kind: string;
        replies_to?: string;
      }>;
    };
    const replies = data.annotations.filter((a) => a.replies_to !== undefined);
    expect(replies.length).toBeGreaterThanOrEqual(1);
    const fixture = replies.find((a) => a.author_kind === "agent");
    expect(fixture?.body).toBe("fixture: heard you.");

    delete process.env.TOUR_CLI;
    delete process.env.TOUR_FIXTURE_BODY;
  }, 30_000);
});
