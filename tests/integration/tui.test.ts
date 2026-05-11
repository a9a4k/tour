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

      // Wait for the TUI's first frame to contain the fixture filename
      // before sending 'q'. Opentui writes runs of same-style characters
      // contiguously, so `hello.txt` appears as a literal substring in
      // stdout once the sidebar's file list has rendered — which means
      // React committed and `useKeyboard` is wired. Then add a 200ms
      // grace period: under parallel-load CI, opentui's stdin event
      // loop can tick slightly later than the first frame flush; without
      // the gap, 'q' lands in the pipe buffer and gets discarded as the
      // reader starts mid-byte and immediately sees our subsequent EOF.
      // Also keep stdin open (no `.end()`) so EOF can't race the read.
      let stdoutAccum = "";
      let sentQ = false;
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdoutAccum += chunk.toString();
        if (!sentQ && stdoutAccum.includes("hello.txt")) {
          sentQ = true;
          setTimeout(() => child.stdin.write("q"), 200);
        }
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(
          `TUI hung; sentQ=${sentQ} stdout=${stdoutAccum.length}b stderr_tail: ${stderr.slice(-500)}`,
        ));
      }, 13000);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`TUI exited with code ${code}; stderr: ${stderr}`));
      });
    });
  }, 15000);
});
