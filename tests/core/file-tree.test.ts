import { describe, it, expect } from "vitest";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
} from "../../src/core/file-tree.js";

interface F {
  name: string;
}

const f = (name: string): F => ({ name });

function rows(files: F[], collapsed: Set<string> = new Set(), counts: Record<string, number> = {}) {
  return flatten(compress(buildTree(files)), collapsed, counts);
}

describe("file-tree", () => {
  it("returns no rows for empty input", () => {
    expect(rows([])).toEqual([]);
  });

  it("renders a single root file as one row at depth 0", () => {
    const out = rows([f("README.md")]);
    expect(out).toEqual([
      {
        kind: "file",
        path: "README.md",
        displayName: "README.md",
        depth: 0,
        file: { name: "README.md" },
        annotationCount: 0,
      },
    ]);
  });

  it("compresses the entire prefix of a single deeply-nested file into one folder row", () => {
    const out = rows([f("a/b/c/d.txt")]);
    expect(out).toEqual([
      {
        kind: "folder",
        path: "a/b/c",
        displayName: "a/b/c",
        depth: 0,
        hasChildren: true,
        annotationCount: 0,
        collapsed: false,
      },
      {
        kind: "file",
        path: "a/b/c/d.txt",
        displayName: "d.txt",
        depth: 1,
        file: { name: "a/b/c/d.txt" },
        annotationCount: 0,
      },
    ]);
  });

  it("folds a long shared prefix across multiple files into one folder row", () => {
    const out = rows([
      f("packages/app-urls/src/resources/conversations.ts"),
      f("packages/app-urls/src/resources/messages.ts"),
    ]);
    expect(out.map((r) => r.path)).toEqual([
      "packages/app-urls/src/resources",
      "packages/app-urls/src/resources/conversations.ts",
      "packages/app-urls/src/resources/messages.ts",
    ]);
    expect(out[0].kind).toBe("folder");
    expect((out[0] as { displayName: string }).displayName).toBe("packages/app-urls/src/resources");
    expect((out[0] as { depth: number }).depth).toBe(0);
    expect((out[1] as { depth: number }).depth).toBe(1);
    expect((out[2] as { depth: number }).depth).toBe(1);
  });

  it("sorts folders before files at the same depth, alphabetical within each group", () => {
    const out = rows([
      f("zeta.txt"),
      f("alpha.txt"),
      f("zfolder/inner.txt"),
      f("afolder/inner.txt"),
    ]);
    expect(out.map((r) => r.path)).toEqual([
      "afolder",
      "afolder/inner.txt",
      "zfolder",
      "zfolder/inner.txt",
      "alpha.txt",
      "zeta.txt",
    ]);
  });

  it("hides descendants of a collapsed folder but keeps the folder row", () => {
    const out = rows(
      [f("src/a.ts"), f("src/b.ts"), f("README.md")],
      new Set(["src"]),
    );
    expect(out.map((r) => ({ kind: r.kind, path: r.path }))).toEqual([
      { kind: "folder", path: "src" },
      { kind: "file", path: "README.md" },
    ]);
    const folder = out[0];
    expect(folder.kind).toBe("folder");
    expect((folder as { collapsed: boolean }).collapsed).toBe(true);
  });

  it("rolls up annotation counts from descendants onto folder rows", () => {
    const out = rows(
      [f("src/a.ts"), f("src/sub/b.ts"), f("src/sub/c.ts"), f("README.md")],
      new Set(),
      { "src/a.ts": 2, "src/sub/b.ts": 1, "src/sub/c.ts": 5, "README.md": 0 },
    );
    const byPath = new Map(out.map((r) => [r.path, r]));
    expect(byPath.get("src")).toMatchObject({ kind: "folder", annotationCount: 8 });
    expect(byPath.get("src/sub")).toMatchObject({ kind: "folder", annotationCount: 6 });
    expect(byPath.get("src/a.ts")).toMatchObject({ annotationCount: 2 });
    expect(byPath.get("src/sub/b.ts")).toMatchObject({ annotationCount: 1 });
    expect(byPath.get("src/sub/c.ts")).toMatchObject({ annotationCount: 5 });
    expect(byPath.get("README.md")).toMatchObject({ annotationCount: 0 });
  });

  it("reveals the compressed ancestor folder path of a deeply-nested file", () => {
    const tree = compress(buildTree([f("a/b/c/d.txt"), f("a/b/c/e.txt")]));
    expect(revealAncestors(tree, "a/b/c/d.txt")).toEqual(["a/b/c"]);
  });

  it("reveals every ancestor folder along an uncompressed chain", () => {
    const tree = compress(
      buildTree([f("src/web/x.ts"), f("src/core/y.ts"), f("src/core/z.ts")]),
    );
    expect(revealAncestors(tree, "src/core/y.ts")).toEqual(["src", "src/core"]);
  });

  it("reveals nothing for a root-level file", () => {
    const tree = compress(buildTree([f("README.md")]));
    expect(revealAncestors(tree, "README.md")).toEqual([]);
  });

  it("produces stable row order across reruns regardless of input order", () => {
    const a = rows([f("b/x.ts"), f("a/y.ts"), f("README.md"), f("a/x.ts")]);
    const b = rows([f("README.md"), f("a/x.ts"), f("b/x.ts"), f("a/y.ts")]);
    expect(a.map((r) => r.path)).toEqual(b.map((r) => r.path));
  });
});
