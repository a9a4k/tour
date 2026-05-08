import { describe, it, beforeAll } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);

const BUN = "bun";
const CLI = join(import.meta.dirname, "../../src/main.ts");

async function gitCmd(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execP("git", args, { cwd });
  return stdout.trimEnd();
}

async function createTempRepoWithTour(): Promise<{ dir: string; tourId: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tour-tui-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "hello.txt"), "hello\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "initial"], dir);
  await writeFile(join(dir, "hello.txt"), "hello world\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "update"], dir);

  const { stdout } = await execP(BUN, [CLI, "create", "--head", "HEAD", "--title", "TUI Smoke", "--json"], { cwd: dir });
  const tour = JSON.parse(stdout);
  return { dir, tourId: tour.id };
}

describe("TUI integration", () => {
  let dir: string;
  let tourId: string;

  beforeAll(async () => {
    const setup = await createTempRepoWithTour();
    dir = setup.dir;
    tourId = setup.tourId;
  }, 30000);

  it("starts the TUI on a fixture tour and exits cleanly on 'q'", async () => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(BUN, [CLI, "tui", tourId], {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`TUI did not exit; stderr: ${stderr}`));
      }, 8000);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`TUI exited with code ${code}; stderr: ${stderr}`));
      });

      setTimeout(() => {
        child.stdin.write("q");
        child.stdin.end();
      }, 1500);
    });
  }, 15000);
});
