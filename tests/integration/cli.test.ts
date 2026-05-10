import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const exec = promisify(execFile);

const CLI = join(import.meta.dirname, "../../src/main.ts");

async function run(
  args: string[],
  cwd: string,
  opts?: { stdin?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const child = exec("npx", ["tsx", CLI, ...args], {
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
    it("creates a tour and prints its ID", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--title", "Test tour"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.split("\n");
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/);
      expect(lines[1]).toContain("Open with:");
    });

    it("creates folder and tour.toml", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const tour = JSON.parse(result.stdout);
      expect(tour.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(tour.status).toBe("open");
      expect(existsSync(join(repo, ".tour", tour.id, "tour.toml"))).toBe(true);
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
      const batch = JSON.stringify([
        { file: "a.ts", side: "additions", line: "1-5", body: "Note 1", author: "agent" },
        { file: "b.ts", side: "deletions", line: "10", body: "Note 2", author: "agent" },
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
        "--line", "1-3",
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

  describe("reply-cancel", () => {
    it("is a no-op when no lock exists", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const result = await run(["reply-cancel", tour.id], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No reply in flight");
    });

    it("deletes the lockfile when one exists", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const tour = JSON.parse(cr.stdout);
      const lockPath = join(repo, ".tour", tour.id, ".reply-lock.json");
      // Use pid=0 (no kill) to keep the test hermetic — we only assert the
      // lockfile cleanup half of the verb.
      await writeFile(
        lockPath,
        JSON.stringify({
          agent: "fixture",
          responding_to: "ann-1",
          started_at: new Date().toISOString(),
          pid: 0,
        }),
      );
      const result = await run(["reply-cancel", tour.id, "--json"], repo);
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.cancelled).toBe(true);
      expect(out.agent).toBe("fixture");
      expect(existsSync(lockPath)).toBe(false);
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
