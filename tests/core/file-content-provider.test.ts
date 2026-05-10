import { describe, it, expect } from "vitest";
import { fetchFileContents } from "../../src/core/file-content-provider.js";
import type { DiffFile } from "../../src/core/diff-model.js";

const BASE = "base-sha";
const HEAD = "head-sha";
const CWD = "/some/repo";

function fileChange(name: string): DiffFile {
  return { name, type: "change", hunks: [] };
}

function fileNew(name: string): DiffFile {
  return { name, type: "new", hunks: [] };
}

function fileDeleted(name: string): DiffFile {
  // Pierre's ChangeTypes use "deleted"; legacy CLI surfaces use "delete".
  return { name, type: "deleted", hunks: [] };
}

function fileRenamed(name: string, prevName: string): DiffFile {
  return { name, prevName, type: "rename", hunks: [] };
}

function fileBinary(name: string): DiffFile {
  return { name, type: "binary", hunks: [] };
}

describe("fetchFileContents", () => {
  it("modified file fetches both sides under the file's name", async () => {
    const calls: Array<{ sha: string; path: string }> = [];
    const gitShow = async (sha: string, path: string, _cwd: string) => {
      calls.push({ sha, path });
      if (sha === BASE && path === "src/foo.ts") return "old contents\n";
      if (sha === HEAD && path === "src/foo.ts") return "new contents\n";
      return "";
    };
    const map = await fetchFileContents(
      { files: [fileChange("src/foo.ts")] },
      { baseSha: BASE, headSha: HEAD, cwd: CWD, gitShow },
    );
    expect(map.size).toBe(1);
    expect(map.get("src/foo.ts")).toEqual({
      oldContent: "old contents\n",
      newContent: "new contents\n",
    });
    expect(calls).toContainEqual({ sha: BASE, path: "src/foo.ts" });
    expect(calls).toContainEqual({ sha: HEAD, path: "src/foo.ts" });
  });

  it("renamed file fetches prevName from base and name from head", async () => {
    const calls: Array<{ sha: string; path: string }> = [];
    const gitShow = async (sha: string, path: string, _cwd: string) => {
      calls.push({ sha, path });
      if (sha === BASE && path === "src/old.ts") return "before\n";
      if (sha === HEAD && path === "src/new.ts") return "after\n";
      return "";
    };
    const map = await fetchFileContents(
      { files: [fileRenamed("src/new.ts", "src/old.ts")] },
      { baseSha: BASE, headSha: HEAD, cwd: CWD, gitShow },
    );
    expect(map.get("src/new.ts")).toEqual({
      oldContent: "before\n",
      newContent: "after\n",
    });
    expect(calls).toContainEqual({ sha: BASE, path: "src/old.ts" });
    expect(calls).toContainEqual({ sha: HEAD, path: "src/new.ts" });
    // Never asks for the new path at base or the old path at head.
    expect(calls).not.toContainEqual({ sha: BASE, path: "src/new.ts" });
    expect(calls).not.toContainEqual({ sha: HEAD, path: "src/old.ts" });
  });

  it("new file has empty oldContent", async () => {
    const calls: Array<{ sha: string; path: string }> = [];
    const gitShow = async (sha: string, path: string, _cwd: string) => {
      calls.push({ sha, path });
      if (sha === HEAD && path === "src/added.ts") return "fresh\n";
      return "";
    };
    const map = await fetchFileContents(
      { files: [fileNew("src/added.ts")] },
      { baseSha: BASE, headSha: HEAD, cwd: CWD, gitShow },
    );
    expect(map.get("src/added.ts")).toEqual({
      oldContent: "",
      newContent: "fresh\n",
    });
    // Skips the doomed base-side fetch entirely.
    expect(calls).not.toContainEqual({ sha: BASE, path: "src/added.ts" });
  });

  it("deleted file has empty newContent", async () => {
    const calls: Array<{ sha: string; path: string }> = [];
    const gitShow = async (sha: string, path: string, _cwd: string) => {
      calls.push({ sha, path });
      if (sha === BASE && path === "src/gone.ts") return "remembered\n";
      return "";
    };
    const map = await fetchFileContents(
      { files: [fileDeleted("src/gone.ts")] },
      { baseSha: BASE, headSha: HEAD, cwd: CWD, gitShow },
    );
    expect(map.get("src/gone.ts")).toEqual({
      oldContent: "remembered\n",
      newContent: "",
    });
    expect(calls).not.toContainEqual({ sha: HEAD, path: "src/gone.ts" });
  });

  it("binary-classified file is omitted from the map", async () => {
    const gitShow = async () => "should-not-appear";
    const map = await fetchFileContents(
      { files: [fileBinary("assets/logo.png"), fileChange("src/foo.ts")] },
      { baseSha: BASE, headSha: HEAD, cwd: CWD, gitShow },
    );
    expect(map.has("assets/logo.png")).toBe(false);
    expect(map.has("src/foo.ts")).toBe(true);
  });

  it("output map is keyed by path regardless of fetch resolution order", async () => {
    // Resolves head fetches before base fetches and out of input order, to
    // catch any accidental dependence on Promise.all index ordering.
    const gitShow = async (sha: string, path: string, _cwd: string) => {
      const delay = sha === HEAD ? 0 : 5;
      await new Promise((r) => setTimeout(r, delay));
      return `${sha}:${path}`;
    };
    const files: DiffFile[] = [
      fileChange("a.ts"),
      fileChange("b.ts"),
      fileChange("c.ts"),
    ];
    const map = await fetchFileContents(
      { files },
      { baseSha: BASE, headSha: HEAD, cwd: CWD, gitShow },
    );
    expect(map.get("a.ts")?.oldContent).toBe(`${BASE}:a.ts`);
    expect(map.get("a.ts")?.newContent).toBe(`${HEAD}:a.ts`);
    expect(map.get("b.ts")?.oldContent).toBe(`${BASE}:b.ts`);
    expect(map.get("b.ts")?.newContent).toBe(`${HEAD}:b.ts`);
    expect(map.get("c.ts")?.oldContent).toBe(`${BASE}:c.ts`);
    expect(map.get("c.ts")?.newContent).toBe(`${HEAD}:c.ts`);
  });
});
