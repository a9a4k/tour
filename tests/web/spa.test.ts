import { describe, it, expect } from "vitest";
import { html } from "../../src/web/spa";

describe("spa html()", () => {
  const output = html();

  it("defines ann-range-ln CSS class for range indicators", () => {
    expect(output).toContain(".ann-range-ln");
  });

  it("only renders annotation block at line_end, not every line in range", () => {
    expect(output).toContain("=== a.line_end");
  });

  it("does not regress single-line annotations", () => {
    expect(output).toContain(">= a.line_start");
    expect(output).toContain("<= a.line_end");
  });
});
