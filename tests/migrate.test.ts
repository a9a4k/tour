import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse as parseTOML } from "smol-toml";
import { resolveTourLocation } from "../src/core/tour-location.js";

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, "../src/main.ts");

async function run(
  args: string[],
  cwd: string,
  tourHome: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec("bun", [CLI, ...args], {
      cwd,
      env: { ...process.env, TOUR_HOME: tourHome },
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

async function createRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "tour-migrate-repo-")));
  await git(["init", dir], dir);
  await git(["config", "user.email", "test@test.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "file.txt"), "one\n");
  await git(["add", "."], dir);
  await git(["commit", "-m", "initial"], dir);
  return dir;
}

async function writeLegacyTour(repo: string, id: string): Promise<void> {
  const dir = join(repo, ".tour", id);
  await mkdir(join(dir, "logs"), { recursive: true });
  await writeFile(
    join(dir, "tour.toml"),
    [
      `id = "${id}"`,
      'title = "Legacy tour"',
      'status = "open"',
      'created_at = "2026-05-20T00:00:00.000Z"',
      'closed_at = ""',
      `head_sha = "${"a".repeat(40)}"`,
      `base_sha = "${"b".repeat(40)}"`,
      'head_source = "HEAD"',
      'base_source = "HEAD^"',
      "wip_snapshot = false",
      "",
    ].join("\n"),
  );
  await writeFile(join(dir, "tour-events.jsonl"), "{}\n");
  await writeFile(join(dir, "logs", "reply.log"), "kept\n");
  await writeFile(join(dir, ".reply-lock.json"), '{"agent":"codex"}\n');
}

describe("tour migrate", () => {
  it("moves legacy tours into the repo-key store and stamps the current worktree", async () => {
    const repo = await createRepo();
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-migrate-home-")));
    await writeLegacyTour(repo, "2026-05-20-120000-aaaa");
    await writeLegacyTour(repo, "2026-05-20-120001-bbbb");
    await writeFile(join(repo, ".gitignore"), ".tour/\n");

    const location = await resolveTourLocation(repo, { env: { TOUR_HOME: tourHome } });
    const result = await run(["migrate", "--json"], repo, tourHome);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      migrated: ["2026-05-20-120000-aaaa", "2026-05-20-120001-bbbb"],
      gitignoreScrubbed: true,
      removedDir: true,
    });
    expect(existsSync(join(repo, ".tour"))).toBe(false);
    expect(await readFile(join(repo, ".gitignore"), "utf-8")).toBe("");

    for (const id of ["2026-05-20-120000-aaaa", "2026-05-20-120001-bbbb"]) {
      const migratedDir = join(location.tourStoreRoot, id);
      const tour = parseTOML(
        await readFile(join(migratedDir, "tour.toml"), "utf-8"),
      ) as { created_in_worktree?: string };
      expect(tour.created_in_worktree).toBe(location.worktreeStamp);
      expect(
        await readFile(join(migratedDir, "tour-events.jsonl"), "utf-8"),
      ).toBe("{}\n");
      expect(
        await readFile(join(migratedDir, "logs", "reply.log"), "utf-8"),
      ).toBe("kept\n");
      expect(
        await readFile(join(migratedDir, ".reply-lock.json"), "utf-8"),
      ).toBe('{"agent":"codex"}\n');
    }

    const rerun = await run(["migrate", "--json"], repo, tourHome);
    expect(rerun.exitCode).toBe(0);
    expect(JSON.parse(rerun.stdout)).toEqual({
      migrated: [],
      gitignoreScrubbed: false,
      removedDir: false,
    });
  });

  it("continues a partial migration and leaves mixed gitignore lines untouched", async () => {
    const repo = await createRepo();
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-migrate-home-")));
    await writeLegacyTour(repo, "2026-05-20-120001-bbbb");
    await writeFile(join(repo, ".gitignore"), ".tour/ dist/\n# keep .tour/\n");

    const location = await resolveTourLocation(repo, { env: { TOUR_HOME: tourHome } });
    await mkdir(join(location.tourStoreRoot, "2026-05-20-120000-aaaa"), {
      recursive: true,
    });

    const result = await run(["migrate", "--json"], repo, tourHome);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      migrated: ["2026-05-20-120001-bbbb"],
      gitignoreScrubbed: false,
      removedDir: true,
    });
    expect(await readFile(join(repo, ".gitignore"), "utf-8")).toBe(
      ".tour/ dist/\n# keep .tour/\n",
    );
    expect(
      existsSync(join(location.tourStoreRoot, "2026-05-20-120001-bbbb")),
    ).toBe(true);
  });

  it("fails on id collision without moving any legacy tours", async () => {
    const repo = await createRepo();
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-migrate-home-")));
    await writeLegacyTour(repo, "2026-05-20-120000-aaaa");
    await writeLegacyTour(repo, "2026-05-20-120001-bbbb");

    const location = await resolveTourLocation(repo, { env: { TOUR_HOME: tourHome } });
    await mkdir(join(location.tourStoreRoot, "2026-05-20-120000-aaaa"), {
      recursive: true,
    });
    await writeFile(
      join(location.tourStoreRoot, "2026-05-20-120000-aaaa", "tour.toml"),
      "id = \"kept\"\n",
    );

    const result = await run(["migrate", "--json"], repo, tourHome);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("2026-05-20-120000-aaaa");
    expect(result.stderr).toContain("already exists");
    expect(
      await readFile(
        join(location.tourStoreRoot, "2026-05-20-120000-aaaa", "tour.toml"),
        "utf-8",
      ),
    ).toBe('id = "kept"\n');
    expect(existsSync(join(repo, ".tour", "2026-05-20-120000-aaaa"))).toBe(true);
    expect(existsSync(join(repo, ".tour", "2026-05-20-120001-bbbb"))).toBe(true);
  });

  it("migrates legacy tours outside a git repo using the cwd fallback key", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tour-migrate-plain-")));
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-migrate-home-")));
    await writeLegacyTour(dir, "2026-05-20-120000-aaaa");

    const location = await resolveTourLocation(dir, { env: { TOUR_HOME: tourHome } });
    const result = await run(["migrate", "--json"], dir, tourHome);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      migrated: ["2026-05-20-120000-aaaa"],
      gitignoreScrubbed: false,
      removedDir: true,
    });
    const tour = parseTOML(
      await readFile(
        join(location.tourStoreRoot, "2026-05-20-120000-aaaa", "tour.toml"),
        "utf-8",
      ),
    ) as { created_in_worktree?: string };
    expect(tour.created_in_worktree).toBe(location.worktreeStamp);
    expect(location.worktreeStamp).toBe(dir);
  });
});
