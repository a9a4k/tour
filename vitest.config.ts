import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    // Several integration files spawn Bun subprocesses; unbounded worker
    // fan-out can exhaust memory in constrained CI/sandbox environments.
    maxWorkers: 2,
  },
  // The TUI source uses opentui's JSX intrinsics (`<box>`, `<text>`, ...) and
  // is loaded into vitest via esbuild. Default classic JSX expects `React` in
  // scope; switching to the automatic runtime (which `react/jsx-runtime`
  // ships) lets us call function components like `DiffLine` directly from
  // tests and inspect the returned element tree without React imports leaking
  // into every TUI source file.
  esbuild: {
    jsx: "automatic",
  },
});
