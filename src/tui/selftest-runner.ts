// Self-test: spawn opentui's tree-sitter worker and assert it returns
// highlight tokens for a TS snippet. Called from `tour selftest-syntax`
// during the release smoke gate so a worker that boots-but-returns-nothing
// (or a worker that errors AFTER opentui's TerminalConsole intercepts
// `console.error`) fails the build instead of shipping silently.
//
// Lives in src/tui/ (not src/cli/) and is lazy-imported by the dispatcher
// in src/cli/selftest.ts so non-selftest commands don't pay for
// @opentui/core's load cost. Same lazy-import pattern as
// cli/tui.ts → tui/app.tsx.

import "./otui-worker-shim.js";
import { getTreeSitterClient } from "@opentui/core";

const SAMPLE_TS = "function hello(name: string): string { return `Hi, ${name}!`; }";

export async function run(): Promise<number> {
  const client = getTreeSitterClient();
  client.on("error", (e: unknown) => {
    process.stderr.write(`[selftest-syntax] worker error: ${String(e)}\n`);
  });

  try {
    await client.initialize();
  } catch (e) {
    process.stderr.write(`[selftest-syntax] initialize failed: ${String(e)}\n`);
    return 1;
  }

  const result = (await client.highlightOnce(SAMPLE_TS, "typescript")) as {
    error?: string;
    highlights?: Array<unknown>;
  };

  if (result.error) {
    process.stderr.write(`[selftest-syntax] highlightOnce error: ${result.error}\n`);
    return 1;
  }
  if (!result.highlights || result.highlights.length === 0) {
    process.stderr.write(
      "[selftest-syntax] worker booted but returned 0 tokens for TS sample\n",
    );
    return 1;
  }

  process.stderr.write(`[selftest-syntax] ok: ${result.highlights.length} tokens\n`);
  return 0;
}
