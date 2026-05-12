import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detectLang,
  ensureHighlighter,
  isReady,
  isSupportedLang,
  resetForTests,
  tokenize,
} from "../../src/web/client/syntax-highlight.js";

// `syntax-highlight` is the deep module the new web row renderer uses to
// paint per-line syntax. The contract per PRD #212:
//
//   tokenize(content, lang) → Map<lineNumber, html>
//
// — pure function in interface; complex internals (Shiki setup, grammar
// bundling, theme baking, file-extension → language detection, memoization)
// are hidden. Tests below cover the *contract*, not Shiki's internals.

describe("detectLang", () => {
  it("maps common code extensions to the bundled language id", () => {
    expect(detectLang("foo.ts")).toBe("typescript");
    expect(detectLang("foo.tsx")).toBe("tsx");
    expect(detectLang("foo.js")).toBe("javascript");
    expect(detectLang("foo.jsx")).toBe("jsx");
    expect(detectLang("foo.json")).toBe("json");
    expect(detectLang("foo.md")).toBe("markdown");
    expect(detectLang("foo.sh")).toBe("bash");
    expect(detectLang("foo.yml")).toBe("yaml");
    expect(detectLang("foo.yaml")).toBe("yaml");
    expect(detectLang("foo.css")).toBe("css");
    expect(detectLang("foo.html")).toBe("html");
    expect(detectLang("foo.py")).toBe("python");
    expect(detectLang("foo.rs")).toBe("rust");
    expect(detectLang("foo.go")).toBe("go");
  });

  it("falls back to plaintext for unknown extensions", () => {
    expect(detectLang("foo.unknownext")).toBe("plaintext");
    expect(detectLang("foo")).toBe("plaintext");
    expect(detectLang("")).toBe("plaintext");
  });

  it("handles full paths and is case-insensitive on the extension", () => {
    expect(detectLang("src/web/client/App.TSX")).toBe("tsx");
    expect(detectLang("/abs/path/script.PY")).toBe("python");
  });
});

describe("isSupportedLang", () => {
  it("returns true for the eagerly-bundled common-language set", () => {
    expect(isSupportedLang("typescript")).toBe(true);
    expect(isSupportedLang("tsx")).toBe(true);
    expect(isSupportedLang("javascript")).toBe(true);
    expect(isSupportedLang("jsx")).toBe(true);
    expect(isSupportedLang("json")).toBe(true);
    expect(isSupportedLang("markdown")).toBe(true);
    expect(isSupportedLang("bash")).toBe(true);
    expect(isSupportedLang("yaml")).toBe(true);
    expect(isSupportedLang("css")).toBe(true);
    expect(isSupportedLang("html")).toBe(true);
    expect(isSupportedLang("python")).toBe(true);
    expect(isSupportedLang("rust")).toBe(true);
    expect(isSupportedLang("go")).toBe(true);
  });

  it("returns false for plaintext and other unsupported langs", () => {
    expect(isSupportedLang("plaintext")).toBe(false);
    expect(isSupportedLang("klingon")).toBe(false);
    expect(isSupportedLang("")).toBe(false);
  });
});

describe("tokenize — pre-init", () => {
  // Tests in this block run BEFORE ensureHighlighter() is awaited.
  // `tokenize` must still return *something* — the renderer uses the result
  // unconditionally and would crash on `undefined`. The contract: a Map.

  it("returns an empty Map for empty content", () => {
    expect(tokenize("", "typescript").size).toBe(0);
  });

  it("returns a plain-text Map for non-empty content when highlighter is not ready", () => {
    // Pre-init, even for a supported lang, fall back to plain text — the
    // user sees code as text until lazy-highlight fires.
    const lines = tokenize("const x = 1;", "typescript");
    expect(lines.size).toBe(1);
    // Plain-text fallback preserves the source content visibly.
    const html = lines.get(1) ?? "";
    expect(html).toContain("const x = 1;");
  });
});

describe("tokenize — post-init", () => {
  beforeAll(async () => {
    resetForTests();
    await ensureHighlighter();
  });

  afterAll(() => {
    resetForTests();
  });

  it("isReady() flips to true after ensureHighlighter resolves", () => {
    expect(isReady()).toBe(true);
  });

  it("produces a per-line HTML map matching the line count", () => {
    const src = "const x = 1;\nconst y = 2;\nconst z = x + y;";
    const lines = tokenize(src, "typescript");
    expect(lines.size).toBe(3);
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
  });

  it("paints styled spans carrying github-dark-default token colors on supported langs", () => {
    const html = tokenize("const x = 1;", "typescript").get(1) ?? "";
    // Tokenized output uses <span> with a color style — distinguishes
    // styled output from the plain-text fallback.
    expect(html).toMatch(/<span[^>]*style="[^"]*color:#/);
  });

  it("falls back to plain text when the lang is unsupported", () => {
    const html = tokenize("hello world", "klingon").get(1) ?? "";
    expect(html).toContain("hello world");
    // Plain-text fallback emits no syntax-colored spans (color: ...).
    expect(html).not.toMatch(/<span[^>]*style="[^"]*color:#/);
  });

  it("HTML-escapes plain-text fallback content so user input cannot inject markup", () => {
    const html = tokenize("<script>alert(1)</script>", "klingon").get(1) ?? "";
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("memoizes — same (content, lang) returns the same Map reference", () => {
    const a = tokenize("let v: number = 42;", "typescript");
    const b = tokenize("let v: number = 42;", "typescript");
    expect(a).toBe(b);
  });

  it("does not collide cache entries across languages", () => {
    const ts = tokenize("x = 1", "typescript");
    const py = tokenize("x = 1", "python");
    // Same content, different lang → different Map (different tokenization).
    expect(ts).not.toBe(py);
  });

  it("returns an empty Map for empty content (post-init too)", () => {
    expect(tokenize("", "typescript").size).toBe(0);
    expect(tokenize("", "klingon").size).toBe(0);
  });
});
