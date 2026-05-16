import { describe, expect, it, vi } from "vitest";

// `@opentui/core` boots yoga-layout (WASM) at module-init, which the
// vitest harness can't load. Re-implement the small slice the paint
// adapter touches — `StyledText`, `fg`, `bold`, `italic`, `underline`
// — with the same attribute-bitmask + `__isChunk` contract the real
// module exports. The TextAttributes bits (BOLD=1, ITALIC=4,
// UNDERLINE=8) match `node_modules/@opentui/core/index-*.js`.
vi.mock("@opentui/core", () => {
  class StyledText {
    chunks: unknown[];
    constructor(chunks: unknown[]) {
      this.chunks = chunks;
    }
  }
  const BOLD = 1, ITALIC = 4, UNDERLINE = 8;
  type Chunk = {
    __isChunk: true;
    text: string;
    fg?: { color: string };
    attributes?: number;
  };
  function applyStyle(
    input: Chunk | string,
    style: { fg?: string; bold?: boolean; italic?: boolean; underline?: boolean },
  ): Chunk {
    const existing: Chunk =
      typeof input === "object" && "__isChunk" in input
        ? input
        : { __isChunk: true, text: String(input) };
    const fg = style.fg ? { color: style.fg } : existing.fg;
    let attrs = existing.attributes ?? 0;
    if (style.bold) attrs |= BOLD;
    if (style.italic) attrs |= ITALIC;
    if (style.underline) attrs |= UNDERLINE;
    return { __isChunk: true, text: existing.text, fg, attributes: attrs };
  }
  return {
    StyledText,
    bold: (i: Chunk | string) => applyStyle(i, { bold: true }),
    italic: (i: Chunk | string) => applyStyle(i, { italic: true }),
    underline: (i: Chunk | string) => applyStyle(i, { underline: true }),
    fg: (color: string) => (i: Chunk | string) => applyStyle(i, { fg: color }),
  };
});

import { paintStyledText } from "../../src/tui/syntax-paint.js";
import type { TokenLine } from "../../src/core/syntax-highlight.js";

const BOLD = 1, ITALIC = 4, UNDERLINE = 8;

interface Chunk {
  __isChunk: true;
  text: string;
  fg?: { color: string };
  attributes?: number;
}
interface Styled {
  chunks: Chunk[];
}

describe("paintStyledText", () => {
  it("emits a StyledText whose first chunk carries the expected fg + bold+italic+underline attributes", () => {
    const line: TokenLine = {
      chunks: [
        { text: "Foo", color: "#FFA657", bold: true, italic: true, underline: true },
      ],
    };
    const out = paintStyledText(line) as unknown as Styled;
    expect(out.chunks).toHaveLength(1);
    const c = out.chunks[0]!;
    expect(c.text).toBe("Foo");
    expect(c.fg?.color).toBe("#FFA657");
    expect(c.attributes).toBe(BOLD | ITALIC | UNDERLINE);
  });

  it("emits one TextChunk per TokenChunk in order", () => {
    const line: TokenLine = {
      chunks: [
        { text: "const", color: "#FF7B72" },
        { text: " " },
        { text: "x", color: "#79C0FF" },
      ],
    };
    const out = paintStyledText(line) as unknown as Styled;
    expect(out.chunks).toHaveLength(3);
    expect(out.chunks[0]!.text).toBe("const");
    expect(out.chunks[1]!.text).toBe(" ");
    expect(out.chunks[2]!.text).toBe("x");
    expect(out.chunks[0]!.fg?.color).toBe("#FF7B72");
    expect(out.chunks[2]!.fg?.color).toBe("#79C0FF");
  });

  it("emits a colourless plain chunk for a TokenChunk with no styles", () => {
    const line: TokenLine = { chunks: [{ text: "hello" }] };
    const out = paintStyledText(line) as unknown as Styled;
    expect(out.chunks).toHaveLength(1);
    const c = out.chunks[0]!;
    expect(c.text).toBe("hello");
    expect(c.fg).toBeUndefined();
    // No styles applied → no attribute bits set.
    expect((c.attributes ?? 0) & (BOLD | ITALIC | UNDERLINE)).toBe(0);
  });

  it("emits italic-only attributes for a comment-overlay chunk (no bold/underline/colour)", () => {
    const line: TokenLine = {
      chunks: [{ text: "// hi", color: "#8B949E", italic: true }],
    };
    const out = paintStyledText(line) as unknown as Styled;
    const c = out.chunks[0]!;
    expect(c.fg?.color).toBe("#8B949E");
    expect(c.attributes! & ITALIC).toBe(ITALIC);
    expect(c.attributes! & BOLD).toBe(0);
    expect(c.attributes! & UNDERLINE).toBe(0);
  });

  it("emits an empty StyledText for an empty chunks array", () => {
    const out = paintStyledText({ chunks: [] }) as unknown as Styled;
    expect(out.chunks).toHaveLength(0);
  });
});
