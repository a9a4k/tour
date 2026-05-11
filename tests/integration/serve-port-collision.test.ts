import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const BUN = "bun";
const CLI = join(import.meta.dirname, "../../src/main.ts");

async function gitCmd(args: string[], cwd: string): Promise<void> {
  await execP("git", args, { cwd });
}

async function createTempRepoWithTour(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-port-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "f.txt"), "a\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "init"], dir);
  await writeFile(join(dir, "f.txt"), "b\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "next"], dir);
  await execP(BUN, [CLI, "create", "--head", "HEAD", "--json"], { cwd: dir });
  return dir;
}

function bindBlocker(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeBlocker(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("tour serve — port collision", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await createTempRepoWithTour();
  }, 30000);

  // Real-world check that Bun.serve's EADDRINUSE error shape is what
  // isAddrInUseError recognises. The unit tests mock tryBind; this test
  // walks the full path: real Bun bind → real EADDRINUSE → our error.
  it("explicit --port exits non-zero with named-port error when busy", async () => {
    const port = 18000 + Math.floor(Math.random() * 40000);
    const blocker = await bindBlocker(port);
    try {
      const result = await execP(BUN, [CLI, "serve", "--port", String(port)], {
        cwd: dir,
      }).catch((err: { code: number; stderr: string }) => err);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`port ${port} is in use`);
    } finally {
      await closeBlocker(blocker);
    }
  });
});
