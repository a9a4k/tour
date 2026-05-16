import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
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
      const comments = JSON.parse(result.stdout);
      expect(comments).toHaveLength(1);
      expect(comments[0].replies_to).toBe(root.id);
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
      // Top-level (no `replies_to`) — the on-disk shape never carried a
      // `kind` field; the discriminator is presence/absence of `replies_to`.
      expect(ann.replies_to).toBeUndefined();
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

  // Issue #369. The store lives at the repo root, not at `process.cwd()`,
  // so any two shells in the same repo see the same tours regardless of
  // their sub-directory cwd.
  describe("tour root resolution (issue #369)", () => {
    // Tests are invoked via a sub-process and `bun src/main.ts`; on macOS
    // /tmp resolves through /private/var, so the repo path the bun cwd
    // observes is realpath-normalised. Match that here when asserting.
    // Issue #365 / #368.
    let realRepo: string;
    beforeEach(async () => {
      realRepo = await realpath(repo);
    });

    it("writes .tour/ at the git root when create runs from a sub-directory", async () => {
      const sub = join(repo, "deep", "nested");
      await mkdir(sub, { recursive: true });
      const cr = await run(["create", "--head", "HEAD", "--json"], sub);
      expect(cr.exitCode).toBe(0);
      const tour = JSON.parse(cr.stdout);
      // The tour folder lives at <repo>/.tour/, not <sub>/.tour/.
      expect(existsSync(join(repo, ".tour", tour.id))).toBe(true);
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

    it("show <unknown-id> reports `No .tour/ directory at <root>` when no tours exist", async () => {
      const r = await run(["show", "ghost"], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("No .tour/ directory at");
      expect(r.stderr).toContain(realRepo);
    });

    it("show <unknown-id> keeps `No tour matching prefix` when .tour/ exists", async () => {
      await run(["create", "--head", "HEAD", "--json"], repo);
      const r = await run(["show", "ghost"], repo);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('No tour matching prefix "ghost"');
      expect(r.stderr).not.toContain("No .tour/ directory");
    });

    it("warns about stray sub-directory .tour/ found below the resolved root", async () => {
      const stale = join(repo, "src");
      await mkdir(join(stale, ".tour"), { recursive: true });
      const realStale = await realpath(stale);
      const r = await run(["list"], stale);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("stray .tour/");
      expect(r.stderr).toContain(join(realStale, ".tour"));
    });
  });
});
