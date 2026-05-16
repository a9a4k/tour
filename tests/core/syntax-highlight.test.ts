import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  detectLang,
  isReady,
  resetForTests,
  subscribe,
  tokenize,
  tokenizeSync,
  type TokenLine,
} from "../../src/core/syntax-highlight.js";

// `core/syntax-highlight.ts` is the cross-surface tokeniser; the webapp's
// HTML paint adapter and (forthcoming) TUI StyledText adapter both consume
// its `TokenLine[]` contract. Tests below cover the contract — not Shiki's
// internal output — so concrete colour hexes are not asserted.

describe("detectLang", () => {
  it("maps common code extensions to the bundled language id", () => {
    expect(detectLang("foo.ts")).toBe("typescript");
    expect(detectLang("foo.tsx")).toBe("tsx");
    expect(detectLang("foo.js")).toBe("javascript");
    expect(detectLang("foo.jsx")).toBe("jsx");
    expect(detectLang("foo.json")).toBe("json");
    expect(detectLang("foo.md")).toBe("markdown");
    expect(detectLang("foo.py")).toBe("python");
    expect(detectLang("foo.rs")).toBe("rust");
    expect(detectLang("foo.go")).toBe("go");
  });

  it("maps the long-tail extensions the parent PRD calls out", () => {
    // The PRD's named user-visible wins: .proto, .rb, .kt, .swift, .java,
    // .toml, plus the long tail flagged in issue #374's problem statement.
    expect(detectLang("foo.proto")).toBe("proto");
    expect(detectLang("foo.rb")).toBe("ruby");
    expect(detectLang("foo.kt")).toBe("kotlin");
    expect(detectLang("foo.swift")).toBe("swift");
    expect(detectLang("foo.java")).toBe("java");
    expect(detectLang("foo.toml")).toBe("toml");
    expect(detectLang("foo.php")).toBe("php");
    expect(detectLang("foo.c")).toBe("c");
    expect(detectLang("foo.cpp")).toBe("cpp");
    expect(detectLang("foo.cs")).toBe("csharp");
    expect(detectLang("foo.sql")).toBe("sql");
    expect(detectLang("foo.lua")).toBe("lua");
    expect(detectLang("foo.zig")).toBe("zig");
  });

  it("falls back to plaintext for unknown extensions", () => {
    expect(detectLang("foo.unknownext")).toBe("plaintext");
    expect(detectLang("foo")).toBe("plaintext");
    expect(detectLang("")).toBe("plaintext");
  });

  it("handles full paths and is case-insensitive on the extension", () => {
    expect(detectLang("src/web/client/App.TSX")).toBe("tsx");
    expect(detectLang("/abs/path/script.PY")).toBe("python");
    expect(detectLang("/abs/path/schema.PROTO")).toBe("proto");
  });
});

describe("tokenize — empty content", () => {
  it("returns an empty array for empty content (any lang)", async () => {
    expect(await tokenize("", "typescript")).toEqual([]);
    expect(await tokenize("", "proto")).toEqual([]);
    expect(await tokenize("", "klingon")).toEqual([]);
    expect(await tokenize("", "plaintext")).toEqual([]);
  });
});

describe("tokenize — unknown / plaintext langs", () => {
  beforeEach(() => {
    resetForTests();
  });

  afterAll(() => {
    resetForTests();
  });

  it("returns plain-text chunks (no colour) for an unknown language id", async () => {
    const lines = await tokenize("hello world", "klingon");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.chunks).toHaveLength(1);
    expect(lines[0]!.chunks[0]!.text).toBe("hello world");
    expect(lines[0]!.chunks[0]!.color).toBeUndefined();
  });

  it("returns plain-text chunks for the special 'plaintext' lang", async () => {
    const lines = await tokenize("alpha\nbeta", "plaintext");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.chunks[0]!.text).toBe("alpha");
    expect(lines[1]!.chunks[0]!.text).toBe("beta");
    expect(lines[0]!.chunks[0]!.color).toBeUndefined();
    expect(lines[1]!.chunks[0]!.color).toBeUndefined();
  });

  it("emits one TokenLine per source line", async () => {
    const lines = await tokenize("a\nb\nc", "klingon");
    expect(lines).toHaveLength(3);
  });
});

