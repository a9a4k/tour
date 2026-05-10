import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import {
  createDispatchLogger,
  type DispatchLoggerHeader,
} from "../../src/core/dispatch-logger.js";

const baseHeader: DispatchLoggerHeader = {
  agent: "claude",
  triggeringId: "2026-05-10-143000-xyz1",
  tourId: "2026-05-08-104500-abcd",
  startedAt: "2026-05-10T14:30:00.123Z",
  pid: 12345,
  envelopeBytes: 4231,
  systemPromptBytes: 612,
};

async function loggerPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dispatch-logger-"));
  return join(dir, "logs", "reply-foo.log");
}

describe("createDispatchLogger", () => {
  let path: string;
  beforeEach(async () => {
    path = await loggerPath();
  });

  it("creates the parent directory lazily and writes the meta header + separator", async () => {
    expect(existsSync(path)).toBe(false);
    const logger = await createDispatchLogger(path, baseHeader);
    await logger.finalize({ code: 0, signal: null, durationMs: 100 });
    const content = await readFile(path, "utf8");
    expect(content).toBe(
      [
        "=== reply-agent: claude",
        "=== triggering: 2026-05-10-143000-xyz1",
        "=== tour: 2026-05-08-104500-abcd",
        "=== started_at: 2026-05-10T14:30:00.123Z",
        "=== pid: 12345",
        "=== envelope-bytes: 4231",
        "=== system-prompt-bytes: 612",
        "---",
        "=== exit: code=0 signal=null duration_ms=100",
        "",
      ].join("\n"),
    );
  });

  it("prefixes complete stdout / stderr lines with OUT: / ERR: in arrival order", async () => {
    const logger = await createDispatchLogger(path, baseHeader);
    await logger.onStdout("first stdout line\n");
    await logger.onStderr("first stderr line\n");
    await logger.onStdout("second stdout line\n");
    await logger.finalize({ code: 0, signal: null, durationMs: 42 });
    const content = await readFile(path, "utf8");
    const body = content.split("---\n")[1];
    expect(body).toBe(
      [
        "OUT: first stdout line",
        "ERR: first stderr line",
        "OUT: second stdout line",
        "=== exit: code=0 signal=null duration_ms=42",
        "",
      ].join("\n"),
    );
  });

  it("buffers per-stream partial lines across chunks and never produces a corrupt interleave at chunk boundaries", async () => {
    const logger = await createDispatchLogger(path, baseHeader);
    // stdout chunk ending mid-line, then a stderr chunk on the OTHER stream.
    await logger.onStdout("half-a-line");
    await logger.onStderr("other-stream\n");
    // Now finish the stdout line.
    await logger.onStdout("-completed\n");
    await logger.finalize({ code: 0, signal: null, durationMs: 1 });
    const content = await readFile(path, "utf8");
    const body = content.split("---\n")[1];
    expect(body).toBe(
      [
        "ERR: other-stream",
        "OUT: half-a-line-completed",
        "=== exit: code=0 signal=null duration_ms=1",
        "",
      ].join("\n"),
    );
  });

  it("flushes trailing partial lines (no terminating newline) on finalize", async () => {
    const logger = await createDispatchLogger(path, baseHeader);
    await logger.onStdout("trailing stdout no-newline");
    await logger.onStderr("trailing stderr no-newline");
    await logger.finalize({ code: 0, signal: null, durationMs: 1 });
    const content = await readFile(path, "utf8");
    const body = content.split("---\n")[1];
    // Trailing partials flush in deterministic order: stdout then stderr.
    expect(body).toBe(
      [
        "OUT: trailing stdout no-newline",
        "ERR: trailing stderr no-newline",
        "=== exit: code=0 signal=null duration_ms=1",
        "",
      ].join("\n"),
    );
  });

  it("keeps prefix-collision content strictly after the OUT: / ERR: prefix", async () => {
    const logger = await createDispatchLogger(path, baseHeader);
    await logger.onStdout("=== fake header\n");
    await logger.onStderr("OUT: pretending to be stdout\nERR: pretending to be stderr\n");
    await logger.finalize({ code: 0, signal: null, durationMs: 1 });
    const content = await readFile(path, "utf8");
    const body = content.split("---\n")[1];
    expect(body).toBe(
      [
        "OUT: === fake header",
        "ERR: OUT: pretending to be stdout",
        "ERR: ERR: pretending to be stderr",
        "=== exit: code=0 signal=null duration_ms=1",
        "",
      ].join("\n"),
    );
  });

  it("includes the signal name when the child was killed by a signal", async () => {
    const logger = await createDispatchLogger(path, baseHeader);
    await logger.finalize({
      code: null,
      signal: "SIGTERM",
      durationMs: 12,
    });
    const content = await readFile(path, "utf8");
    expect(content).toContain(
      "=== exit: code=null signal=SIGTERM duration_ms=12",
    );
  });

  it("captures spawn errors in the exit footer", async () => {
    const logger = await createDispatchLogger(path, baseHeader);
    await logger.finalize({
      code: null,
      signal: null,
      durationMs: 5,
      error: new Error("spawn ENOENT"),
    });
    const content = await readFile(path, "utf8");
    expect(content).toContain("=== error: spawn ENOENT");
    expect(content).toContain("=== exit: code=null signal=null duration_ms=5");
  });

  it("opens in append mode and prepends a Run-started delimiter on second run", async () => {
    const first = await createDispatchLogger(path, baseHeader);
    await first.onStdout("first run output\n");
    await first.finalize({ code: 0, signal: null, durationMs: 1 });

    const secondHeader: DispatchLoggerHeader = {
      ...baseHeader,
      startedAt: "2026-05-10T15:00:00.000Z",
      pid: 99999,
    };
    const second = await createDispatchLogger(path, secondHeader);
    await second.onStdout("second run output\n");
    await second.finalize({ code: 0, signal: null, durationMs: 2 });

    const content = await readFile(path, "utf8");
    // First run preserved verbatim.
    expect(content).toContain("OUT: first run output");
    expect(content).toContain("=== pid: 12345");
    // Delimiter precedes second run's header.
    expect(content).toMatch(
      /=== exit: code=0 signal=null duration_ms=1\n--- Run started: 2026-05-10T15:00:00\.000Z ---\n=== reply-agent: claude/,
    );
    expect(content).toContain("=== pid: 99999");
    expect(content).toContain("OUT: second run output");
  });
});
