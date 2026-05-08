import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface FileClassification {
  collapsed: boolean;
  reason?: "generated" | "vendored" | "binary" | "renamed";
}

export interface ClassifyOptions {
  cwd?: string;
  isBinary?: boolean;
  isRenamed?: boolean;
  hasChanges?: boolean;
}

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "Pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
]);

const VENDORED_PREFIXES = [
  "node_modules/",
  "vendor/",
  "third_party/",
  "bower_components/",
];

const GENERATED_PREFIXES = [
  "dist/",
  "build/",
  "out/",
  "target/",
  "coverage/",
];

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function classifyByHeuristic(path: string): FileClassification {
  const name = basename(path);

  if (LOCKFILES.has(name) || name.endsWith(".lock")) {
    return { collapsed: true, reason: "generated" };
  }

  if (name.endsWith(".min.js") || name.endsWith(".min.css") || name.endsWith(".min.map")) {
    return { collapsed: true, reason: "generated" };
  }

  for (const prefix of VENDORED_PREFIXES) {
    if (path.startsWith(prefix)) return { collapsed: true, reason: "vendored" };
  }

  for (const prefix of GENERATED_PREFIXES) {
    if (path.startsWith(prefix)) return { collapsed: true, reason: "generated" };
  }

  return { collapsed: false };
}

interface GitAttrResult {
  generated?: "set" | "unset" | "true" | "false" | "unspecified";
  vendored?: "set" | "unset" | "true" | "false" | "unspecified";
}

async function checkGitAttrs(path: string, cwd: string): Promise<GitAttrResult> {
  try {
    const { stdout } = await exec(
      "git",
      ["check-attr", "linguist-generated", "linguist-vendored", "--", path],
      { cwd },
    );
    const result: GitAttrResult = {};
    for (const line of stdout.split("\n")) {
      const match = line.match(/^.+: (linguist-generated|linguist-vendored): (.+)$/);
      if (!match) continue;
      const [, attr, value] = match;
      if (attr === "linguist-generated") result.generated = value.trim() as GitAttrResult["generated"];
      if (attr === "linguist-vendored") result.vendored = value.trim() as GitAttrResult["vendored"];
    }
    return result;
  } catch {
    return {};
  }
}

export function classifyFile(path: string, opts: ClassifyOptions): FileClassification;
export function classifyFile(path: string, opts: ClassifyOptions & { cwd: string }): Promise<FileClassification>;
export function classifyFile(path: string, opts: ClassifyOptions): FileClassification | Promise<FileClassification> {
  if (opts.isBinary) {
    return { collapsed: true, reason: "binary" };
  }

  if (opts.isRenamed && !opts.hasChanges) {
    return { collapsed: true, reason: "renamed" };
  }

  if (!opts.cwd) {
    return classifyByHeuristic(path);
  }

  return checkGitAttrs(path, opts.cwd).then((attrs) => {
    if (attrs.generated === "true" || attrs.generated === "set") {
      return { collapsed: true, reason: "generated" } as FileClassification;
    }
    if (attrs.generated === "false" || attrs.generated === "unset") {
      return { collapsed: false };
    }
    if (attrs.vendored === "true" || attrs.vendored === "set") {
      return { collapsed: true, reason: "vendored" } as FileClassification;
    }
    if (attrs.vendored === "false" || attrs.vendored === "unset") {
      return { collapsed: false };
    }
    return classifyByHeuristic(path);
  });
}
