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

interface StreamState {
  prefix: "OUT" | "ERR";
  buf: string;
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
    // First run for this triggering id — no existing file.
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

  const stdout: StreamState = { prefix: "OUT", buf: "" };
  const stderr: StreamState = { prefix: "ERR", buf: "" };

  const flush = (stream: StreamState, chunk: string): Promise<void> => {
    chain = chain.then(async () => {
      const combined = stream.buf + chunk;
      const lastNl = combined.lastIndexOf("\n");
      if (lastNl === -1) {
        stream.buf = combined;
        return;
      }
      stream.buf = combined.slice(lastNl + 1);
      const out = combined
        .slice(0, lastNl)
        .split("\n")
        .map((l) => `${stream.prefix}: ${l}\n`)
        .join("");
      await appendFile(path, out);
    });
    return chain;
  };

  return {
    onStdout: (chunk) => flush(stdout, chunk),
    onStderr: (chunk) => flush(stderr, chunk),
    finalize: (exit) => {
      chain = chain.then(async () => {
        let trail = "";
        // Trailing partials (no terminating newline) flush deterministically:
        // stdout first, then stderr, then the exit footer.
        if (stdout.buf.length > 0) trail += `OUT: ${stdout.buf}\n`;
        if (stderr.buf.length > 0) trail += `ERR: ${stderr.buf}\n`;
        stdout.buf = "";
        stderr.buf = "";
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
