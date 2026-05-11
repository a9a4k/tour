#!/usr/bin/env bun
// Release helper: bump package.json, refresh lockfile, commit, tag.
//
// Usage:  bun scripts/release.ts <version>           # e.g. 0.1.4
//         bun scripts/release.ts <version> --push    # also push commit + tag
//
// Refuses to run if package.json or bun.lock have uncommitted changes,
// off the main branch, if the tag already exists, if the new version is
// not greater than the current version, or if typecheck/tests fail.
// Other dirty state (untracked files, modifications outside the release
// files) is allowed — the release commit only stages package.json and
// bun.lock.
//
// Pass --skip-checks to bypass typecheck + test (use sparingly).

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const args = process.argv.slice(2);
const version = args[0];
const push = args.includes("--push");
const skipChecks = args.includes("--skip-checks");

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: bun scripts/release.ts <version> [--push] [--skip-checks]");
  console.error("       version must be semver, e.g. 0.1.4 or 1.0.0-rc.1");
  process.exit(1);
}

const tag = `v${version}`;

async function sh(cmd: string[], opts: { capture?: boolean; allowFail?: boolean } = {}): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const out = opts.capture ? (await new Response(proc.stdout).text()).trim() : "";
  const code = await proc.exited;
  if (code !== 0 && !opts.allowFail) {
    console.error(`command failed (${code}): ${cmd.join(" ")}`);
    process.exit(code);
  }
  return { out, code };
}

const RELEASE_FILES = ["package.json", "bun.lock"];
const unstaged = await sh(["git", "diff", "--quiet", "--", ...RELEASE_FILES], { allowFail: true });
const staged = await sh(["git", "diff", "--cached", "--quiet", "--", ...RELEASE_FILES], { allowFail: true });
if (unstaged.code !== 0 || staged.code !== 0) {
  console.error(`refuse to release: ${RELEASE_FILES.join(" or ")} has uncommitted changes`);
  console.error("commit, stash, or revert those before bumping");
  process.exit(1);
}

const otherDirty = (await sh(["git", "status", "--porcelain"], { capture: true })).out;
if (otherDirty) {
  console.warn("note: working tree has other uncommitted changes (not included in release commit):");
  console.warn(otherDirty.split("\n").map(l => `  ${l}`).join("\n"));
}

const branch = (await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true })).out;
if (branch !== "main") {
  console.error(`releases must be cut from main; currently on ${branch}`);
  process.exit(1);
}

const tagExists = (await sh(["git", "tag", "--list", tag], { capture: true })).out;
if (tagExists) {
  console.error(`tag ${tag} already exists; pick a new version`);
  process.exit(1);
}

const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(await Bun.file(pkgPath).text());
const previous: string = pkg.version;

function compareMain(a: string, b: string): number {
  const [aMain] = a.split("-");
  const [bMain] = b.split("-");
  const ap = aMain.split(".").map(Number);
  const bp = bMain.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (ap[i] !== bp[i]) return ap[i] - bp[i];
  }
  return 0;
}

const cmp = compareMain(version, previous);
if (cmp < 0) {
  console.error(`refuse to release: ${version} is not greater than current ${previous}`);
  process.exit(1);
}
if (cmp === 0 && version !== previous) {
  console.warn(`note: ${version} has the same main version as ${previous} (prerelease iteration?)`);
}

if (!skipChecks) {
  console.log("running typecheck...");
  await sh(["bun", "run", "typecheck"]);
  console.log("running tests...");
  await sh(["bun", "run", "test"]);
  // Binary smoke: catches "ships fine in dev, dies in --compile" bugs
  // before a release tag goes out. CI runs the same check on linux-x64
  // for every PR, but failing here saves the cycle of pushing a bad
  // tag, watching it red, then needing another patch release.
  const archMap: Record<string, string> = { arm64: "arm64", x64: "x64" };
  const osMap: Record<string, string> = { darwin: "darwin", linux: "linux" };
  const hostArch = archMap[process.arch];
  const hostOs = osMap[process.platform];
  if (hostArch && hostOs) {
    const target = `${hostOs}-${hostArch}`;
    console.log(`building binary for ${target} and smoke-testing...`);
    await sh(["bun", "run", `build:${target}`]);
    await sh(["bash", "scripts/smoke-binary.sh", `dist/binaries/${target}/tour`]);
  } else {
    console.warn(`skipping binary smoke (unsupported host ${process.platform}-${process.arch})`);
  }
}

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
