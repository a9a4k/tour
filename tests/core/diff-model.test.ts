import { describe, it, expect } from "vitest";
import { parseDiff, splitRawDiffByFile } from "../../src/core/diff-model.js";

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
