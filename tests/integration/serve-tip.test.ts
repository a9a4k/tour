import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/main.ts");

// Spawn bun via its absolute path so the child's PATH can be tightly
// controlled — overriding PATH with just a stub dir would otherwise hide
// bun itself from the spawn's executable lookup.
async function resolveBunPath(): Promise<string> {
  const { stdout } = await execP("which", ["bun"]);
  return stdout.trimEnd();
}

// Integration coverage for the reply-agent discovery tip (issue #174).
// Spawn `tour serve` with a controlled PATH that contains synthetic stubs
// for the shipped agent names, so the tip emission can be asserted
// independently of whatever agents happen to be installed on the host.

async function gitCmd(args: string[], cwd: string): Promise<void> {
  await execP("git", args, { cwd });
}

async function createTempRepoWithTour(bunPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-tip-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "f.txt"), "a\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "init"], dir);
  await writeFile(join(dir, "f.txt"), "b\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "next"], dir);
  await execP(bunPath, [CLI, "create", "--head", "HEAD", "--json"], { cwd: dir });
  return dir;
}

async function makePathWithStubs(stubs: string[]): Promise<string> {
  const stubDir = await mkdtemp(join(tmpdir(), "tour-stubs-"));
  for (const name of stubs) {
    const p = join(stubDir, name);
    await writeFile(p, "#!/bin/sh\nexit 0\n");
    await chmod(p, 0o755);
  }
  return stubDir;
}

interface SpawnResult {
  stdout: string;
  proc: ChildProcess;
}

function spawnServeUntilReady(
  bunPath: string,
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  port: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bunPath, [CLI, "serve", "--port", String(port), ...args], {
      cwd,
      env,
    });
    let stdout = "";
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve({ stdout, proc });
    };
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      // Give the server a brief moment after the "running" line so the tip
      // (printed immediately after) lands in the buffer too.
      if (stdout.includes("Tour server")) {
        setTimeout(finish, 100);
      }
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!done) reject(new Error(`serve exited early code=${code}\n${stdout}`));
    });
  });
}

function killProc(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
  });
}

describe("tour serve — reply-agent discovery tip (issue #174)", () => {
  let dir: string;
  let bunPath: string;
  let activeProc: ChildProcess | null = null;
  const basePort = 19500;

  beforeAll(async () => {
    bunPath = await resolveBunPath();
    dir = await createTempRepoWithTour(bunPath);
  }, 30000);

  afterEach(async () => {
    if (activeProc) {
      await killProc(activeProc);
      activeProc = null;
    }
  });

  it("emits a tip when exactly one shipped agent is on PATH", async () => {
    const stubDir = await makePathWithStubs(["claude"]);
    const port = basePort + Math.floor(Math.random() * 200);
    const result = await spawnServeUntilReady(bunPath, dir, [], { PATH: stubDir }, port);
    activeProc = result.proc;
    expect(result.stdout).toContain("Tip: detected 'claude' on PATH");
    expect(result.stdout).toContain("--reply-agent claude");
  }, 30000);

  it("is silent when zero shipped agents are on PATH", async () => {
    const stubDir = await makePathWithStubs([]);
    const port = basePort + 300 + Math.floor(Math.random() * 200);
    const result = await spawnServeUntilReady(bunPath, dir, [], { PATH: stubDir }, port);
    activeProc = result.proc;
    expect(result.stdout).not.toContain("Tip:");
  }, 30000);

  it("is silent when multiple shipped agents are on PATH", async () => {
    const stubDir = await makePathWithStubs(["claude", "codex"]);
    const port = basePort + 600 + Math.floor(Math.random() * 200);
    const result = await spawnServeUntilReady(bunPath, dir, [], { PATH: stubDir }, port);
    activeProc = result.proc;
    expect(result.stdout).not.toContain("Tip:");
  }, 30000);

  it("is silent when --reply-agent is explicitly passed", async () => {
    const stubDir = await makePathWithStubs(["claude"]);
    const port = basePort + 900 + Math.floor(Math.random() * 200);
    const result = await spawnServeUntilReady(
      bunPath,
      dir,
      ["--reply-agent", "claude"],
      { PATH: stubDir },
      port,
    );
    activeProc = result.proc;
    expect(result.stdout).not.toContain("Tip:");
  }, 30000);
});
