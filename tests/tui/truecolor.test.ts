import { describe, expect, it } from "vitest";
import { isTruecolorTerminal } from "../../src/tui/truecolor.js";

describe("isTruecolorTerminal", () => {
  it("returns true when COLORTERM=truecolor", () => {
    expect(isTruecolorTerminal({ COLORTERM: "truecolor" })).toBe(true);
  });

  it("returns true when COLORTERM=24bit", () => {
    expect(isTruecolorTerminal({ COLORTERM: "24bit" })).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isTruecolorTerminal({ COLORTERM: "TRUECOLOR" })).toBe(true);
    expect(isTruecolorTerminal({ COLORTERM: "24BIT" })).toBe(true);
  });

  it("returns false when COLORTERM is unset", () => {
    expect(isTruecolorTerminal({})).toBe(false);
  });

  it("returns false when COLORTERM is set to a non-truecolor value", () => {
    expect(isTruecolorTerminal({ COLORTERM: "8bit" })).toBe(false);
    expect(isTruecolorTerminal({ COLORTERM: "256color" })).toBe(false);
  });
});
