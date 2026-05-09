#!/usr/bin/env bun
// Assemble per-platform npm sub-packages into dist/packages/<name>/.
// Reads each prebuilt binary from dist/binaries/<target>/ and writes a
// minimal package.json next to it. Run after `bun run build:all`.

import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PARENT_PKG = JSON.parse(await Bun.file(join(ROOT, "package.json")).text());
const VERSION: string = PARENT_PKG.version;

const TARGETS = [
  { os: "darwin",  cpu: "arm64", binary: "tour"     },
  { os: "darwin",  cpu: "x64",   binary: "tour"     },
  { os: "linux",   cpu: "arm64", binary: "tour"     },
  { os: "linux",   cpu: "x64",   binary: "tour"     },
  { os: "windows", cpu: "x64",   binary: "tour.exe" },
];

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

for (const t of TARGETS) {
  const pkgName = `tourdiff-${t.os}-${t.cpu}`;
  const srcBin = join(ROOT, "dist", "binaries", `${t.os}-${t.cpu}`, t.binary);
  const outDir = join(ROOT, "dist", "packages", pkgName);
  const outBin = join(outDir, t.binary);

  if (!(await exists(srcBin))) {
    console.error(`missing binary: ${srcBin}`);
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  await copyFile(srcBin, outBin);

  const subPkg = {
    name: pkgName,
    version: VERSION,
    description: `Prebuilt tour binary for ${t.os}-${t.cpu}.`,
    license: "MIT",
    repository: "git+https://github.com/a9a4k/tour.git",
    os: [t.os === "windows" ? "win32" : t.os],
    cpu: [t.cpu],
    files: [t.binary],
  };

  await writeFile(join(outDir, "package.json"), JSON.stringify(subPkg, null, 2) + "\n");
  console.log(`assembled ${pkgName}`);
}

console.log(`assembled ${TARGETS.length} sub-packages at version ${VERSION}`);