describe("tokenize — bundled langs", () => {
  beforeEach(() => {
    resetForTests();
  });

  afterAll(() => {
    resetForTests();
  });

  it("tokenises a .proto file into non-empty styled chunks (regression-prevent for #375)", async () => {
    const proto = `syntax = "proto3";

message Foo {
  // a comment
  string bar = 1;
}`;
    const lines = await tokenize(proto, "proto");
    expect(lines.length).toBeGreaterThan(1);
    // At least one chunk somewhere in the file carries a colour (Shiki
    // applied github-dark-default tokens).
    const anyColoured = lines.some((ln) =>
      ln.chunks.some((c) => typeof c.color === "string"),
    );
    expect(anyColoured).toBe(true);
  });

  it("tokenises typescript with at least one coloured chunk on a known token", async () => {
    const lines = await tokenize("const x = 1;", "typescript");
    expect(lines).toHaveLength(1);
    const coloured = lines[0]!.chunks.filter((c) => c.color !== undefined);
    expect(coloured.length).toBeGreaterThan(0);
  });

  it("paints comments italic via the italic-comment overlay", async () => {
    const src = "// hello comment\nconst x = 1;";
    const lines = await tokenize(src, "typescript");
    // The first line is the comment; expect at least one chunk on it to
    // carry italic. github-dark-default does not set italic itself, so a
    // pass demonstrates the overlay is in effect.
    const firstLineHasItalic = lines[0]!.chunks.some((c) => c.italic === true);
    expect(firstLineHasItalic).toBe(true);
  });

  it("memoises — same (content, lang) returns the same array reference", async () => {
    const a = await tokenize("let v = 42;", "typescript");
    const b = await tokenize("let v = 42;", "typescript");
    expect(a).toBe(b);
  });

  it("does not collide cache entries across languages", async () => {
    const ts = await tokenize("x = 1", "typescript");
    const py = await tokenize("x = 1", "python");
    expect(ts).not.toBe(py);
  });
});

describe("isReady + subscribe", () => {
  beforeEach(() => {
    resetForTests();
  });

  afterAll(() => {
    resetForTests();
  });

  it("starts not-ready for a bundled lang and flips after tokenize awaits", async () => {
    expect(isReady("typescript")).toBe(false);
    await tokenize("const x = 1;", "typescript");
    expect(isReady("typescript")).toBe(true);
  });

  it("reports plaintext as always ready", () => {
    expect(isReady("plaintext")).toBe(true);
  });

  it("subscribe(lang, cb) fires when isReady flips for that lang", async () => {
    let fired = 0;
    const unsub = subscribe("proto", () => {
      fired += 1;
    });
    expect(isReady("proto")).toBe(false);
    await tokenize("syntax = \"proto3\";", "proto");
    expect(isReady("proto")).toBe(true);
    expect(fired).toBe(1);
    unsub();
  });

  it("subscribe returns an unsubscribe that prevents further fires", async () => {
    let fired = 0;
    const unsub = subscribe("ruby", () => {
      fired += 1;
    });
    unsub();
    await tokenize("puts 'hi'", "ruby");
    expect(fired).toBe(0);
  });
});

describe("tokenizeSync", () => {
  beforeEach(() => {
    resetForTests();
  });

  afterAll(() => {
    resetForTests();
  });

  it("returns null when the lang has not been loaded yet", () => {
    expect(tokenizeSync("const x = 1;", "typescript")).toBeNull();
  });

  it("returns the memoised TokenLine[] once the lang is loaded", async () => {
    const async1: TokenLine[] = await tokenize("const x = 1;", "typescript");
    const sync1 = tokenizeSync("const x = 1;", "typescript");
    expect(sync1).toBe(async1);
  });

  it("returns plaintext chunks for an unknown lang (no async load needed)", () => {
    const sync = tokenizeSync("hello world", "klingon");
    expect(sync).not.toBeNull();
    expect(sync![0]!.chunks[0]!.text).toBe("hello world");
    expect(sync![0]!.chunks[0]!.color).toBeUndefined();
  });

  it("returns an empty array for empty content (any lang, no load needed)", () => {
    expect(tokenizeSync("", "typescript")).toEqual([]);
    expect(tokenizeSync("", "klingon")).toEqual([]);
  });
});
