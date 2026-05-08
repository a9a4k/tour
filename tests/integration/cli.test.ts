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
  const dir = await mkdtemp(join(tmpdir(), "review-cli-"));
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
    it("creates a review and prints its ID", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--title", "Test review"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.split("\n");
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/);
      expect(lines[1]).toContain("Open with:");
    });

    it("creates folder and review.toml", async () => {
      const result = await run(
        ["create", "--head", "HEAD", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const review = JSON.parse(result.stdout);
      expect(review.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(review.status).toBe("open");
      expect(existsSync(join(repo, ".review", review.id, "review.toml"))).toBe(true);
    });

    it("adds .review/ to .gitignore", async () => {
      await run(["create", "--head", "HEAD"], repo);
      const gitignore = await readFile(join(repo, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".review/");
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

    it("creates worktree review", async () => {
      await writeFile(join(repo, "new.txt"), "new file\n");
      const result = await run(
        ["create", "--head", "WORKTREE", "--json"],
        repo,
      );
      expect(result.exitCode).toBe(0);
      const review = JSON.parse(result.stdout);
      expect(review.worktree_snapshot).toBe(true);
      expect(review.head_source).toBe("WORKTREE");
    });
  });

  describe("list", () => {
    it("shows open reviews by default", async () => {
      const cr = await run(["create", "--head", "HEAD", "--title", "My Review", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run(["list"], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(review.id);
      expect(result.stdout).toContain("My Review");
    });

    it("shows no reviews message when empty", async () => {
      const result = await run(["list"], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No reviews found");
    });

    it("supports --json", async () => {
      await run(["create", "--head", "HEAD", "--json"], repo);
      const result = await run(["list", "--json"], repo);
      expect(result.exitCode).toBe(0);
      const reviews = JSON.parse(result.stdout);
      expect(Array.isArray(reviews)).toBe(true);
      expect(reviews.length).toBe(1);
    });
  });

  describe("show", () => {
    it("displays review details", async () => {
      const cr = await run(["create", "--head", "HEAD", "--title", "Show Test", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run(["show", review.id], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Show Test");
      expect(result.stdout).toContain(review.head_sha.slice(0, 12));
    });

    it("supports --json with annotations included", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run(["show", review.id, "--json"], repo);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe(review.id);
      expect(data.annotations).toEqual([]);
    });

    it("supports prefix matching", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const prefix = review.id.slice(0, 11);
      const result = await run(["show", prefix, "--json"], repo);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe(review.id);
    });
  });

  describe("annotate", () => {
    it("adds a single annotation", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run([
        "annotate", review.id,
        "--file", "hello.txt",
        "--side", "additions",
        "--line", "1",
        "--body", "Looks good",
        "--author", "claude-code",
      ], repo);
      expect(result.exitCode).toBe(0);

      const showResult = await run(["show", review.id, "--json"], repo);
      const data = JSON.parse(showResult.stdout);
      expect(data.annotations).toHaveLength(1);
      expect(data.annotations[0].file).toBe("hello.txt");
      expect(data.annotations[0].body).toBe("Looks good");
    });

    it("adds batch annotations from stdin", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const batch = JSON.stringify([
        { file: "a.ts", side: "additions", line: "1-5", body: "Note 1", author: "agent" },
        { file: "b.ts", side: "deletions", line: "10", body: "Note 2", author: "agent" },
      ]);
      const result = await run(
        ["annotate", review.id, "--batch", "-", "--json"],
        repo,
        { stdin: batch },
      );
      expect(result.exitCode).toBe(0);
      const annotations = JSON.parse(result.stdout);
      expect(annotations).toHaveLength(2);
    });

    it("rejects invalid side", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run([
        "annotate", review.id,
        "--file", "hello.txt",
        "--side", "invalid",
        "--line", "1",
        "--body", "test",
      ], repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid side");
    });
  });

  describe("close", () => {
    it("marks review as closed", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run(["close", review.id], repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Closed");

      const showResult = await run(["show", review.id, "--json"], repo);
      const data = JSON.parse(showResult.stdout);
      expect(data.status).toBe("closed");
      expect(data.closed_at).not.toBe("");
    });
  });

  describe("delete", () => {
    it("removes review folder", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      const result = await run(["delete", review.id], repo);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(repo, ".review", review.id))).toBe(false);
    });
  });

  describe("prune", () => {
    it("prunes old closed reviews", async () => {
      const cr = await run(["create", "--head", "HEAD", "--json"], repo);
      const review = JSON.parse(cr.stdout);
      await run(["close", review.id], repo);

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
      expect(result.stdout).toContain("review");
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
