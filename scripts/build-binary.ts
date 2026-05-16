#!/usr/bin/env bun
// Build a single platform binary with the package.json version baked in.
// Usage: bun scripts/build-binary.ts <bun-target> <outfile>
//
// Two-stage build so the binary can serve the webapp:
//  1. Pre-bundle the webapp client (Bun.build can't run inside the
//     compiled binary — /$bunfs/ has no real directory listings) and
//     write the bundle string into src/web/embedded-client.ts.
//  2. Run `bun build --compile` so it inlines/embeds the bundle.
//  3. Restore the committed stub so the working tree isn't left dirty.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EMBED_PATH = resolve(ROOT, "src/web/embedded-client.ts");

const [target, outfile] = process.argv.slice(2);
if (!target || !outfile) {
  console.error("Usage: bun scripts/build-binary.ts <bun-target> <outfile>");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version: string = pkg.version;

// Snapshot the committed stub so we can restore it after compile regardless
// of whether the user has a clean working tree. The embedded-client.ts
// snapshot captures EMBEDDED_BUILD_MODE: "dev" together with the empty
// bundle string — both fields restore atomically so an interrupted build
// can never leave the working tree with `mode: "binary"` + empty string
// (or vice versa) (issue #204).
const embedStub = readFileSync(EMBED_PATH, "utf8");

let stubRestored = false;
function restoreStub(): void {
  if (stubRestored) return;
  stubRestored = true;
  writeFileSync(EMBED_PATH, embedStub);
}

// Defence-in-depth: a Ctrl-C / kill targeting build-binary.ts itself
// (rather than the spawned `bun build --compile` child) would otherwise
// exit without firing the `child.on("exit")` restore. Hook every signal
// path Node exposes so the working tree never lingers in the half-flipped
// "populated string + mode binary" state described in issue #204.
process.on("SIGINT", () => {
  restoreStub();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restoreStub();
  process.exit(143);
});
process.on("uncaughtException", (err) => {
  restoreStub();
  console.error(err);
  process.exit(1);
});

const preBuild = spawnSync("bun", ["scripts/build-client.ts"], { cwd: ROOT, stdio: "inherit" });
if (preBuild.status !== 0) {
  restoreStub();
  process.exit(preBuild.status ?? 1);
}

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
];

console.log(`bun ${args.join(" ")}`);

const child = spawn("bun", args, { cwd: ROOT, stdio: "inherit" });
child.on("exit", (code) => {
  // Always restore the stub so a build failure doesn't leave the working
  // tree full of pre-built artifacts.
  restoreStub();
  process.exit(code ?? 1);
});
