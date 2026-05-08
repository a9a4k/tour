import { describe, it, expect } from "vitest";
import { generateId, parseIdTimestamp } from "../../src/core/ids.js";

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
