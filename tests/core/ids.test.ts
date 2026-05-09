import { describe, it, expect } from "vitest";
import { generateId, parseIdTimestamp, shortId } from "../../src/core/ids.js";

describe("generateId", () => {
  it("produces format YYYY-MM-DD-HHMMSS-xxxx", () => {
    const id = generateId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/);
  });

  it("is sortable by creation time", () => {
    const a = generateId({ now: new Date("2026-01-01T00:00:00Z") });
    const b = generateId({ now: new Date("2026-01-01T00:00:01Z") });
    const c = generateId({ now: new Date("2026-01-02T12:30:00Z") });
    const sorted = [c, a, b].sort();
    expect(sorted).toEqual([a, b, c]);
  });

  it("produces unique suffixes across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("returns deterministic output with a seed", () => {
    const a = generateId({ seed: 42 });
    const b = generateId({ seed: 42 });
    expect(a.slice(-4)).toBe(b.slice(-4));
  });

  it("timestamp portion reflects current time", () => {
    const before = new Date();
    const id = generateId();
    const after = new Date();
    const ts = parseIdTimestamp(id);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});

describe("parseIdTimestamp", () => {
  it("round-trips through generateId", () => {
    const id = generateId();
    const ts = parseIdTimestamp(id);
    expect(ts).toBeInstanceOf(Date);
    expect(ts.getTime()).not.toBeNaN();
  });
});

describe("shortId", () => {
  it("returns the 4-char random suffix of a canonical Tour id", () => {
    expect(shortId("2026-05-09-113738-u35e")).toBe("u35e");
  });

  it("returns the trailing chars after the last `-` for canonical ids regardless of date drift", () => {
    expect(shortId("2030-12-31-235959-abcd")).toBe("abcd");
  });

  it("falls back to the last 4 chars when the input is non-canonical", () => {
    expect(shortId("abcdef")).toBe("cdef");
  });

  it("returns empty string for empty input", () => {
    expect(shortId("")).toBe("");
  });

  it("returns the whole string when shorter than 4 chars and uncontaining `-`", () => {
    expect(shortId("ab")).toBe("ab");
  });

  it("round-trips with generateId — every generated id yields a 4-char shortId", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      const s = shortId(id);
      expect(s).toMatch(/^[a-z0-9]{4}$/);
    }
  });
});
