import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, type ChildProcess, exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);

const BUN = join(process.env.HOME ?? "", ".bun", "bin", "bun");
const CLI = join(import.meta.dirname, "../../src/main.ts");

async function gitCmd(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execP("git", args, { cwd });
  return stdout.trimEnd();
}

async function createTempRepoWithReview(): Promise<{
  dir: string;
  reviewId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "review-web-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "hello.txt"), "hello\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "initial"], dir);
  await writeFile(join(dir, "hello.txt"), "hello world\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "update"], dir);

  const { stdout } = await execP(BUN, [CLI, "create", "--head", "HEAD", "--title", "Web Test", "--json"], { cwd: dir });
  const review = JSON.parse(stdout);

  await execP(BUN, [
    CLI, "annotate", review.id,
    "--file", "hello.txt",
    "--side", "additions",
    "--line", "1",
    "--body", "Test annotation",
    "--author", "test-agent",
  ], { cwd: dir });

  return { dir, reviewId: review.id };
}

async function waitForServer(url: string, maxAttempts = 20): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Server not ready at ${url}`);
}

describe("Webapp integration", () => {
  let dir: string;
  let reviewId: string;
  let serverProcess: ChildProcess;
  const port = 10000 + Math.floor(Math.random() * 50000);
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    const setup = await createTempRepoWithReview();
    dir = setup.dir;
    reviewId = setup.reviewId;

    serverProcess = exec(`${BUN} ${CLI} serve --port ${port}`, { cwd: dir });
    await waitForServer(`${baseUrl}/api/reviews`);
  }, 30000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  });

  it("GET /api/reviews returns array of reviews", async () => {
    const res = await fetch(`${baseUrl}/api/reviews`);
    expect(res.status).toBe(200);
    const reviews = await res.json();
    expect(Array.isArray(reviews)).toBe(true);
    expect(reviews.length).toBe(1);
    expect(reviews[0].id).toBe(reviewId);
    expect(reviews[0].title).toBe("Web Test");
    expect(reviews[0].status).toBe("open");
  });

  it("GET /api/reviews/:id returns review with diff and annotations", async () => {
    const res = await fetch(`${baseUrl}/api/reviews/${reviewId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toBe(reviewId);
    expect(data.snapshotLost).toBe(false);
    expect(typeof data.diff).toBe("string");
    expect((data.diff as string).length).toBeGreaterThan(0);
    expect(Array.isArray(data.annotations)).toBe(true);
    expect((data.annotations as unknown[]).length).toBe(1);
    expect(data.diffModel).toBeDefined();
  });

  it("GET /api/reviews/:id with prefix returns review", async () => {
    const prefix = reviewId.slice(0, 11);
    const res = await fetch(`${baseUrl}/api/reviews/${prefix}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toBe(reviewId);
  });

  it("GET /api/reviews/:id with unknown id returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/reviews/nonexistent`);
    expect(res.status).toBe(404);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toBeDefined();
  });

  it("GET / returns HTML with Review title", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Review");
  });

  it("binds to localhost only", async () => {
    const res = await fetch(`${baseUrl}/api/reviews`);
    expect(res.status).toBe(200);
  });

  it("SSE endpoint connects and receives events on annotation change", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/reviews/${reviewId}/events`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const firstChunk = await reader.read();
    const firstData = decoder.decode(firstChunk.value);
    expect(firstData).toContain("connected");

    await execP(BUN, [
      CLI, "annotate", reviewId,
      "--file", "hello.txt",
      "--side", "additions",
      "--line", "1",
      "--body", "SSE test annotation",
      "--author", "test",
    ], { cwd: dir });

    const readWithTimeout = async (): Promise<string> => {
      return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("SSE timeout")), 3000);
        try {
          const chunk = await reader.read();
          clearTimeout(timeout);
          resolve(decoder.decode(chunk.value));
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
    };

    const eventData = await readWithTimeout();
    expect(eventData).toContain("annotation-changed");
    controller.abort();
  });
});
