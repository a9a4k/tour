import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { resolveTourLocation } from "../../src/core/tour-location.js";

const exec = promisify(execFile);

const CLI = join(import.meta.dirname, "../../src/main.ts");

// Invoke the CLI via `bun` (preinstalled by setup-bun@v2 in CI; on PATH in
// dev). Avoids the `npx tsx` cold-cache install race that fails on CI:
// the test's tmpdir cwd hides the project's node_modules from npx's
// walk-up resolution, forcing a fresh tsx install into ~/.npm/_npx/, and
// parallel vitest workers race for the same cache dir → exit 254. The
// other two integration tests (tui.test.ts, webapp.test.ts) already use
// `bun` for the same reason.
async function run(
  args: string[],
  cwd: string,
  opts?: { stdin?: string; tourHome?: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tourHome = opts?.tourHome ?? tourHomeFor(cwd);
  try {
    const child = exec("bun", [CLI, ...args], {
      cwd,
      env: { ...process.env, TOUR_HOME: tourHome },
      maxBuffer: 10 * 1024 * 1024,
      timeout: opts?.timeoutMs,
    });
    if (opts?.stdin && child.child.stdin) {
      child.child.stdin.write(opts.stdin);
      child.child.stdin.end();
    }
    const { stdout, stderr } = await child;
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

async function createLinkedWorktree(repo: string): Promise<string> {
  const linked = await mkdtemp(join(tmpdir(), "tour-cli-linked-"));
  await gitCmd(["worktree", "add", linked, "-b", `linked-${Date.now()}`], repo);
  return linked;
}

function tourHomeFor(cwd: string): string {
  let current = cwd;
  const fsRoot = parse(current).root;
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return join(tmpdir(), `tour-cli-home-${current.split("/").pop()}`);
    }
    if (current === fsRoot) {
      return join(tmpdir(), `tour-cli-home-${cwd.split("/").pop()}`);
    }
    current = dirname(current);
  }
}

async function gitCmd(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-cli-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "hello.txt"), "hello\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "initial"], dir);
  await writeFile(join(dir, "hello.txt"), "hello world\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "update hello"], dir);
  return dir;
}

describe("CLI integration", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await createTempRepo();
  });

  describe("create", () => {
    it("prints only the tour-id to stdout and the 'Open with' hint to stderr (issue #205)", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--title", "Test tour"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      // stdout: exactly the id, single line, no trailing prose — `$()` capture
      // friendly so downstream `tour annotate "$TOUR_ID"` works directly.
      expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/);
      // stderr: the human-readable hint, referencing the same id.
      expect(result.stderr).toContain("Open with: tour tui");
      expect(result.stderr).toContain(result.stdout);
    });

    it("creates tour under TOUR_HOME repo key (--json: structured to stdout, empty stderr)", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const tour = JSON.parse(result.stdout);
      expect(tour.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(tour.status).toBe("open");
      const location = await resolveTourLocation(repo, {
        env: { TOUR_HOME: tourHomeFor(repo) },
      });
      expect(tour.created_in_worktree).toBe(location.worktreeStamp);
      expect(existsSync(join(location.tourStoreRoot, tour.id, "tour.toml"))).toBe(true);
      expect(existsSync(join(repo, ".tour"))).toBe(false);
      // --json suppresses the hint entirely — stderr is empty.
      expect(result.stderr).toBe("");
    });

    it("does not touch the repo worktree", async () => {
      await run(["create", "--head", "HEAD"], repo);
      expect(await gitCmd(["status", "--short"], repo)).toBe("");
      expect(existsSync(join(repo, ".tour"))).toBe(false);
      expect(existsSync(join(repo, ".gitignore"))).toBe(false);
    });

    it("fails with invalid ref", async () => {
      const result = await run(["create", "--head", "nonexistent"], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error");
    });

    it("fails without --head", async () => {
      const result = await run(["create"], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--head");
    });

    it("creates wip tour", async () => {
      await writeFile(join(repo, "new.txt"), "new file\n");
      const result = await run(
        ["create", "--head", "WIP", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const tour = JSON.parse(result.stdout);
      expect(tour.wip_snapshot).toBe(true);
      expect(tour.head_source).toBe("WIP");
    });

    describe("default --base resolution (issue #201)", () => {
      async function addUpstream(dir: string): Promise<void> {
        const bare = await mkdtemp(join(tmpdir(), "tour-cli-upstream-"));
        await gitCmd(["clone", "--bare", dir, bare], dir);
        await gitCmd(["remote", "add", "origin", bare], dir);
        await gitCmd(["fetch", "origin"], dir);
        const branch = await gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], dir);
        await gitCmd(["branch", `--set-upstream-to=origin/${branch}`, branch], dir);
      }

      it("uses merge-base with origin/<default> on a multi-commit branch (issue #289)", async () => {
        // The temp repo starts with 2 commits. Pin upstream to the first,
        // putting HEAD 2 commits ahead — merge-base(HEAD, upstream) == initial.
        await gitCmd(["reset", "--hard", "HEAD^"], repo);
        await addUpstream(repo);
        await writeFile(join(repo, "hello.txt"), "hello world\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "update hello"], repo);
        await writeFile(join(repo, "third.txt"), "third\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "third"], repo);

        const branch = await gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], repo);
        const expectedBase = await gitCmd(["merge-base", `origin/${branch}`, "HEAD"], repo);
        const result = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.base_sha).toBe(expectedBase);
        // Post-#289: the probe chain names the resolved default-branch
        // anchor in the source string, not `@{upstream}`.
        expect(tour.base_source).toBe(`merge-base(origin/${branch})`);
      });

      it("falls back to HEAD^ on a single-commit branch ahead of upstream", async () => {
        await gitCmd(["reset", "--hard", "HEAD^"], repo);
        await addUpstream(repo);
        await writeFile(join(repo, "hello.txt"), "hello world\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "single feature"], repo);

        const expectedBase = await gitCmd(["rev-parse", "HEAD^"], repo);
        const result = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.base_sha).toBe(expectedBase);
        expect(tour.base_source).toBe("HEAD^");
      });

      it("falls back to HEAD^ when no upstream is configured", async () => {
        // Repo from createTempRepo has 2 commits and no remote.
        const expectedBase = await gitCmd(["rev-parse", "HEAD^"], repo);
        const result = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.base_sha).toBe(expectedBase);
        expect(tour.base_source).toBe("HEAD^");
      });

      it("honors explicit --base verbatim on a multi-commit branch", async () => {
        await gitCmd(["reset", "--hard", "HEAD^"], repo);
        await addUpstream(repo);
        await writeFile(join(repo, "hello.txt"), "hello world\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "update hello"], repo);
        await writeFile(join(repo, "third.txt"), "third\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "third"], repo);

        const headParent = await gitCmd(["rev-parse", "HEAD^"], repo);
        const result = await run(
          ["create", "--head", "HEAD", "--base", "HEAD^", "--json"],
          repo,
        );
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.base_sha).toBe(headParent);
        expect(tour.base_source).toBe("HEAD^");
      });

      it("applies merge-base logic to WIP tours", async () => {
        await gitCmd(["reset", "--hard", "HEAD^"], repo);
        await addUpstream(repo);
        await writeFile(join(repo, "hello.txt"), "hello world\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "update hello"], repo);
        await writeFile(join(repo, "third.txt"), "third\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "third"], repo);
        await writeFile(join(repo, "wip.txt"), "wip changes\n");

        const branch = await gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], repo);
        const expectedBase = await gitCmd(["merge-base", `origin/${branch}`, "HEAD"], repo);
        const result = await run(["create", "--head", "WIP", "--json"], repo);
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.wip_snapshot).toBe(true);
        expect(tour.base_sha).toBe(expectedBase);
        expect(tour.base_source).toBe(`merge-base(origin/${branch})`);
      });
    });

    describe("duplicate-open-tour refusal (issue #400)", () => {
      it("second create against the same (head_sha, base_sha) exits 1 with stderr block and empty stdout", async () => {
        const first = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(first.exitCode).toBe(0);
        const firstTour = JSON.parse(first.stdout);

        const second = await run(["create", "--head", "HEAD"], repo);
        expect(second.exitCode).toBe(1);
        // stdout is empty in non-JSON refuse case so `$()` capture
        // never picks up the existing id by accident.
        expect(second.stdout).toBe("");
        // stderr names the existing tour id and the three recovery commands.
        expect(second.stderr).toContain(
          `error: open tour ${firstTour.id} already covers this diff`,
        );
        expect(second.stderr).toContain(`head_sha=${firstTour.head_sha.slice(0, 7)}`);
        expect(second.stderr).toContain(`base_sha=${firstTour.base_sha.slice(0, 7)}`);
        expect(second.stderr).toContain(`resume:   tour tui ${firstTour.id}`);
        expect(second.stderr).toContain(`list:     tour list --status open`);
        expect(second.stderr).toContain(`override: tour create --head HEAD --force`);

        // Still only one tour on disk.
        const ls = await run(["list", "--json"], repo);
        const tours = JSON.parse(ls.stdout);
        expect(tours).toHaveLength(1);
        expect(tours[0].id).toBe(firstTour.id);
      });

      it("--force overrides the refusal and creates a fresh tour", async () => {
        const first = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(first.exitCode).toBe(0);
        const firstTour = JSON.parse(first.stdout);

        const second = await run(["create", "--head", "HEAD", "--force"], repo);
        expect(second.exitCode).toBe(0);
        expect(second.stdout).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/);
        expect(second.stdout).not.toBe(firstTour.id);
        expect(second.stderr).toContain(`Open with: tour tui ${second.stdout}`);

        const ls = await run(["list", "--json"], repo);
        const tours = JSON.parse(ls.stdout);
        expect(tours).toHaveLength(2);
      });

      it("closed tour does not block a new create over the same diff", async () => {
        const first = await run(["create", "--head", "HEAD", "--json"], repo);
        const firstTour = JSON.parse(first.stdout);
        const closeResult = await run(["close", firstTour.id], repo);
        expect(closeResult.exitCode).toBe(0);

        const second = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(second.exitCode).toBe(0);
        const secondTour = JSON.parse(second.stdout);
        expect(secondTour.id).not.toBe(firstTour.id);
        expect(secondTour.status).toBe("open");
      });

      it("base divergence is legitimate — same head + different base creates a new tour", async () => {
        // Add a third commit so HEAD^ and HEAD^^ are distinct shas the
        // matcher can disagree on.
        await writeFile(join(repo, "third.txt"), "third\n");
        await gitCmd(["add", "."], repo);
        await gitCmd(["commit", "-m", "third"], repo);

        const first = await run(
          ["create", "--head", "HEAD", "--base", "HEAD^", "--json"],
          repo,
        );
        expect(first.exitCode).toBe(0);
        const firstTour = JSON.parse(first.stdout);

        const second = await run(
          ["create", "--head", "HEAD", "--base", "HEAD^^", "--json"],
          repo,
        );
        expect(second.exitCode).toBe(0);
        const secondTour = JSON.parse(second.stdout);
        expect(secondTour.head_sha).toBe(firstTour.head_sha);
        expect(secondTour.base_sha).not.toBe(firstTour.base_sha);
        expect(secondTour.id).not.toBe(firstTour.id);
      });

      it("--json refuse case emits the existing tour's record (with comments) on stdout, exits 1", async () => {
        const first = await run(
          ["create", "--head", "HEAD", "--title", "Existing", "--json"],
          repo,
        );
        const firstTour = JSON.parse(first.stdout);
        // Add a comment so the record's `comments` array is not just `[]`
        // and the envelope shape can be compared against `tour show --json`.
        await run(
          [
            "comment", firstTour.id,
            "--file", "hello.txt",
            "--side", "additions",
            "--line", "1",
            "--body", "from issue 400",
            "--author", "human",
            "--as-human",
          ],
          repo,
        );

        const showJson = await run(["show", firstTour.id, "--json"], repo);
        const showRecord = JSON.parse(showJson.stdout);

        const second = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(second.exitCode).toBe(1);
        const refuseRecord = JSON.parse(second.stdout);
        expect(refuseRecord).toEqual(showRecord);
        // The stderr block is still printed alongside the JSON.
        expect(second.stderr).toContain(`error: open tour ${firstTour.id}`);
      });

      it("--json --force emits the new tour's record on stdout, exits 0", async () => {
        const first = await run(["create", "--head", "HEAD", "--json"], repo);
        const firstTour = JSON.parse(first.stdout);

        const second = await run(
          ["create", "--head", "HEAD", "--json", "--force"],
          repo,
        );
        expect(second.exitCode).toBe(0);
        const newTour = JSON.parse(second.stdout);
        expect(newTour.id).not.toBe(firstTour.id);
        expect(newTour.status).toBe("open");
        expect(second.stderr).toBe("");
      });

      it("WIP is exempt — `tour create --head WIP` after an open WIP tour still creates", async () => {
        await writeFile(join(repo, "wip.txt"), "wip changes\n");
        const first = await run(["create", "--head", "WIP", "--json"], repo);
        expect(first.exitCode).toBe(0);
        const firstTour = JSON.parse(first.stdout);

        const second = await run(["create", "--head", "WIP", "--json"], repo);
        expect(second.exitCode).toBe(0);
        const secondTour = JSON.parse(second.stdout);
        expect(secondTour.id).not.toBe(firstTour.id);
        expect(secondTour.wip_snapshot).toBe(true);
      });
    });

  });

  describe("list", () => {
    it("shows open tours by default", async () => {
      const cr = await run(["create", "--head", "HEAD", "--title", "My Tour", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["list"], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(tour.id);
      expect(result.stdout).toContain("My Tour");
    });

    it("shows no tours message when empty", async () => {
      const result = await run(["list"], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No tours found");
    });

    it("supports --json", async () => {
      await run(["create", "--head", "HEAD", "--json"], repo);
      const result = await run(["list", "--json"], repo);
      expect(result.exitCode).toBe(0);
      const tours = JSON.parse(result.stdout);
      expect(Array.isArray(tours)).toBe(true);
      expect(tours.length).toBe(1);
    });

    it("hides tours from another linked worktree by default and shows them with --all", async () => {
      const tourHome = await mkdtemp(join(tmpdir(), "tour-cli-shared-home-"));
      const linked = await createLinkedWorktree(repo);
      const created = await run(
        ["create", "--head", "HEAD", "--title", "main worktree", "--json"],
        repo,
        { tourHome },
      );
      const tour = JSON.parse(created.stdout);

      const defaultList = await run(["list", "--json"], linked, { tourHome });
      expect(defaultList.exitCode).toBe(0);
      expect(JSON.parse(defaultList.stdout)).toEqual([]);

      const allList = await run(["list", "--all", "--json"], linked, { tourHome });
      expect(allList.exitCode).toBe(0);
      expect(JSON.parse(allList.stdout).map((t: { id: string }) => t.id)).toEqual([
        tour.id,
      ]);
    });

    it("scopes WIP tours to the worktree that created them", async () => {
      const tourHome = await mkdtemp(join(tmpdir(), "tour-cli-shared-home-"));
      const linked = await createLinkedWorktree(repo);
      await writeFile(join(repo, "wip.txt"), "main worktree wip\n");
      const created = await run(
        ["create", "--head", "WIP", "--title", "main wip", "--json"],
        repo,
        { tourHome },
      );
      const tour = JSON.parse(created.stdout);
      expect(tour.wip_snapshot).toBe(true);

      const defaultList = await run(["list", "--json"], linked, { tourHome });
      expect(defaultList.exitCode).toBe(0);
      expect(JSON.parse(defaultList.stdout)).toEqual([]);

      const allList = await run(["list", "--all", "--json"], linked, { tourHome });
      expect(JSON.parse(allList.stdout).map((t: { id: string }) => t.id)).toEqual([
        tour.id,
      ]);
    });
  });

  describe("smart defaults", () => {
    it("bare tour prints the first-run banner when only another worktree has tours", async () => {
      const tourHome = await mkdtemp(join(tmpdir(), "tour-cli-shared-home-"));
      const linked = await createLinkedWorktree(repo);
      await run(
        ["create", "--head", "HEAD", "--title", "main worktree", "--json"],
        repo,
        { tourHome },
      );

      const result = await run([], linked, { tourHome, timeoutMs: 2000 });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No tours found for this worktree");
      expect(result.stdout).toContain("tour list --all");
    });

    it("tour tui without an id ignores tours from another worktree", async () => {
      const tourHome = await mkdtemp(join(tmpdir(), "tour-cli-shared-home-"));
      const linked = await createLinkedWorktree(repo);
      await run(
        ["create", "--head", "HEAD", "--title", "main worktree", "--json"],
        repo,
        { tourHome },
      );

      const result = await run(["tui"], linked, { tourHome, timeoutMs: 2000 });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No open tours");
    });
  });

  describe("show", () => {
    it("displays tour details", async () => {
      const cr = await run(["create", "--head", "HEAD", "--title", "Show Test", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["show", tour.id], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Show Test");
      expect(result.stdout).toContain(tour.head_sha.slice(0, 12));
    });

    it("supports --json with comments included", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["show", tour.id, "--json"], repo);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe(tour.id);
      expect(data.comments).toEqual([]);
    });

    it("supports prefix matching", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const prefix = tour.id.slice(0, 11);
      const result = await run(["show", prefix, "--json"], repo);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe(tour.id);
    });

    it("explicit-id commands resolve tours from another linked worktree", async () => {
      const tourHome = await mkdtemp(join(tmpdir(), "tour-cli-shared-home-"));
      const linked = await createLinkedWorktree(repo);
      const cr = await run(["create", "--head", "HEAD", "--json"], repo, { tourHome });
      const tour = JSON.parse(cr.stdout);

      const showResult = await run(["show", tour.id, "--json"], linked, { tourHome });
      expect(showResult.exitCode).toBe(0);
      expect(JSON.parse(showResult.stdout).id).toBe(tour.id);

      const closeResult = await run(["close", tour.id, "--json"], linked, { tourHome });
      expect(closeResult.exitCode).toBe(0);
      expect(JSON.parse(closeResult.stdout).status).toBe("closed");

      const deleteResult = await run(["delete", tour.id, "--json"], linked, { tourHome });
      expect(deleteResult.exitCode).toBe(0);
      expect(JSON.parse(deleteResult.stdout)).toEqual({ deleted: tour.id });
    });
  });

  describe("annotate", () => {
    it("adds a single comment", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "Looks good",
        "--author", "claude-code",
      ], repo);
      expect(result.exitCode).toBe(0);

      const showResult = await run(["show", tour.id, "--json"], repo);
      const data = JSON.parse(showResult.stdout);
      expect(data.comments).toHaveLength(1);
      expect(data.comments[0].file).toBe("hello.txt");
      expect(data.comments[0].body).toBe("Looks good");
    });

    it("adds batch comments from stdin", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      // hello.txt is the only file in the test repo's diff; both items
      // target it within the file's 1-line bounds (additions and
      // deletions sides each have 1 line at the pinned SHA).
      const batch = JSON.stringify([
        { file: "hello.txt", side: "additions", line: "1", body: "Note 1", author: "agent" },
        { file: "hello.txt", side: "deletions", line: "1", body: "Note 2", author: "agent" },
      ]);
      const result = await run(
        ["annotate", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: batch },
      );
      expect(result.exitCode).toBe(0);
      const comments = JSON.parse(result.stdout);
      expect(comments).toHaveLength(2);
    });

    it("accepts JSONL on stdin in --batch mode (issue #172)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl =
        `{"file":"hello.txt","side":"additions","line":"1","body":"Note 1"}\n` +
        `{"file":"hello.txt","side":"deletions","line":"1","body":"Note 2"}\n`;
      const result = await run(
        ["annotate", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(result.exitCode).toBe(0);
      const comments = JSON.parse(result.stdout);
      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe("Note 1");
      expect(comments[1].body).toBe("Note 2");
    });

    it("accepts line_start/line_end anchor shape and mixes with `line` (issue #172)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      // Both forms anchored at line 1 (the file's only line on each side).
      const jsonl =
        `{"file":"hello.txt","side":"additions","line_start":1,"line_end":1,"body":"native"}\n` +
        `{"file":"hello.txt","side":"deletions","line":"1","body":"legacy"}\n`;
      const result = await run(
        ["annotate", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(result.exitCode).toBe(0);
      const comments = JSON.parse(result.stdout);
      expect(comments).toHaveLength(2);
      expect(comments[0].line_start).toBe(1);
      expect(comments[0].line_end).toBe(1);
      expect(comments[1].line_start).toBe(1);
      expect(comments[1].line_end).toBe(1);
    });

    it("supports thread_id in JSONL --batch mode (issue #172)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const root = JSON.parse(
        (
          await run(
            [
              "annotate", tour.id,
              "--file", "hello.txt",
              "--side", "additions",
              "--line", "1",
              "--body", "root",
              "--json",
            ],
            repo,
          )
        ).stdout,
      );
      const jsonl = `{"thread_id":"${root.id}","body":"reply via JSONL"}\n`;
      const result = await run(
        ["annotate", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(result.exitCode).toBe(0);
      const comments = JSON.parse(result.stdout);
      expect(comments).toHaveLength(1);
      expect(comments[0].thread_id).toBe(root.id);
      expect(comments[0].body).toBe("reply via JSONL");
    });

    it("reports the offending line number on JSONL parse failure (issue #172)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl =
        `{"file":"hello.txt","side":"additions","line":"1","body":"ok"}\n` +
        `{not valid json}\n`;
      const result = await run(
        ["annotate", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/Line 2:/);
    });

    it("rejects comment whose file is not in the Tour's diff (slice 4 / #144)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run([
        "annotate", tour.id,
        "--file", "no-such-file.ts",
        "--side", "additions",
        "--line", "1",
        "--body", "doomed",
      ], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no-such-file.ts");
    });

    it("rejects comment whose line_end exceeds the file's line count (slice 4 / #144)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "9999",
        "--body", "doomed",
      ], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/line/i);
    });

    it("rejects invalid side", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "invalid",
        "--line", "1",
        "--body", "test",
      ], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid side");
    });

    it("defaults author_kind to agent (no flag)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "default kind",
        "--json",
      ], repo);
      expect(r.exitCode).toBe(0);
      const ann = JSON.parse(r.stdout);
      expect(ann.author_kind).toBe("agent");
    });

    it("--as-human sets author_kind to human", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "human note",
        "--as-human",
        "--json",
      ], repo);
      expect(r.exitCode).toBe(0);
      const ann = JSON.parse(r.stdout);
      expect(ann.author_kind).toBe("human");
    });

    it("--reply-to creates a reply that inherits the parent's anchor", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const root = JSON.parse((await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "root note",
        "--json",
      ], repo)).stdout);
      const r = await run([
        "annotate", tour.id,
        "--reply-to", root.id,
        "--body", "thanks!",
        "--as-human",
        "--json",
      ], repo);
      expect(r.exitCode).toBe(0);
      const reply = JSON.parse(r.stdout);
      expect(reply.thread_id).toBe(root.id);
      expect(reply.author_kind).toBe("human");
      expect(reply.file).toBe(root.file);
      expect(reply.side).toBe(root.side);
      expect(reply.line_start).toBe(root.line_start);
      expect(reply.line_end).toBe(root.line_end);
    });

    it("--reply-to with unknown id fails cleanly", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "annotate", tour.id,
        "--reply-to", "ghost-id",
        "--body", "no parent",
      ], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("ghost-id");
    });

    it("--as-agent and --as-human together is rejected", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "ambiguous",
        "--as-agent",
        "--as-human",
      ], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("mutually exclusive");
    });

    // Issue #336: stdout prose flips from "comment"/"comments" to
    // "comment"/"comments" per ADR 0029. Both verbs share the same handler,
    // so both surfaces emit the new prose.
    it("prints 'Added comment to <id>: <f>:<line>' on a single create", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "looks good",
      ], repo);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`Added comment to ${tour.id}: hello.txt:1`);
    });

    it("prints 'Added N comments to <id>' on batch create", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const batch = JSON.stringify([
        { file: "hello.txt", side: "additions", line: "1", body: "Note 1" },
        { file: "hello.txt", side: "deletions", line: "1", body: "Note 2" },
      ]);
      const r = await run(
        ["annotate", tour.id, "--batch", "-"],
        repo,
        { stdin: batch },
      );
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`Added 2 comments to ${tour.id}`);
    });
  });

  // Issue #336: `tour comment` is the primary verb; `tour annotate` is a
  // permanent silent alias dispatching the same handler. Parity is the
  // contract: same input → same on-disk effect → same `--json` shape →
  // same exit code → no stderr nag on the alias.
  describe("comment (alias of annotate)", () => {
    it("`tour comment ...` creates the same record `tour annotate ...` would (single)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "comment", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "via comment verb",
        "--author", "claude-code",
        "--json",
      ], repo);
      expect(r.exitCode).toBe(0);
      const ann = JSON.parse(r.stdout);
      expect(ann.file).toBe("hello.txt");
      expect(ann.body).toBe("via comment verb");
      // Top-level (no `thread_id`) — the on-disk shape never carried a
      // `kind` field; the discriminator is presence/absence of `thread_id`.
      expect(ann.thread_id).toBeUndefined();
      // On-disk file is `tour-events.jsonl` after ADR 0036 (the event log
      // replaces the Stage B `comments.jsonl` snapshot log).
      const showR = await run(["show", tour.id, "--json"], repo);
      const data = JSON.parse(showR.stdout);
      expect(data.comments).toHaveLength(1);
      expect(data.comments[0].id).toBe(ann.id);
    });

    it("`tour comment ...` and `tour annotate ...` produce byte-identical --json on the same input", async () => {
      // Two parallel tours; identical input under each verb. The id and
      // created_at fields will differ — strip them before comparing.
      const ca = await run(["create", "--head", "HEAD", "--json"], repo);
      const cb = await run(["create", "--head", "HEAD", "--json"], repo);
      const tourA = JSON.parse(ca.stdout);
      const tourB = JSON.parse(cb.stdout);
      const flagsA = [
        "annotate", tourA.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "parity",
        "--author", "agent",
        "--json",
      ];
      const flagsB = [
        "comment", tourB.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "parity",
        "--author", "agent",
        "--json",
      ];
      const ra = await run(flagsA, repo);
      const rb = await run(flagsB, repo);
      expect(ra.exitCode).toBe(0);
      expect(rb.exitCode).toBe(0);
      const a = JSON.parse(ra.stdout);
      const b = JSON.parse(rb.stdout);
      // Strip per-record fields; everything else must match byte-for-byte.
      delete a.id; delete a.created_at;
      delete b.id; delete b.created_at;
      expect(a).toEqual(b);
    });

    it("`tour comment ...` prints the same 'Added comment to ...' stdout as the annotate verb", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "comment", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "prose check",
      ], repo);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`Added comment to ${tour.id}: hello.txt:1`);
    });

    it("`tour comment ... --batch -` accepts JSONL on stdin like the annotate verb", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl =
        `{"file":"hello.txt","side":"additions","line":"1","body":"b1"}\n` +
        `{"file":"hello.txt","side":"deletions","line":"1","body":"b2"}\n`;
      const r = await run(
        ["comment", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(r.exitCode).toBe(0);
      const anns = JSON.parse(r.stdout);
      expect(anns).toHaveLength(2);
    });

    it("`tour annotate ...` is silent on stderr — no deprecation warning", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run([
        "annotate", tour.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "silent",
      ], repo);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe("");
    });

    it("`tour --help` lists `tour comment` as primary with `(alias: annotate)`", async () => {
      const r = await run(["--help"], repo);
      expect(r.exitCode).toBe(0);
      // Primary verb appears as `tour comment <id> ...` in the synopsis.
      expect(r.stdout).toMatch(/tour comment <id>/);
      // Alias is documented in the same help text — no separate annotate
      // synopsis line.
      expect(r.stdout).toMatch(/alias: annotate/);
      expect(r.stdout).not.toMatch(/tour annotate <id>/);
    });

    // PRD #349 / ADR 0032 / issue #352: open-in-editor slice 1 — the
    // `--editor <cmd>` flag is advertised on the `tour tui` line of the
    // USAGE block. Webapp parity (`tour serve --editor`) lands in #353.
    it("`tour --help` documents `--editor` on the `tour tui` line (issue #352)", async () => {
      const r = await run(["--help"], repo);
      expect(r.exitCode).toBe(0);
      const tuiLine = r.stdout
        .split("\n")
        .find((l) => l.trim().startsWith("tour tui "));
      expect(tuiLine).toBeDefined();
      expect(tuiLine).toContain("[--editor <cmd>]");
    });

    // PRD #349 / ADR 0032 / issue #353: webapp parity for `o` extends
    // the `--editor` flag onto the `tour serve` line. The USAGE block
    // already carried it from #352; this is the regression guard so
    // the doc + the parser don't drift apart.
    it("`tour --help` documents `--editor` on the `tour serve` line (issue #353)", async () => {
      const r = await run(["--help"], repo);
      expect(r.exitCode).toBe(0);
      const serveLine = r.stdout
        .split("\n")
        .find((l) => l.trim().startsWith("tour serve "));
      expect(serveLine).toBeDefined();
      expect(serveLine).toContain("[--editor <cmd>]");
    });
  });

  // Issue #396: prevent agent author-identity mistakes when authoring
  // via the CLI. Two CLI-side improvements:
  //   1. `--as-human` + `--batch -` + non-TTY stdin is a stderr-only nudge.
  //      Captured in agent transcripts; the operation still succeeds.
  //   2. `--author` in `--batch -` mode acts as a per-batch default,
  //      mirroring `--as-agent` / `--as-human`. Per-item JSONL `author`
  //      still overrides.
  describe("author-identity safeguards (issue #396)", () => {
    it("emits a stderr nudge when --as-human + --batch - sees non-TTY stdin", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl = `{"file":"hello.txt","side":"additions","line":"1","body":"nudge-me"}\n`;
      const r = await run(
        ["comment", tour.id, "--as-human", "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      // Warning is a nudge, not a refusal — exit 0 and the comment lands.
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toMatch(/tour: warning:.*issue #396/i);
      expect(r.stderr).toMatch(/--as-human/);
      const anns = JSON.parse(r.stdout);
      expect(anns).toHaveLength(1);
      expect(anns[0].author_kind).toBe("human");
    });

    it("does not warn when --as-human is paired with the single-comment path (no --batch)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run(
        [
          "comment", tour.id,
          "--file", "hello.txt",
          "--side", "additions",
          "--line", "1",
          "--body", "interactive-ish",
          "--as-human",
          "--json",
        ],
        repo,
      );
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe("");
    });

    it("does not warn when --as-agent + --batch - is used (the correct agent shape)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl = `{"file":"hello.txt","side":"additions","line":"1","body":"agent-batch"}\n`;
      const r = await run(
        ["comment", tour.id, "--as-agent", "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe("");
    });

    it("--author in --batch - mode cascades into items that omit `author`", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl =
        `{"file":"hello.txt","side":"additions","line":"1","body":"a"}\n` +
        `{"file":"hello.txt","side":"deletions","line":"1","body":"b"}\n`;
      const r = await run(
        [
          "comment", tour.id,
          "--as-agent",
          "--author", "claude",
          "--batch", "-",
          "--json",
        ],
        repo,
        { stdin: jsonl },
      );
      expect(r.exitCode).toBe(0);
      const anns = JSON.parse(r.stdout);
      expect(anns).toHaveLength(2);
      expect(anns[0].author).toBe("claude");
      expect(anns[1].author).toBe("claude");
      // The author_kind cascade is unaffected by this change.
      expect(anns[0].author_kind).toBe("agent");
      expect(anns[1].author_kind).toBe("agent");
    });

    it("per-item `author` in JSONL still overrides the CLI --author default", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const jsonl =
        `{"file":"hello.txt","side":"additions","line":"1","body":"a","author":"override"}\n` +
        `{"file":"hello.txt","side":"deletions","line":"1","body":"b"}\n`;
      const r = await run(
        [
          "comment", tour.id,
          "--as-agent",
          "--author", "claude",
          "--batch", "-",
          "--json",
        ],
        repo,
        { stdin: jsonl },
      );
      expect(r.exitCode).toBe(0);
      const anns = JSON.parse(r.stdout);
      expect(anns).toHaveLength(2);
      // Per-item author wins on line 1; CLI default fills in on line 2.
      expect(anns[0].author).toBe("override");
      expect(anns[1].author).toBe("claude");
    });
  });

  // Issue #387 (Slice C / ADR 0036). `tour comment <tour-id>
  // --delete <comment-id>` appends a `comment.deleted` event via the
  // humans-only `createDelete` write seam. `--as-agent --delete` is
  // refused at parse-time so the error surfaces before any I/O. Delete
  // is mutually exclusive with the create / reply flag families.
  describe("comment --delete (Slice C / ADR 0036, issue #387)", () => {
    async function annotate(
      repo: string,
      tourId: string,
      body: string,
      extra: string[] = [],
    ): Promise<{ id: string }> {
      const r = await run(
        [
          "comment",
          tourId,
          "--file",
          "hello.txt",
          "--side",
          "additions",
          "--line",
          "1",
          "--body",
          body,
          "--json",
          ...extra,
        ],
        repo,
      );
      if (r.exitCode !== 0) throw new Error(`annotate failed: ${r.stderr}`);
      return JSON.parse(r.stdout);
    }

    it("non-JSON: prints 'Deleted comment <id>' on stdout, exit 0", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "to-delete");
      const r = await run(["comment", tour.id, "--delete", ann.id], repo);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`Deleted comment ${ann.id}`);
    });

    it("--json: emits { deleted: <comment-id> } envelope", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "to-delete");
      const r = await run(
        ["comment", tour.id, "--delete", ann.id, "--json"],
        repo,
      );
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed).toEqual({ deleted: ann.id });
    });

    it("--as-agent --delete is rejected at parse with a clear humans-only error", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "agent-can-not-delete");
      const r = await run(
        ["comment", tour.id, "--delete", ann.id, "--as-agent"],
        repo,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/human/i);
      // The error must surface before any write — the comment is still
      // there afterward.
      const show = await run(["show", tour.id, "--json"], repo);
      const data = JSON.parse(show.stdout);
      expect(data.comments.map((c: { id: string }) => c.id)).toEqual([ann.id]);
    });

    it("rejects unknown target id with a clear error", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const r = await run(
        ["comment", tour.id, "--delete", "ghost-id"],
        repo,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("ghost-id");
    });

    it("--delete is mutually exclusive with --file/--side/--line/--body", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "first");
      const r = await run(
        [
          "comment",
          tour.id,
          "--delete",
          ann.id,
          "--file",
          "hello.txt",
          "--side",
          "additions",
          "--line",
          "1",
          "--body",
          "x",
        ],
        repo,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/mutually exclusive/i);
    });

    it("--delete is mutually exclusive with --reply-to", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "root");
      const r = await run(
        [
          "comment",
          tour.id,
          "--delete",
          ann.id,
          "--reply-to",
          ann.id,
          "--body",
          "x",
        ],
        repo,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/mutually exclusive/i);
    });

    it("pickup --json reflects deletion of a leaf reply (reply absent under parent)", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const root = await annotate(repo, tour.id, "parent");
      const replyR = await run(
        [
          "comment",
          tour.id,
          "--reply-to",
          root.id,
          "--body",
          "reply body",
          "--as-human",
          "--json",
        ],
        repo,
      );
      const reply = JSON.parse(replyR.stdout);
      const del = await run(
        ["comment", tour.id, "--delete", reply.id],
        repo,
      );
      expect(del.exitCode).toBe(0);
      const pickup = await run(["pickup", tour.id, "--json"], repo);
      const tree = JSON.parse(pickup.stdout);
      expect(tree.comments).toHaveLength(1);
      expect(tree.comments[0].id).toBe(root.id);
      expect(tree.comments[0].replies).toEqual([]);
    });

    it("pickup --json reflects C4 stub when a parent with surviving reply is deleted", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const root = await annotate(repo, tour.id, "parent body");
      await run(
        [
          "comment",
          tour.id,
          "--reply-to",
          root.id,
          "--body",
          "still here",
          "--as-human",
          "--json",
        ],
        repo,
      );
      const del = await run(
        ["comment", tour.id, "--delete", root.id],
        repo,
      );
      expect(del.exitCode).toBe(0);
      const pickup = await run(["pickup", tour.id, "--json"], repo);
      const tree = JSON.parse(pickup.stdout);
      expect(tree.comments).toHaveLength(1);
      const stub = tree.comments[0];
      expect(stub.id).toBe(root.id);
      expect(stub.body).toBe("");
      expect(stub.deleted).toBeDefined();
      expect(typeof stub.deleted.at).toBe("string");
      expect(stub.replies).toHaveLength(1);
      expect(stub.replies[0].body).toBe("still here");
    });

    it("pickup --json reflects fully-deleted Thread vanishing", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "lonely note");
      const del = await run(["comment", tour.id, "--delete", ann.id], repo);
      expect(del.exitCode).toBe(0);
      const pickup = await run(["pickup", tour.id, "--json"], repo);
      const tree = JSON.parse(pickup.stdout);
      expect(tree.comments).toEqual([]);
    });

    it("double-delete on a leaf is rejected at the second invocation", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const ann = await annotate(repo, tour.id, "delete-once");
      const first = await run(
        ["comment", tour.id, "--delete", ann.id],
        repo,
      );
      expect(first.exitCode).toBe(0);
      const second = await run(
        ["comment", tour.id, "--delete", ann.id],
        repo,
      );
      expect(second.exitCode).toBe(1);
      expect(second.stderr).toContain(ann.id);
    });
  });

  describe("pickup", () => {
    it("prints the conversation tree as JSON to stdout (exit 0)", async () => {
      const cr = await run(
        ["create", "--head", "HEAD", "--title", "Pickup test", "--json"],
        repo,
      );
      const tour = JSON.parse(cr.stdout);
      const root = JSON.parse(
        (
          await run(
            [
              "annotate",
              tour.id,
              "--file",
              "hello.txt",
              "--side",
              "additions",
              "--line",
              "1",
              "--body",
              "initial review",
              "--json",
            ],
            repo,
          )
        ).stdout,
      );
      await run(
        [
          "annotate",
          tour.id,
          "--reply-to",
          root.id,
          "--body",
          "thanks",
          "--as-human",
          "--json",
        ],
        repo,
      );
      const r = await run(["pickup", tour.id, "--json"], repo);
      expect(r.exitCode).toBe(0);
      const tree = JSON.parse(r.stdout);
      expect(tree.id).toBe(tour.id);
      expect(tree.title).toBe("Pickup test");
      expect(tree.head_sha).toBe(tour.head_sha);
      expect(tree.base_sha).toBe(tour.base_sha);
      expect(tree.head_source).toBe(tour.head_source);
      expect(tree.base_source).toBe(tour.base_source);
      expect(tree.status).toBe("open");
      expect(tree.comments).toHaveLength(1);
      expect(tree.comments[0].id).toBe(root.id);
      expect(tree.comments[0].body).toBe("initial review");
      expect(tree.comments[0].replies).toHaveLength(1);
      expect(tree.comments[0].replies[0].body).toBe("thanks");
      expect(tree.comments[0].replies[0].author_kind).toBe("human");
      expect(tree).not.toHaveProperty("wip_snapshot");
      expect(tree).not.toHaveProperty("closed_at");
    });

    it("supports prefix matching", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const prefix = tour.id.slice(0, 11);
      const r = await run(["pickup", prefix, "--json"], repo);
      expect(r.exitCode).toBe(0);
      const tree = JSON.parse(r.stdout);
      expect(tree.id).toBe(tour.id);
      expect(tree.comments).toEqual([]);
    });

    it("exits non-zero on missing Tour with a clear error", async () => {
      await run(["create", "--head", "HEAD", "--json"], repo);
      const r = await run(["pickup", "no-such-tour"], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("no-such-tour");
    });

    it("requires <id>", async () => {
      const r = await run(["pickup"], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("pickup");
    });
  });

  describe("close", () => {
    it("marks tour as closed", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["close", tour.id], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Closed");

      const showResult = await run(["show", tour.id, "--json"], repo);
      const data = JSON.parse(showResult.stdout);
      expect(data.status).toBe("closed");
      expect(data.closed_at).not.toBe("");
    });
  });

  describe("delete", () => {
    it("removes tour folder", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const location = await resolveTourLocation(repo, {
        env: { TOUR_HOME: tourHomeFor(repo) },
      });
      const result = await run(["delete", tour.id], repo);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(location.tourStoreRoot, tour.id))).toBe(false);
    });
  });

  describe("prune", () => {
    it("prunes old closed tours", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      await run(["close", tour.id], repo);

      // 0m means prune anything closed
      const result = await run(["prune", "--older-than", "0m", "--json"], repo);
      // It may or may not prune depending on timing, but should not error
      expect(result.exitCode).toBe(0);
    });

    it("fails with invalid duration", async () => {
      const result = await run(["prune", "--older-than", "xyz"], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid duration");
    });
  });

  describe("help", () => {
    it("shows usage", async () => {
      const result = await run(["help"], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("tour");
      expect(result.stdout).toContain("create");
      expect(result.stdout).not.toContain("migrate");
    });
  });

  // Issue #393. The parser must accept `--flag=value` equivalently to
  // `--flag value` for every long flag. End-to-end smoke through the
  // real CLI binary — the unit-level matrix lives in
  // tests/core/parse-args.test.ts.
  describe("--flag=value form (issue #393)", () => {
    it("create --head=HEAD --title=Equals creates the tour", async () => {
      const result = await run(
        ["create", "--head=HEAD", "--title=Equals", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const tour = JSON.parse(result.stdout);
      expect(tour.title).toBe("Equals");
    });

    it("comment with all flags in =value form annotates the tour", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(
        [
          "comment",
          tour.id,
          "--file=hello.txt",
          "--side=additions",
          "--line=1",
          "--body=eq-form",
          "--json",
        ],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const ann = JSON.parse(result.stdout);
      expect(ann.body).toBe("eq-form");
      expect(ann.file).toBe("hello.txt");
    });

    it("tui --reply-agent=cursor fails fast with the shipped-agent error", async () => {
      // Mirrors the issue's repro recipe: an unknown reply-agent must
      // hit `assertShippedAgent` and exit non-zero with the same error
      // message the space form produces today.
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["tui", "--reply-agent=cursor", tour.id], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown reply-agent "cursor"');
      expect(result.stderr).toContain("claude");
    });

    it("--flag= (empty value) errors with a missing-value message", async () => {
      const result = await run(["tui", "--reply-agent="], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--reply-agent");
      expect(result.stderr.toLowerCase()).toContain("missing value");
    });
  });

  describe("unknown command", () => {
    it("exits with error", async () => {
      const result = await run(["bogus"], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command");
    });

    it("treats retired migrate as unknown", async () => {
      const result = await run(["migrate"], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command: migrate");
    });
  });

  describe("tour location resolution", () => {
    // Tests are invoked via a sub-process and `bun src/main.ts`; on macOS
    // /tmp resolves through /private/var, so the repo path the bun cwd
    // observes is realpath-normalised. Match that here when asserting.
    // Issue #365 / #368.
    let realRepo: string;
    beforeEach(async () => {
      realRepo = await realpath(repo);
    });

    it("writes to the same TOUR_HOME repo-key store when create runs from a sub-directory", async () => {
      const sub = join(repo, "deep", "nested");
      await mkdir(sub, { recursive: true });
      const cr = await run(["create", "--head", "HEAD", "--json"], sub);
      expect(cr.exitCode).toBe(0);
      const tour = JSON.parse(cr.stdout);
      const location = await resolveTourLocation(sub, {
        env: { TOUR_HOME: tourHomeFor(sub) },
      });
      expect(existsSync(join(location.tourStoreRoot, tour.id))).toBe(true);
      expect(location.repoRoot).toBe(realRepo);
      expect(existsSync(join(repo, ".tour"))).toBe(false);
      expect(existsSync(join(sub, ".tour"))).toBe(false);
    });

    it("list from a sub-directory finds tours created from the repo root", async () => {
      const cr = await run(["create", "--head", "HEAD", "--title", "from-root", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const sub = join(repo, "deep");
      await mkdir(sub, { recursive: true });
      const r = await run(["list", "--json"], sub);
      expect(r.exitCode).toBe(0);
      const tours = JSON.parse(r.stdout);
      expect(tours.map((t: { id: string }) => t.id)).toContain(tour.id);
    });

    it("show <unknown-id> reports the missing tour store path when no tours exist", async () => {
      const r = await run(["show", "ghost"], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("No tour store directory at");
      expect(r.stderr).toContain(tourHomeFor(repo));
    });

    it("show <unknown-id> keeps `No tour matching prefix` when the tour store exists", async () => {
      await run(["create", "--head", "HEAD", "--json"], repo);
      const r = await run(["show", "ghost"], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('No tour matching prefix "ghost"');
      expect(r.stderr).not.toContain("No tour store directory");
    });

    it("ignores a repo-root .tour/ without a migration nudge", async () => {
      await mkdir(join(repo, ".tour"), { recursive: true });
      const r = await run(["list"], repo);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe("");
    });
  });
});
