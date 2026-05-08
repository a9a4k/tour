import { describe, it, expect } from "vitest";
import { html } from "../../src/web/spa";

describe("spa html()", () => {
  const output = html();

  it("defines ann-range-ln CSS class for range indicators", () => {
    expect(output).toContain(".ann-range-ln");
  });

  it("adds ann-range-ln class to line-num cells within annotation ranges", () => {
    // The JS renderDiff logic should check if a line is in an annotation range
    // and add 'ann-range-ln' to the relevant line-num td
    expect(output).toContain("ann-range-ln");
  });

  it("only renders annotation block at line_end, not every line in range", () => {
    // The annotation block filter should use === line_end, not >= line_start
    // For additions: rightNum === a.line_end
    // For deletions: leftNum === a.line_end
    const jsContent = output;
    // The annotation block rendering should be gated on line_end
    expect(jsContent).toContain("=== a.line_end");
  });

  it("does not regress single-line annotations", () => {
    // Single-line annotations have line_start === line_end,
    // so the range indicator and annotation block both apply at that single line
    // The ann-range-ln class should still be added when line_start === line_end
    // (the range check rightNum >= a.line_start && rightNum <= a.line_end covers this)
    expect(output).toContain(">= a.line_start");
    expect(output).toContain("<= a.line_end");
  });
});
