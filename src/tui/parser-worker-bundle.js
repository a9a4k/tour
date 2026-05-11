// GENERATED stub. Replaced by scripts/build-binary.ts during the binary
// build with a copy of @opentui/core/parser.worker.js, which is then
// passed as a second `bun build --compile` entrypoint so bun bundles it
// as a real worker (resolving its web-tree-sitter dep and embedding
// tree-sitter.wasm). The TUI shim in src/tui/otui-worker-shim.ts points
// opentui at the resulting `/$bunfs/root/tui/parser-worker-bundle.js`
// via OTUI_TREE_SITTER_WORKER_PATH.
//
// In dev mode (`bun src/main.ts`) this stub is never executed: the shim
// detects it's running outside a compiled binary and lets opentui use its
// own URL-from-node_modules loader, which works because the real worker
// is reachable on disk.
throw new Error(
  "tour: src/tui/parser-worker-bundle.js stub should not be executed. " +
    "If you're seeing this in a compiled binary, the build-binary.ts " +
    "pre-bundle step failed.",
);
