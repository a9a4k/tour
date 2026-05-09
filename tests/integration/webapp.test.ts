import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, type ChildProcess, exec } from "node:child_process";
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

async function createTempRepoWithTour(): Promise<{
  dir: string;
  tourId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "tour-web-"));
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
  const tour = JSON.parse(stdout);

  await execP(BUN, [
    CLI, "annotate", tour.id,
    "--file", "hello.txt",
    "--side", "additions",
    "--line", "1",
    "--body", "Test annotation",
    "--author", "test-agent",
  ], { cwd: dir });

  return { dir, tourId: tour.id };
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
  let tourId: string;
  let serverProcess: ChildProcess;
  const port = 10000 + Math.floor(Math.random() * 50000);
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    const setup = await createTempRepoWithTour();
    dir = setup.dir;
    tourId = setup.tourId;

    serverProcess = exec(`${BUN} ${CLI} serve --port ${port}`, { cwd: dir });
    await waitForServer(`${baseUrl}/api/tours`);
  }, 30000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  });

  it("GET /api/tours returns array of tours", async () => {
    const res = await fetch(`${baseUrl}/api/tours`);
    expect(res.status).toBe(200);
    const tours = await res.json();
    expect(Array.isArray(tours)).toBe(true);
    expect(tours.length).toBe(1);
    expect(tours[0].id).toBe(tourId);
    expect(tours[0].title).toBe("Web Test");
    expect(tours[0].status).toBe("open");
  });

  it("GET /api/tours/:id returns tour with diff and annotations", async () => {
    const res = await fetch(`${baseUrl}/api/tours/${tourId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toBe(tourId);
    expect(data.snapshotLost).toBe(false);
    expect(typeof data.diff).toBe("string");
    expect((data.diff as string).length).toBeGreaterThan(0);
    expect(Array.isArray(data.annotations)).toBe(true);
    expect((data.annotations as unknown[]).length).toBe(1);
    expect(data.diffModel).toBeDefined();
  });

  it("GET /api/tours/:id with prefix returns tour", async () => {
    const prefix = tourId.slice(0, 11);
    const res = await fetch(`${baseUrl}/api/tours/${prefix}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toBe(tourId);
  });

  it("GET /api/tours/:id with unknown id returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/tours/nonexistent`);
    expect(res.status).toBe(404);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toBeDefined();
  });

  it("GET / returns HTML with Tour title", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Tour");
  });

  it("binds to localhost only", async () => {
    const res = await fetch(`${baseUrl}/api/tours`);
    expect(res.status).toBe(200);
  });

  it("preserves a markdown annotation body verbatim through GET /api/tours/:id", async () => {
    const body = [
      "## Heading",
      "",
      "Paragraph with `inline` code.",
      "",
      "```ts",
      "const x: number = 1;",
      "```",
      "",
      "```mermaid",
      "flowchart TD",
      "  A-->B",
      "```",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
    ].join("\n");
    await execP(BUN, [
      CLI, "annotate", tourId,
      "--file", "hello.txt",
      "--side", "additions",
      "--line", "1",
      "--body", body,
      "--author", "test-agent",
    ], { cwd: dir });

    const res = await fetch(`${baseUrl}/api/tours/${tourId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as { annotations: { body: string }[] };
    const found = data.annotations.find((a) => a.body === body);
    expect(found).toBeDefined();
    expect(found!.body).toBe(body);
  });

  it("serves a /client.js bundle that builds successfully (markdown deps included)", async () => {
    const res = await fetch(`${baseUrl}/client.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js.length).toBeGreaterThan(0);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });

  it("SSE endpoint connects and receives events on annotation change", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/tours/${tourId}/events`, {
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
      CLI, "annotate", tourId,
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
