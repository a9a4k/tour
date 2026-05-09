#!/usr/bin/env bun
// Build a single platform binary with the package.json version baked in.
// Usage: bun scripts/build-binary.ts <bun-target> <outfile>

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const [target, outfile] = process.argv.slice(2);
if (!target || !outfile) {
  console.error("Usage: bun scripts/build-binary.ts <bun-target> <outfile>");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version: string = pkg.version;

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
child.on("exit", (code) => process.exit(code ?? 1));
