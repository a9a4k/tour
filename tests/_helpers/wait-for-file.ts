import { stat } from "node:fs/promises";

// Issue #370 — spawn integration tests previously used a fixed
// `setTimeout(50|100)` to wait for a detached fake-editor child to flush
// its argv log. Under CI load the wait expired before the shell `>>`
// redirection had closed the file, producing ENOENT or empty-log false
// negatives. This helper polls until the file reaches a non-empty state
// (or a caller-supplied minBytes) before the assertion proceeds.

export interface WaitForLogOptions {
  minBytes?: number;
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForLog(
  path: string,
  opts: WaitForLogOptions = {},
): Promise<void> {
  const minBytes = opts.minBytes ?? 1;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const intervalMs = opts.intervalMs ?? 20;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const s = await stat(path);
      if (s.size >= minBytes) return;
    } catch {
      // file not present yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForLog: ${path} never reached ${minBytes} bytes within ${timeoutMs}ms`,
  );
}
