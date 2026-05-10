import { mkdir, appendFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

// Per-dispatch reply-agent log writer (ADR 0014). Captures the inner CLI's
// stdout / stderr interleaved by arrival order with `OUT: ` / `ERR: `
// prefixes, bracketed by a meta header and an exit footer. Append-as-you-go
// so a SIGKILL'd renderer preserves the trail up to the kill point and
// `tail -f` works out of the box.
//
// Pure of the spawn machinery — accepts a path + header fields, returns
// callbacks for stdout / stderr chunks and a finalize function. Unit-
// testable without spawning a child process.

export interface DispatchLoggerHeader {
  agent: string;
  triggeringId: string;
  tourId: string;
  startedAt: string;
  pid: number;
  envelopeBytes: number;
  systemPromptBytes: number;
}

export interface DispatchLoggerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  error?: Error;
}

export interface DispatchLogger {
  onStdout: (chunk: string) => Promise<void>;
  onStderr: (chunk: string) => Promise<void>;
  finalize: (exit: DispatchLoggerExit) => Promise<void>;
}

export async function createDispatchLogger(
  path: string,
  header: DispatchLoggerHeader,
): Promise<DispatchLogger> {
  await mkdir(dirname(path), { recursive: true });

  // Append-mode + run-started delimiter when the file already has content
  // guards against silent overwrite if a future bug double-fires the same
  // triggering id (today's runner's `seen` set prevents this within a
  // process, but the file-open flag is the load-bearing part).
  let existingSize = 0;
  try {
    existingSize = (await stat(path)).size;
  } catch {
    existingSize = 0;
  }
  const opener =
    (existingSize > 0
      ? `--- Run started: ${header.startedAt} ---\n`
      : "") +
    formatHeader(header) +
    "---\n";

  // All writes serialise through a single chained promise so chunks land in
  // arrival order even when callers don't await individually.
  let chain: Promise<void> = appendFile(path, opener);

  let stdoutBuf = "";
  let stderrBuf = "";

  const flushStream = (
    prefix: "OUT" | "ERR",
    chunk: string,
    bufKind: "stdout" | "stderr",
  ): Promise<void> => {
    chain = chain.then(async () => {
      const buf = bufKind === "stdout" ? stdoutBuf : stderrBuf;
      const combined = buf + chunk;
      const lastNl = combined.lastIndexOf("\n");
      if (lastNl === -1) {
        if (bufKind === "stdout") stdoutBuf = combined;
        else stderrBuf = combined;
        return;
      }
      const complete = combined.slice(0, lastNl);
      const trailing = combined.slice(lastNl + 1);
      if (bufKind === "stdout") stdoutBuf = trailing;
      else stderrBuf = trailing;
      const lines = complete.split("\n");
      let out = "";
      for (const l of lines) out += `${prefix}: ${l}\n`;
      await appendFile(path, out);
    });
    return chain;
  };

  return {
    onStdout: (chunk) => flushStream("OUT", chunk, "stdout"),
    onStderr: (chunk) => flushStream("ERR", chunk, "stderr"),
    finalize: (exit) => {
      chain = chain.then(async () => {
        let trail = "";
        // Trailing partials (no terminating newline) flush deterministically:
        // stdout first, then stderr, then the exit footer.
        if (stdoutBuf.length > 0) trail += `OUT: ${stdoutBuf}\n`;
        if (stderrBuf.length > 0) trail += `ERR: ${stderrBuf}\n`;
        stdoutBuf = "";
        stderrBuf = "";
        if (exit.error) {
          trail += `=== error: ${exit.error.message}\n`;
        }
        const sig = exit.signal === null ? "null" : exit.signal;
        trail += `=== exit: code=${exit.code} signal=${sig} duration_ms=${exit.durationMs}\n`;
        await appendFile(path, trail);
      });
      return chain;
    },
  };
}

function formatHeader(h: DispatchLoggerHeader): string {
  return [
    `=== reply-agent: ${h.agent}`,
    `=== triggering: ${h.triggeringId}`,
    `=== tour: ${h.tourId}`,
    `=== started_at: ${h.startedAt}`,
    `=== pid: ${h.pid}`,
    `=== envelope-bytes: ${h.envelopeBytes}`,
    `=== system-prompt-bytes: ${h.systemPromptBytes}`,
    "",
  ].join("\n");
}
