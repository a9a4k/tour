import { describe, it, expect } from "vitest";
import { middleTruncate } from "../../src/core/middle-truncate.js";

// Pure middle-truncation helper (issue #156). Asserts observable behaviour
// at the function's interface — the returned string — only.

describe("middleTruncate", () => {
  it("returns the input unchanged when shorter than the budget", () => {
    expect(middleTruncate("abc", 10)).toBe("abc");
  });

  it("returns the input unchanged when exactly the budget", () => {
    expect(middleTruncate("abcdef", 6)).toBe("abcdef");
  });

  it("truncates with a middle ellipsis when one character over the budget", () => {
    const out = middleTruncate("abcdefg", 6);
    expect(out.length).toBe(6);
    expect(out).toContain("…");
  });

  it("produces a string of exactly the budget width on a long even budget", () => {
    const out = middleTruncate("supabase/migrations/20260508144406_setup_public_api.sql", 20);
    expect(out.length).toBe(20);
    expect(out).toContain("…");
    expect(out[0]).toBe("s");
    expect(out.at(-1)).toBe("l");
  });

  it("produces a string of exactly the budget width on a long odd budget", () => {
    const out = middleTruncate("supabase/migrations/20260508144406_setup_public_api.sql", 21);
    expect(out.length).toBe(21);
    expect(out).toContain("…");
    expect(out[0]).toBe("s");
    expect(out.at(-1)).toBe("l");
  });

  it("returns just the ellipsis when budget is 1 and input is longer", () => {
    expect(middleTruncate("abcdef", 1)).toBe("…");
  });

  it("returns just the ellipsis when budget is 2 and input is longer", () => {
    const out = middleTruncate("abcdef", 2);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out).toContain("…");
  });

  it("returns the empty string when budget is 0", () => {
    expect(middleTruncate("abcdef", 0)).toBe("");
  });

  it("returns the empty string when budget is negative", () => {
    expect(middleTruncate("abcdef", -3)).toBe("");
  });

  it("preserves the first and last characters when budget ≥ 3", () => {
    for (const input of [
      "evses-utilization.controller.spec.ts",
      "supabase/migrations/20260508144406_setup_public_api.sql",
      "x".repeat(50) + "Y",
    ]) {
      for (const budget of [3, 5, 8, 17, 24]) {
        const out = middleTruncate(input, budget);
        expect(out.length).toBeLessThanOrEqual(budget);
        if (input.length > budget) {
          expect(out[0]).toBe(input[0]);
          expect(out.at(-1)).toBe(input.at(-1));
          expect(out).toContain("…");
        }
      }
    }
  });

  it("handles single-character input safely", () => {
    expect(middleTruncate("a", 0)).toBe("");
    expect(middleTruncate("a", 1)).toBe("a");
    expect(middleTruncate("a", 5)).toBe("a");
  });

  it("does not split surrogate pairs", () => {
    // A single emoji is two UTF-16 code units but one user-perceived char.
    // Truncation should never emit a lone surrogate half.
    const input = "ab🎉cd🎉ef🎉gh";
    for (const budget of [3, 4, 5, 6, 7, 8]) {
      const out = middleTruncate(input, budget);
      // No unpaired surrogate halves.
      for (let i = 0; i < out.length; i++) {
        const code = out.charCodeAt(i);
        const isHigh = code >= 0xd800 && code <= 0xdbff;
        const isLow = code >= 0xdc00 && code <= 0xdfff;
        if (isHigh) {
          const next = out.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          i++;
        } else {
          expect(isLow).toBe(false);
        }
      }
    }
  });
});
