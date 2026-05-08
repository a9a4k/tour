import { describe, it, expect } from "vitest";
import { langFromPath, highlightLine, highlightDiffLines } from "../../src/web/highlight.js";

describe("langFromPath", () => {
  it("detects TypeScript from .ts extension", () => {
    expect(langFromPath("src/cli/annotate.ts")).toBe("typescript");
  });

  it("detects TypeScript from .tsx extension", () => {
    expect(langFromPath("components/App.tsx")).toBe("typescript");
  });

  it("detects JSON", () => {
    expect(langFromPath("package.json")).toBe("json");
  });

  it("detects Markdown", () => {
    expect(langFromPath("README.md")).toBe("markdown");
  });

  it("detects YAML", () => {
    expect(langFromPath(".github/workflows/ci.yml")).toBe("yaml");
  });

  it("detects TOML via ini fallback", () => {
    expect(langFromPath("pyproject.toml")).toBe("ini");
  });

  it("detects Dockerfile by basename", () => {
    expect(langFromPath("Dockerfile")).toBe("dockerfile");
  });

  it("detects Makefile by basename", () => {
    expect(langFromPath("Makefile")).toBe("makefile");
  });

  it("returns null for unknown extensions", () => {
    expect(langFromPath("data.xyz")).toBeNull();
  });

  it("returns null for extensionless files", () => {
    expect(langFromPath("LICENSE")).toBeNull();
  });

  it("handles deeply nested paths", () => {
    expect(langFromPath("a/b/c/d/file.rs")).toBe("rust");
  });

  it("is case-insensitive on extension", () => {
    expect(langFromPath("README.MD")).toBe("markdown");
  });
});

describe("highlightLine", () => {
  it("wraps TypeScript keywords in spans", () => {
    const result = highlightLine("const x = 42;", "typescript");
    expect(result).toContain("hljs-keyword");
    expect(result).toContain("hljs-number");
  });

  it("escapes HTML in source code", () => {
    const result = highlightLine("const a = '<div>';", "typescript");
    expect(result).toContain("&lt;div&gt;");
    expect(result).not.toContain("<div>");
  });

  it("returns plain escaped text for plaintext language", () => {
    const result = highlightLine("just text", "plaintext");
    expect(result).toBe("just text");
  });
});

describe("highlightDiffLines", () => {
  const sampleDiff = [
    "diff --git a/hello.ts b/hello.ts",
    "--- a/hello.ts",
    "+++ b/hello.ts",
    "@@ -1,3 +1,3 @@",
    " import { foo } from 'bar';",
    "-const x = 1;",
    "+const x = 42;",
  ].join("\n");

  it("returns array with same length as diff lines", () => {
    const result = highlightDiffLines(sampleDiff);
    expect(result).toHaveLength(sampleDiff.split("\n").length);
  });

  it("returns null for diff header lines", () => {
    const result = highlightDiffLines(sampleDiff);
    expect(result[0]).toBeNull(); // diff --git
    expect(result[1]).toBeNull(); // ---
    expect(result[2]).toBeNull(); // +++
    expect(result[3]).toBeNull(); // @@
  });

  it("highlights context lines", () => {
    const result = highlightDiffLines(sampleDiff);
    expect(result[4]).toContain("hljs-keyword"); // import
  });

  it("highlights deletion lines", () => {
    const result = highlightDiffLines(sampleDiff);
    expect(result[5]).toContain("hljs-keyword"); // const
    expect(result[5]).toContain("hljs-number"); // 1
  });

  it("highlights addition lines", () => {
    const result = highlightDiffLines(sampleDiff);
    expect(result[6]).toContain("hljs-keyword"); // const
    expect(result[6]).toContain("hljs-number"); // 42
  });

  it("strips the leading +/- prefix before highlighting", () => {
    const result = highlightDiffLines(sampleDiff);
    // The + or - should not appear in the highlighted output
    expect(result[5]).not.toMatch(/^-/);
    expect(result[6]).not.toMatch(/^\+/);
  });

  it("returns null for all lines when file has unknown extension", () => {
    const unknownDiff = [
      "diff --git a/data.xyz b/data.xyz",
      "--- a/data.xyz",
      "+++ b/data.xyz",
      "@@ -1,1 +1,1 @@",
      "-old stuff",
      "+new stuff",
    ].join("\n");
    const result = highlightDiffLines(unknownDiff);
    expect(result.every((r) => r === null)).toBe(true);
  });

  it("handles multi-file diffs", () => {
    const multiDiff = [
      "diff --git a/hello.ts b/hello.ts",
      "@@ -1,1 +1,1 @@",
      "+const a = 1;",
      "diff --git a/data.json b/data.json",
      "@@ -1,1 +1,1 @@",
      '+{"key": "value"}',
    ].join("\n");
    const result = highlightDiffLines(multiDiff);
    expect(result[2]).toContain("hljs-keyword"); // const in TS
    expect(result[5]).toContain("hljs-attr"); // key in JSON
  });

  it("returns null for empty diff line", () => {
    expect(highlightDiffLines("")).toEqual([null]);
  });
});
