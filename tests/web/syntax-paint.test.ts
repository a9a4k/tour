import { describe, expect, it } from "vitest";
import { paintHtml } from "../../src/web/client/syntax-paint.js";
import type { TokenLine } from "../../src/core/syntax-highlight.js";

describe("paintHtml", () => {
  it("emits one <span> per chunk, with inline style for coloured chunks", () => {
    const line: TokenLine = {
      chunks: [
        { text: "const", color: "#FF7B72" },
        { text: " " },
        { text: "x", color: "#79C0FF" },
      ],
    };
    const html = paintHtml(line);
    expect(html).toBe(
      `<span style="color:#FF7B72">const</span><span> </span><span style="color:#79C0FF">x</span>`,
    );
  });

  it("encodes bold + italic + underline + colour on a single chunk", () => {
    const line: TokenLine = {
      chunks: [
        { text: "X", color: "#79C0FF", bold: true, italic: true, underline: true },
      ],
    };
    const html = paintHtml(line);
    expect(html).toBe(
      `<span style="color:#79C0FF;font-weight:bold;font-style:italic;text-decoration:underline">X</span>`,
    );
  });

  it("emits a styleless <span> for plain chunks", () => {
    const line: TokenLine = { chunks: [{ text: "hello" }] };
    expect(paintHtml(line)).toBe(`<span>hello</span>`);
  });

  it("HTML-escapes chunk text so user input cannot inject markup", () => {
    const line: TokenLine = {
      chunks: [{ text: `<script>alert("x")</script>` }],
    };
    const html = paintHtml(line);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });

  it("emits empty string for an empty chunks array", () => {
    expect(paintHtml({ chunks: [] })).toBe("");
  });
});
