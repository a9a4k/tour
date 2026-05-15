import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { waitForLog } from "./wait-for-file.js";

describe("waitForLog", () => {
  it("resolves once the file reaches minBytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wait-for-log-"));
    try {
      const p = join(dir, "log");
      // Write asynchronously after a small delay so the helper has to poll.
      setTimeout(() => {
        void appendFile(p, "x\n");
      }, 80);
      await waitForLog(p, { minBytes: 1, timeoutMs: 2000, intervalMs: 10 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns immediately if the file already meets minBytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wait-for-log-"));
    try {
      const p = join(dir, "log");
      await writeFile(p, "ready\n");
      const t0 = Date.now();
      await waitForLog(p, { minBytes: 1, timeoutMs: 2000, intervalMs: 50 });
      expect(Date.now() - t0).toBeLessThan(50);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear timeout error with the path and minBytes when nothing appears", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wait-for-log-"));
    try {
      const p = join(dir, "never");
      await expect(
        waitForLog(p, { minBytes: 1, timeoutMs: 100, intervalMs: 10 }),
      ).rejects.toThrow(/waitForLog: .*never never reached 1 bytes within 100ms/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
