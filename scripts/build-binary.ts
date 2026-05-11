#!/usr/bin/env bun
// Build a single platform binary with the package.json version baked in.
// Usage: bun scripts/build-binary.ts <bun-target> <outfile>
//
// Two-stage build so the binary can serve the webapp from /$bunfs/:
//  1. Pre-bundle the client + pierre worker (Bun.build can't run inside the
//     compiled binary — /$bunfs/ has no real directory listings) and write
//     the bundle strings into src/web/embedded-client.ts.
//  2. Run `bun build --compile` so it inlines those strings.
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

// Snapshot the embed stub so we can restore it after compile regardless of
// whether the user has a clean working tree.
const embedStub = readFileSync(EMBED_PATH, "utf8");

const preBuild = spawnSync("bun", ["scripts/build-client.ts"], { cwd: ROOT, stdio: "inherit" });
if (preBuild.status !== 0) {
  writeFileSync(EMBED_PATH, embedStub);
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
  // Always restore the stub so a build failure doesn't leave the embed
  // module full of pre-built strings.
  writeFileSync(EMBED_PATH, embedStub);
  process.exit(code ?? 1);
});
