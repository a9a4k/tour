// Dispatcher for the hidden `tour selftest-syntax` smoke verb. Kept here
// (next to other CLI surfaces) but defers all work to tui/selftest-runner
// via a lazy import so non-selftest commands don't pay @opentui/core's
// load cost. Same lazy-import pattern as src/cli/tui.ts and src/cli/serve.ts.

export async function selftestSyntax(): Promise<void> {
  // Static-string specifier so bun --compile traces the dynamic import
  // (per the lesson learned in 60c8dd8). Cast hides the path from tsc.
  const { run } = (await import("../tui/selftest-runner.js" as string)) as {
    run: () => Promise<number>;
  };
  process.exit(await run());
}
