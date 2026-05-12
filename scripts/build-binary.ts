#!/usr/bin/env bun
// Build a single platform binary with the package.json version baked in.
// Usage: bun scripts/build-binary.ts <bun-target> <outfile>
//
// Two-stage build so the binary can serve the webapp and run the TUI
// syntax-highlight worker from /$bunfs/:
//  1. Pre-bundle the webapp client + pierre worker + opentui parser worker
//     (Bun.build can't run inside the compiled binary — /$bunfs/ has no
//     real directory listings) and write the bundle strings/files into
//     src/web/embedded-client.ts and src/tui/parser-worker-bundle.js.
//  2. Run `bun build --compile` so it inlines/embeds them.
//  3. Restore the committed stubs so the working tree isn't left dirty.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EMBED_PATH = resolve(ROOT, "src/web/embedded-client.ts");
const OTUI_WORKER_STUB_PATH = resolve(ROOT, "src/tui/parser-worker-bundle.js");

const [target, outfile] = process.argv.slice(2);
if (!target || !outfile) {
  console.error("Usage: bun scripts/build-binary.ts <bun-target> <outfile>");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version: string = pkg.version;

// Snapshot the committed stubs so we can restore them after compile
// regardless of whether the user has a clean working tree. The
// embedded-client.ts snapshot captures EMBEDDED_BUILD_MODE: "dev" together
// with the empty bundle strings — both fields restore atomically so an
// interrupted build can never leave the working tree with `mode: "binary"`
// + empty strings (or vice versa) (issue #204).
const embedStub = readFileSync(EMBED_PATH, "utf8");
const otuiWorkerStub = readFileSync(OTUI_WORKER_STUB_PATH, "utf8");

let stubsRestored = false;
function restoreStubs(): void {
  if (stubsRestored) return;
  stubsRestored = true;
  writeFileSync(EMBED_PATH, embedStub);
  writeFileSync(OTUI_WORKER_STUB_PATH, otuiWorkerStub);
}

// Defence-in-depth: a Ctrl-C / kill targeting build-binary.ts itself
// (rather than the spawned `bun build --compile` child) would otherwise
// exit without firing the `child.on("exit")` restore. Hook every signal
// path Node exposes so the working tree never lingers in the half-flipped
// "populated strings + mode binary" state described in issue #204.
process.on("SIGINT", () => {
  restoreStubs();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restoreStubs();
  process.exit(143);
});
process.on("uncaughtException", (err) => {
  restoreStubs();
  console.error(err);
  process.exit(1);
});

const preBuild = spawnSync("bun", ["scripts/build-client.ts"], { cwd: ROOT, stdio: "inherit" });
if (preBuild.status !== 0) {
  restoreStubs();
  process.exit(preBuild.status ?? 1);
}

// Pass the opentui parser worker as a SECOND entrypoint so bun --compile
// bundles it as a real worker (resolves web-tree-sitter, embeds the
// tree-sitter.wasm, etc.) and writes it to a known sibling path inside
// /$bunfs/root/. The TUI shim points opentui at that path via
// OTUI_TREE_SITTER_WORKER_PATH. We can't get bun's static analyser to
// trace opentui's own `new Worker(worker_path)` (variable across runtime
// branches), so injecting the entrypoint here is the only way.
const args = [
  "build",
  "--production",
  "--compile",
  "--minify",
  `--target=${target}`,
  `--define`,
  `__EMBEDDED_VERSION__=${JSON.stringify(version)}`,
  `--outfile=${outfile}`,
  "src/main.ts",
  "src/tui/parser-worker-bundle.js",
];

console.log(`bun ${args.join(" ")}`);

const child = spawn("bun", args, { cwd: ROOT, stdio: "inherit" });
child.on("exit", (code) => {
  // Always restore stubs so a build failure doesn't leave the working tree
  // full of pre-built artifacts.
  restoreStubs();
  process.exit(code ?? 1);
});
