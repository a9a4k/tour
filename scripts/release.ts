#!/usr/bin/env bun
// Release helper: bump package.json, refresh lockfile, commit, tag.
//
// Usage:  bun scripts/release.ts <version>           # e.g. 0.1.4
//         bun scripts/release.ts <version> --push    # also push commit + tag
//
// Refuses to run with a dirty working tree, on a non-default branch,
// or if the tag already exists.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const args = process.argv.slice(2);
const version = args[0];
const push = args.includes("--push");

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: bun scripts/release.ts <version> [--push]");
  console.error("       version must be semver, e.g. 0.1.4 or 1.0.0-rc.1");
  process.exit(1);
}

const tag = `v${version}`;

async function sh(cmd: string[], opts: { capture?: boolean } = {}): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const out = opts.capture ? await new Response(proc.stdout).text() : "";
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`command failed (${code}): ${cmd.join(" ")}`);
    process.exit(code);
  }
  return out.trim();
}

const status = await sh(["git", "status", "--porcelain"], { capture: true });
if (status) {
  console.error("working tree is dirty — commit or stash before releasing:");
  console.error(status);
  process.exit(1);
}

const branch = await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
if (branch !== "main") {
  console.error(`releases must be cut from main; currently on ${branch}`);
  process.exit(1);
}

const tagExists = await sh(["git", "tag", "--list", tag], { capture: true });
if (tagExists) {
  console.error(`tag ${tag} already exists; pick a new version`);
  process.exit(1);
}

const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(await Bun.file(pkgPath).text());
const previous = pkg.version;
pkg.version = version;
for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
  pkg.optionalDependencies[dep] = version;
}
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`bumped ${previous} → ${version}`);

await sh(["bun", "install"]);

await sh(["git", "add", "package.json", "bun.lock"]);
await sh(["git", "commit", "-m", `release: bump to ${version}`]);
await sh(["git", "tag", tag]);
console.log(`committed and tagged ${tag}`);

if (push) {
  await sh(["git", "push", "origin", "main"]);
  await sh(["git", "push", "origin", tag]);
  console.log(`pushed main and ${tag} — release pipeline will fire shortly`);
} else {
  console.log("");
  console.log("next:");
  console.log("  git push origin main");
  console.log(`  git push origin ${tag}`);
  console.log("(or rerun with --push)");
}
