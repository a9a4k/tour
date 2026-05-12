import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

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
  opts?: { stdin?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const child = exec("bun", [CLI, ...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
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

    it("creates folder and tour.toml (--json: structured to stdout, empty stderr)", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const tour = JSON.parse(result.stdout);
      expect(tour.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(tour.status).toBe("open");
      expect(existsSync(join(repo, ".tour", tour.id, "tour.toml"))).toBe(true);
      // --json suppresses the hint entirely — stderr is empty.
      expect(result.stderr).toBe("");
    });

    it("adds .tour/ to .gitignore", async () => {
      await run(["create", "--head", "HEAD"], repo);
      const gitignore = await readFile(join(repo, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".tour/");
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

      it("uses merge-base with upstream on a multi-commit branch", async () => {
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

        const expectedBase = await gitCmd(["merge-base", "HEAD@{upstream}", "HEAD"], repo);
        const result = await run(["create", "--head", "HEAD", "--json"], repo);
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.base_sha).toBe(expectedBase);
        expect(tour.base_source).toBe("merge-base(HEAD@{upstream})");
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

        const expectedBase = await gitCmd(["merge-base", "HEAD@{upstream}", "HEAD"], repo);
        const result = await run(["create", "--head", "WIP", "--json"], repo);
        expect(result.exitCode).toBe(0);
        const tour = JSON.parse(result.stdout);
        expect(tour.wip_snapshot).toBe(true);
        expect(tour.base_sha).toBe(expectedBase);
        expect(tour.base_source).toBe("merge-base(HEAD@{upstream})");
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

    it("supports --json with annotations included", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["show", tour.id, "--json"], repo);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe(tour.id);
      expect(data.annotations).toEqual([]);
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
  });

  describe("annotate", () => {
    it("adds a single annotation", async () => {
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
      expect(data.annotations).toHaveLength(1);
      expect(data.annotations[0].file).toBe("hello.txt");
      expect(data.annotations[0].body).toBe("Looks good");
    });

    it("adds batch annotations from stdin", async () => {
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
      const annotations = JSON.parse(result.stdout);
      expect(annotations).toHaveLength(2);
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
      const annotations = JSON.parse(result.stdout);
      expect(annotations).toHaveLength(2);
      expect(annotations[0].body).toBe("Note 1");
      expect(annotations[1].body).toBe("Note 2");
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
      const annotations = JSON.parse(result.stdout);
      expect(annotations).toHaveLength(2);
      expect(annotations[0].line_start).toBe(1);
      expect(annotations[0].line_end).toBe(1);
      expect(annotations[1].line_start).toBe(1);
      expect(annotations[1].line_end).toBe(1);
    });

    it("supports replies_to in JSONL --batch mode (issue #172)", async () => {
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
      const jsonl = `{"replies_to":"${root.id}","body":"reply via JSONL"}\n`;
      const result = await run(
        ["annotate", tour.id, "--batch", "-", "--json"],
        repo,
        { stdin: jsonl },
      );
      expect(result.exitCode).toBe(0);
      const annotations = JSON.parse(result.stdout);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].replies_to).toBe(root.id);
      expect(annotations[0].body).toBe("reply via JSONL");
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

    it("rejects annotation whose file is not in the Tour's diff (slice 4 / #144)", async () => {
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

    it("rejects annotation whose line_end exceeds the file's line count (slice 4 / #144)", async () => {
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
      expect(reply.replies_to).toBe(root.id);
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
      expect(tree.annotations).toHaveLength(1);
      expect(tree.annotations[0].id).toBe(root.id);
      expect(tree.annotations[0].body).toBe("initial review");
      expect(tree.annotations[0].replies).toHaveLength(1);
      expect(tree.annotations[0].replies[0].body).toBe("thanks");
      expect(tree.annotations[0].replies[0].author_kind).toBe("human");
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
      expect(tree.annotations).toEqual([]);
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
      const result = await run(["delete", tour.id], repo);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(repo, ".tour", tour.id))).toBe(false);
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
    });
  });

  describe("unknown command", () => {
    it("exits with error", async () => {
      const result = await run(["bogus"], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command");
    });
  });
});
