// Bun --compile can't statically trace @opentui/core's `new Worker(worker_path)`
// (the URL is held in a variable across runtime branches in client.ts
// startWorker), so the worker file and its `web-tree-sitter` dependency
// don't get bundled into the shipped binary — and syntax highlighting
// silently fails on TS/TSX/JS/MD diffs.
//
// Fix:
//  1. scripts/build-client.ts copies @opentui/core/parser.worker.js into
//     src/tui/parser-worker-bundle.js (overwriting the committed stub).
//  2. scripts/build-binary.ts passes that file as a SECOND entrypoint to
//     `bun build --compile`, so bun bundles it as a real worker — resolving
//     web-tree-sitter, embedding tree-sitter.wasm, etc. — and writes it to
//     `/$bunfs/root/parser-worker-bundle.js` inside the executable.
//  3. This module redirects opentui's startWorker at that bunfs path via
//     OTUI_TREE_SITTER_WORKER_PATH.
//
// Same class of fix as 60c8dd8 (TUI/web modules) and a58e5e6 (pierre
// worker), but uses bun's multi-entrypoint --compile mechanism because
// the parser worker must be a real spawnable file with all deps resolved
// and `new Worker(new URL(...))` auto-bundling is not honoured by
// `bun build --compile`.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// In the compiled binary, bun inlines this module into the main entrypoint
// and `import.meta.url` resolves to `file:///$bunfs/root/<binary-name>`.
// In dev mode it's the on-disk source path. Use this — not
// `process.execPath` — for compiled-mode detection: execPath returns the
// real on-disk path of the binary (e.g. `/private/tmp/tour`), not the
// /$bunfs/ alias.
const here = dirname(fileURLToPath(import.meta.url));
const isCompiledBinary = here.includes("/$bunfs/") || /[\\/]~BUN[\\/]/i.test(here);

// Don't clobber an explicit user override — `OTUI_TREE_SITTER_WORKER_PATH`
// is a documented opentui escape hatch, and someone debugging worker
// issues with a custom build should be able to point at a different file.
if (isCompiledBinary && !process.env.OTUI_TREE_SITTER_WORKER_PATH) {
  // scripts/build-binary.ts passes `src/tui/parser-worker-bundle.js` as a
  // second `bun build --compile` entrypoint; bun strips the common `src/`
  // prefix and emits the worker at `/$bunfs/root/tui/parser-worker-bundle.js`
  // (sibling subdir of the main binary). Keep this path in sync with the
  // entrypoint declared in scripts/build-binary.ts.
  process.env.OTUI_TREE_SITTER_WORKER_PATH = resolve(
    here,
    "tui/parser-worker-bundle.js",
  );
}
