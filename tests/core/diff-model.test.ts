import { describe, it, expect } from "vitest";
import {
  parseDiff,
  splitRawDiffByFile,
  splitFileDiffByHunk,
  resolveCommentToHunkIndex,
  type DiffFile,
} from "../../src/core/diff-model.js";

describe("parseDiff", () => {
  it("returns empty model for empty string", () => {
    const model = parseDiff("");
    expect(model.files).toEqual([]);
  });

  it("parses a single file change", () => {
    const diff = `diff --git a/hello.txt b/hello.txt
index ce01362..94954ab 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1 +1 @@
-hello
+hello world
`;
    const model = parseDiff(diff);
    expect(model.files).toHaveLength(1);
    expect(model.files[0].name).toBe("hello.txt");
    expect(model.files[0].hunks).toHaveLength(1);
    expect(model.files[0].hunks[0].additionCount).toBe(1);
    expect(model.files[0].hunks[0].deletionCount).toBe(1);
  });

  it("parses multiple file changes", () => {
    const diff = `diff --git a/a.txt b/a.txt
new file mode 100644
index 0000000..257cc56
--- /dev/null
+++ b/a.txt
@@ -0,0 +1 @@
+foo
diff --git a/b.txt b/b.txt
new file mode 100644
index 0000000..5716ca5
--- /dev/null
+++ b/b.txt
@@ -0,0 +1 @@
+bar
`;
    const model = parseDiff(diff);
    expect(model.files).toHaveLength(2);
    expect(model.files.map((f) => f.name).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("identifies file type for new files", () => {
    const diff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..257cc56
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+content
`;
    const model = parseDiff(diff);
    expect(model.files[0].type).toBe("new");
  });
});

describe("splitRawDiffByFile", () => {
  it("returns an empty map for empty input", () => {
    expect(splitRawDiffByFile("")).toEqual(new Map());
    expect(splitRawDiffByFile("   \n  ")).toEqual(new Map());
  });

  it("returns one entry keyed by post-image name for a single file", () => {
    const diff = `diff --git a/hello.txt b/hello.txt
index ce01362..94954ab 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1 +1 @@
-hello
+hello world
`;
    const map = splitRawDiffByFile(diff);
    expect(map.size).toBe(1);
    const segment = map.get("hello.txt");
    expect(segment).toBeDefined();
    expect(segment!.startsWith("diff --git a/hello.txt b/hello.txt")).toBe(true);
    expect(segment).toContain("+hello world");
  });

  it("splits a multi-file diff with no cross-contamination", () => {
    const diff = `diff --git a/a.txt b/a.txt
new file mode 100644
index 0000000..257cc56
--- /dev/null
+++ b/a.txt
@@ -0,0 +1 @@
+foo
diff --git a/b.txt b/b.txt
new file mode 100644
index 0000000..5716ca5
--- /dev/null
+++ b/b.txt
@@ -0,0 +1 @@
+bar
`;
    const map = splitRawDiffByFile(diff);
    expect(map.size).toBe(2);
    expect([...map.keys()].sort()).toEqual(["a.txt", "b.txt"]);
    expect(map.get("a.txt")).toContain("+foo");
    expect(map.get("a.txt")).not.toContain("+bar");
    expect(map.get("b.txt")).toContain("+bar");
    expect(map.get("b.txt")).not.toContain("+foo");
  });

  it("keys renames by the post-image name", () => {
    const diff = `diff --git a/old/path.txt b/new/path.txt
similarity index 95%
rename from old/path.txt
rename to new/path.txt
index abc1234..def5678 100644
--- a/old/path.txt
+++ b/new/path.txt
@@ -1 +1 @@
-old
+new
`;
    const map = splitRawDiffByFile(diff);
    expect(map.size).toBe(1);
    expect(map.has("new/path.txt")).toBe(true);
    expect(map.has("old/path.txt")).toBe(false);
  });

  it("drops content before the first diff --git header", () => {
    const diff = `some preamble that should not exist in practice
diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-x
+X
`;
    const map = splitRawDiffByFile(diff);
    expect(map.size).toBe(1);
    expect(map.get("x.txt")!.startsWith("diff --git")).toBe(true);
  });
});

describe("splitFileDiffByHunk", () => {
  it("returns empty array for empty input", () => {
    expect(splitFileDiffByHunk("")).toEqual([]);
    expect(splitFileDiffByHunk("   \n  ")).toEqual([]);
  });

  it("returns one segment per hunk, each carrying the file header", () => {
    const segment = `diff --git a/multi.txt b/multi.txt
index ce01362..94954ab 100644
--- a/multi.txt
+++ b/multi.txt
@@ -1,2 +1,2 @@
-old1
+new1
 ctx1
@@ -10,2 +10,2 @@
-old10
+new10
 ctx10`;
    const segs = splitFileDiffByHunk(segment);
    expect(segs).toHaveLength(2);
    for (const s of segs) {
      expect(s.startsWith("diff --git a/multi.txt b/multi.txt")).toBe(true);
      expect(s).toContain("--- a/multi.txt");
      expect(s).toContain("+++ b/multi.txt");
    }
    expect(segs[0]).toContain("@@ -1,2 +1,2 @@");
    expect(segs[0]).toContain("+new1");
    expect(segs[0]).not.toContain("@@ -10,2 +10,2 @@");
    expect(segs[1]).toContain("@@ -10,2 +10,2 @@");
    expect(segs[1]).toContain("+new10");
    expect(segs[1]).not.toContain("@@ -1,2 +1,2 @@");
  });

  it("returns segments that re-parse as a single hunk each", () => {
    const segment = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,1 +1,1 @@
-a
+b
@@ -5,1 +5,1 @@
-c
+d`;
    const segs = splitFileDiffByHunk(segment);
    expect(segs).toHaveLength(2);
    const m0 = parseDiff(segs[0]);
    expect(m0.files).toHaveLength(1);
    expect(m0.files[0].hunks).toHaveLength(1);
    expect(m0.files[0].hunks[0].additionStart).toBe(1);
    const m1 = parseDiff(segs[1]);
    expect(m1.files[0].hunks[0].additionStart).toBe(5);
  });

  it("returns empty array when there are no hunks (file header only)", () => {
    const segment = `diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29`;
    expect(splitFileDiffByHunk(segment)).toEqual([]);
  });
});

describe("resolveCommentToHunkIndex", () => {
  const file: DiffFile = {
    name: "x.txt",
    type: "change",
    hunks: [
      {
        additionStart: 1,
        additionCount: 3,
        deletionStart: 1,
        deletionCount: 2,
        content: [],
      },
      {
        additionStart: 20,
        additionCount: 5,
        deletionStart: 19,
        deletionCount: 4,
        content: [],
      },
      {
        additionStart: 40,
        additionCount: 0,
        deletionStart: 38,
        deletionCount: 3,
        content: [],
      },
    ],
  };

  it("finds the hunk on the additions side", () => {
    expect(
      resolveCommentToHunkIndex(file, {
        side: "additions",
        line_start: 2,
        line_end: 2,
      }),
    ).toBe(0);
    expect(
      resolveCommentToHunkIndex(file, {
        side: "additions",
        line_start: 22,
        line_end: 22,
      }),
    ).toBe(1);
  });

  it("finds the hunk on the deletions side", () => {
    expect(
      resolveCommentToHunkIndex(file, {
        side: "deletions",
        line_start: 1,
        line_end: 2,
      }),
    ).toBe(0);
    expect(
      resolveCommentToHunkIndex(file, {
        side: "deletions",
        line_start: 39,
        line_end: 40,
      }),
    ).toBe(2);
  });

  it("matches a multi-line comment that overlaps a hunk's range", () => {
    expect(
      resolveCommentToHunkIndex(file, {
        side: "additions",
        line_start: 2,
        line_end: 4,
      }),
    ).toBe(0);
  });

  it("returns null when no hunk contains the comment's lines", () => {
    expect(
      resolveCommentToHunkIndex(file, {
        side: "additions",
        line_start: 100,
        line_end: 100,
      }),
    ).toBeNull();
  });

  it("skips hunks with zero count on the comment's side", () => {
    expect(
      resolveCommentToHunkIndex(file, {
        side: "additions",
        line_start: 40,
        line_end: 40,
      }),
    ).toBeNull();
  });
});
