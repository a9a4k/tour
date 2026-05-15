import { describe, it, expect } from "vitest";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  revealAndLocate,
  sortFilesForStream,
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
        commentCount: 0,
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
        commentCount: 0,
        collapsed: false,
      },
      {
        kind: "file",
        path: "a/b/c/d.txt",
        displayName: "d.txt",
        depth: 1,
        file: { name: "a/b/c/d.txt" },
        commentCount: 0,
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

  it("rolls up comment counts from descendants onto folder rows", () => {
    const out = rows(
      [f("src/a.ts"), f("src/sub/b.ts"), f("src/sub/c.ts"), f("README.md")],
      new Set(),
      { "src/a.ts": 2, "src/sub/b.ts": 1, "src/sub/c.ts": 5, "README.md": 0 },
    );
    const byPath = new Map(out.map((r) => [r.path, r]));
    expect(byPath.get("src")).toMatchObject({ kind: "folder", commentCount: 8 });
    expect(byPath.get("src/sub")).toMatchObject({ kind: "folder", commentCount: 6 });
    expect(byPath.get("src/a.ts")).toMatchObject({ commentCount: 2 });
    expect(byPath.get("src/sub/b.ts")).toMatchObject({ commentCount: 1 });
    expect(byPath.get("src/sub/c.ts")).toMatchObject({ commentCount: 5 });
    expect(byPath.get("README.md")).toMatchObject({ commentCount: 0 });
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

  describe("sortFilesForStream", () => {
    it("returns an empty array for empty input", () => {
      expect(sortFilesForStream<F>([])).toEqual([]);
    });

    it("orders a sibling folder's files before a root-level file", () => {
      const files = [f("README.md"), f("src/main.ts")];
      expect(sortFilesForStream(files).map((x) => x.name)).toEqual([
        "src/main.ts",
        "README.md",
      ]);
    });

    it("orders a sibling folder's files before a same-level file inside a shared folder", () => {
      const files = [f("src/a.ts"), f("src/b/c.ts")];
      expect(sortFilesForStream(files).map((x) => x.name)).toEqual([
        "src/b/c.ts",
        "src/a.ts",
      ]);
    });

    it("sorts deeply nested folders alphabetically by each segment", () => {
      const files = [
        f("z/x/file.ts"),
        f("a/b/file.ts"),
        f("a/a/file.ts"),
        f("m/n/file.ts"),
      ];
      expect(sortFilesForStream(files).map((x) => x.name)).toEqual([
        "a/a/file.ts",
        "a/b/file.ts",
        "m/n/file.ts",
        "z/x/file.ts",
      ]);
    });

    it("returns an equivalent order for input that is already in correct order", () => {
      const files = [f("a/a.ts"), f("a/b.ts"), f("README.md")];
      expect(sortFilesForStream(files).map((x) => x.name)).toEqual(
        files.map((x) => x.name),
      );
    });

    it("produces a stable order regardless of input order", () => {
      const a = sortFilesForStream([
        f("b/x.ts"),
        f("a/y.ts"),
        f("README.md"),
        f("a/x.ts"),
      ]);
      const b = sortFilesForStream([
        f("README.md"),
        f("a/x.ts"),
        f("b/x.ts"),
        f("a/y.ts"),
      ]);
      expect(a.map((x) => x.name)).toEqual(b.map((x) => x.name));
    });

    it("matches the sidebar's file-visit order even when the sidebar path-compresses chains", () => {
      const files = [
        f("README.md"),
        f("src/main.ts"),
        f("packages/app/src/a.ts"),
        f("packages/app/src/b.ts"),
      ];
      const sidebarFiles = flatten(compress(buildTree(files)), new Set(), {})
        .filter((r) => r.kind === "file")
        .map((r) => r.path);
      const streamFiles = sortFilesForStream(files).map((x) => x.name);
      expect(streamFiles).toEqual(sidebarFiles);
    });

    it("preserves the file objects (not just names)", () => {
      interface TaggedFile extends F {
        tag: number;
      }
      const files: TaggedFile[] = [
        { name: "README.md", tag: 1 },
        { name: "src/main.ts", tag: 2 },
      ];
      const sorted = sortFilesForStream(files);
      expect(sorted[0]).toEqual({ name: "src/main.ts", tag: 2 });
      expect(sorted[1]).toEqual({ name: "README.md", tag: 1 });
    });
  });

  describe("revealAndLocate", () => {
    it("returns the file row index without altering the collapsed set when ancestors are already revealed", () => {
      const tree = compress(buildTree([f("src/a.ts"), f("src/b.ts"), f("README.md")]));
      const collapsed: ReadonlySet<string> = new Set();
      const out = revealAndLocate(tree, collapsed, {}, "src/b.ts");
      expect(out).not.toBeNull();
      expect(out!.collapsedFolders).toBe(collapsed);
      expect(out!.rowIdx).toBe(2);
      expect(out!.rows[out!.rowIdx]).toMatchObject({ kind: "file", path: "src/b.ts" });
    });

    it("removes ancestor folders from the collapsed set and returns the post-reveal row index", () => {
      const tree = compress(buildTree([f("src/web/x.ts"), f("src/core/y.ts"), f("src/core/z.ts")]));
      const collapsed = new Set(["src", "src/core"]);
      const out = revealAndLocate(tree, collapsed, {}, "src/core/y.ts");
      expect(out).not.toBeNull();
      expect(out!.collapsedFolders).not.toBe(collapsed);
      expect(out!.collapsedFolders.has("src")).toBe(false);
      expect(out!.collapsedFolders.has("src/core")).toBe(false);
      expect(out!.rows[out!.rowIdx]).toMatchObject({ kind: "file", path: "src/core/y.ts" });
    });

    it("returns null when the file is not in the tree", () => {
      const tree = compress(buildTree([f("src/a.ts")]));
      expect(revealAndLocate(tree, new Set(), {}, "missing.ts")).toBeNull();
    });

    it("preserves unrelated collapsed folders when revealing a file's ancestors", () => {
      const tree = compress(
        buildTree([f("src/a.ts"), f("src/b.ts"), f("docs/intro.md"), f("docs/api.md")]),
      );
      const collapsed = new Set(["src", "docs"]);
      const out = revealAndLocate(tree, collapsed, {}, "docs/api.md");
      expect(out).not.toBeNull();
      expect(out!.collapsedFolders.has("src")).toBe(true);
      expect(out!.collapsedFolders.has("docs")).toBe(false);
    });
  });
});
