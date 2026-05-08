import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classifyFile, type FileClassification } from "../../src/core/file-classifier.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fc-test-"));
  await git(["init", "--initial-branch=main"], dir);
  await git(["config", "user.email", "test@test.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "dummy"), "init\n");
  await git(["add", "."], dir);
  await git(["commit", "-m", "init"], dir);
  return dir;
}

describe("file-classifier", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeRepo();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("built-in heuristics", () => {
    it("classifies package-lock.json as collapsed", () => {
      const result = classifyFile("package-lock.json", {});
      expect(result).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies yarn.lock as collapsed", () => {
      expect(classifyFile("yarn.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies pnpm-lock.yaml as collapsed", () => {
      expect(classifyFile("pnpm-lock.yaml", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies bun.lock as collapsed", () => {
      expect(classifyFile("bun.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies bun.lockb as collapsed", () => {
      expect(classifyFile("bun.lockb", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies Cargo.lock as collapsed", () => {
      expect(classifyFile("Cargo.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies Gemfile.lock as collapsed", () => {
      expect(classifyFile("Gemfile.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies composer.lock as collapsed", () => {
      expect(classifyFile("composer.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies Pipfile.lock as collapsed", () => {
      expect(classifyFile("Pipfile.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies poetry.lock as collapsed", () => {
      expect(classifyFile("poetry.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies uv.lock as collapsed", () => {
      expect(classifyFile("uv.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies go.sum as collapsed", () => {
      expect(classifyFile("go.sum", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies *.lock files as collapsed", () => {
      expect(classifyFile("whatever.lock", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies node_modules paths as vendored", () => {
      expect(classifyFile("node_modules/foo/index.js", {})).toEqual({ collapsed: true, reason: "vendored" });
    });

    it("classifies vendor paths as vendored", () => {
      expect(classifyFile("vendor/github.com/pkg/errors/errors.go", {})).toEqual({ collapsed: true, reason: "vendored" });
    });

    it("classifies third_party paths as vendored", () => {
      expect(classifyFile("third_party/protobuf/proto.h", {})).toEqual({ collapsed: true, reason: "vendored" });
    });

    it("classifies bower_components paths as vendored", () => {
      expect(classifyFile("bower_components/jquery/jquery.js", {})).toEqual({ collapsed: true, reason: "vendored" });
    });

    it("classifies dist paths as generated", () => {
      expect(classifyFile("dist/bundle.js", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies build paths as generated", () => {
      expect(classifyFile("build/output.js", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies out paths as generated", () => {
      expect(classifyFile("out/main.js", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies target paths as generated", () => {
      expect(classifyFile("target/debug/main", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies coverage paths as generated", () => {
      expect(classifyFile("coverage/lcov.info", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies *.min.js as generated", () => {
      expect(classifyFile("lib/app.min.js", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies *.min.css as generated", () => {
      expect(classifyFile("styles/main.min.css", {})).toEqual({ collapsed: true, reason: "generated" });
    });

    it("classifies *.min.map as generated", () => {
      expect(classifyFile("lib/app.min.map", {})).toEqual({ collapsed: true, reason: "generated" });
    });
  });

  describe("no classification (default path)", () => {
    it("returns collapsed: false for normal source files", () => {
      expect(classifyFile("src/index.ts", {})).toEqual({ collapsed: false });
    });

    it("returns collapsed: false for README.md", () => {
      expect(classifyFile("README.md", {})).toEqual({ collapsed: false });
    });

    it("returns collapsed: false for test files", () => {
      expect(classifyFile("tests/core/foo.test.ts", {})).toEqual({ collapsed: false });
    });
  });

  describe("binary detection", () => {
    it("classifies with reason binary when isBinary is true", () => {
      expect(classifyFile("image.png", { isBinary: true })).toEqual({ collapsed: true, reason: "binary" });
    });

    it("does not classify as binary when isBinary is false", () => {
      expect(classifyFile("src/index.ts", { isBinary: false })).toEqual({ collapsed: false });
    });
  });

  describe("renamed detection", () => {
    it("classifies with reason renamed when isRenamed is true and hasChanges is false", () => {
      expect(classifyFile("new-name.ts", { isRenamed: true, hasChanges: false })).toEqual({ collapsed: true, reason: "renamed" });
    });

    it("does not classify as renamed when file has content changes", () => {
      expect(classifyFile("new-name.ts", { isRenamed: true, hasChanges: true })).toEqual({ collapsed: false });
    });
  });

  describe("gitattributes overrides", () => {
    it("linguist-generated=true causes collapsed with reason generated", async () => {
      await writeFile(join(cwd, ".gitattributes"), "src/generated.ts linguist-generated=true\n");
      await git(["add", ".gitattributes"], cwd);
      await git(["commit", "-m", "add gitattributes"], cwd);

      const result = await classifyFile("src/generated.ts", { cwd });
      expect(result).toEqual({ collapsed: true, reason: "generated" });
    });

    it("linguist-vendored=true causes collapsed with reason vendored", async () => {
      await writeFile(join(cwd, ".gitattributes"), "lib/extern.js linguist-vendored=true\n");
      await git(["add", ".gitattributes"], cwd);
      await git(["commit", "-m", "add gitattributes"], cwd);

      const result = await classifyFile("lib/extern.js", { cwd });
      expect(result).toEqual({ collapsed: true, reason: "vendored" });
    });

    it("explicit -linguist-generated cancels heuristic", async () => {
      await writeFile(join(cwd, ".gitattributes"), "package-lock.json -linguist-generated\n");
      await git(["add", ".gitattributes"], cwd);
      await git(["commit", "-m", "add gitattributes"], cwd);

      const result = await classifyFile("package-lock.json", { cwd });
      expect(result).toEqual({ collapsed: false });
    });

    it("gitattributes takes precedence over heuristics", async () => {
      await writeFile(join(cwd, ".gitattributes"), "vendor/special.go linguist-vendored=false\n");
      await git(["add", ".gitattributes"], cwd);
      await git(["commit", "-m", "add gitattributes"], cwd);

      const result = await classifyFile("vendor/special.go", { cwd });
      // Explicit false in gitattributes should NOT collapse despite heuristic match
      expect(result.collapsed).toBe(false);
    });

    it("falls back to heuristics when no gitattributes match", async () => {
      await writeFile(join(cwd, ".gitattributes"), "other-file.txt linguist-generated=true\n");
      await git(["add", ".gitattributes"], cwd);
      await git(["commit", "-m", "add gitattributes"], cwd);

      const result = await classifyFile("package-lock.json", { cwd });
      expect(result).toEqual({ collapsed: true, reason: "generated" });
    });

    it("works without cwd (sync-only, no gitattributes check)", () => {
      const result = classifyFile("package-lock.json", {});
      expect(result).toEqual({ collapsed: true, reason: "generated" });
    });
  });

  describe("precedence order", () => {
    it("binary takes precedence over heuristics", () => {
      expect(classifyFile("dist/bundle.js", { isBinary: true })).toEqual({ collapsed: true, reason: "binary" });
    });

    it("renamed takes precedence over nothing but not over heuristics for non-collapsed", () => {
      expect(classifyFile("new-name.ts", { isRenamed: true, hasChanges: false })).toEqual({ collapsed: true, reason: "renamed" });
    });
  });
});
