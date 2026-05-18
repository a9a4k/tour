import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const manifestPath = ".agents/local-repos.json";
const examplePath = ".agents/local-repos.example.json";

type Manifest = {
  repos?: Record<string, string>;
};

function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

if (!existsSync(manifestPath)) {
  fail(
    [
      `Missing ${manifestPath}.`,
      `Copy ${examplePath} to ${manifestPath} and adjust paths for your machine.`,
    ].join("\n"),
  );
  process.exit();
}

let manifest: Manifest;

try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`Could not parse ${manifestPath}: ${detail}`);
  process.exit();
}

const repos = manifest.repos;

if (!repos || typeof repos !== "object" || Array.isArray(repos)) {
  fail(`${manifestPath} must contain a "repos" object.`);
  process.exit();
}

let checked = 0;

for (const [name, configuredPath] of Object.entries(repos)) {
  checked += 1;

  if (typeof configuredPath !== "string" || configuredPath.length === 0) {
    fail(`${name}: path must be a non-empty string.`);
    continue;
  }

  const absolutePath = expandPath(configuredPath);

  if (!existsSync(absolutePath)) {
    fail(`${name}: missing ${configuredPath}`);
    continue;
  }

  if (!statSync(absolutePath).isDirectory()) {
    fail(`${name}: not a directory ${configuredPath}`);
    continue;
  }

  if (!existsSync(resolve(absolutePath, ".git"))) {
    fail(`${name}: not a git checkout ${configuredPath}`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`Local repo manifest ok: ${checked} repos checked.`);
