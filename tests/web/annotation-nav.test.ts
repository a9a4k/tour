import { describe, it, expect } from "vitest";
import { nextAnnotationNavStep } from "../../src/web/client/annotation-nav.js";
import type { Annotation } from "../../src/web/client/types.js";

const ann = (over: Partial<Annotation> & Pick<Annotation, "id">): Annotation => ({
  id: over.id,
  file: over.file ?? "src/main.ts",
  side: over.side ?? "additions",
  line_start: over.line_start ?? 1,
  line_end: over.line_end ?? over.line_start ?? 1,
  body: over.body ?? "x",
  author: "u",
  author_kind: "human",
  created_at: "2026-05-10T00:00:00Z",
  ...over,
});

const A = ann({ id: "a1", file: "a.ts", side: "additions", line_start: 10 });
const B = ann({ id: "b1", file: "b.ts", side: "deletions", line_start: 7 });
const C = ann({ id: "c1", file: "c.ts", side: "additions", line_start: 22 });

describe("nextAnnotationNavStep: β-coupling on n (delta=+1)", () => {
  it("from the first annotation steps to the second + materializes cursor at its anchor", () => {
    const out = nextAnnotationNavStep({ topLevel: [A, B, C], currentIdx: 0, delta: 1 });
    expect(out).not.toBeNull();
    expect(out?.target.id).toBe("b1");
    expect(out?.cursor).toEqual({
      kind: "row",
      file: "b.ts",
      lineNumber: 7,
      side: "deletions",
      preferredSide: "deletions",
    });
  });

  it("from a middle annotation steps forward to the next", () => {
    const out = nextAnnotationNavStep({ topLevel: [A, B, C], currentIdx: 1, delta: 1 });
    expect(out?.target.id).toBe("c1");
    expect(out?.cursor.file).toBe("c.ts");
    expect(out?.cursor.lineNumber).toBe(22);
  });

  it("at the last annotation returns null (no nav, cursor stays put)", () => {
    const out = nextAnnotationNavStep({ topLevel: [A, B, C], currentIdx: 2, delta: 1 });
    expect(out).toBeNull();
  });
});

describe("nextAnnotationNavStep: β-coupling on p (delta=-1)", () => {
  it("from the last annotation steps to the previous + materializes cursor at its anchor", () => {
    const out = nextAnnotationNavStep({ topLevel: [A, B, C], currentIdx: 2, delta: -1 });
    expect(out?.target.id).toBe("b1");
    expect(out?.cursor).toEqual({
      kind: "row",
      file: "b.ts",
      lineNumber: 7,
      side: "deletions",
      preferredSide: "deletions",
    });
  });

  it("at the first annotation returns null (no nav, cursor stays put — preserves null when null)", () => {
    const out = nextAnnotationNavStep({ topLevel: [A, B, C], currentIdx: 0, delta: -1 });
    expect(out).toBeNull();
  });
});

describe("nextAnnotationNavStep: degenerate states", () => {
  it("currentIdx === -1 (no current selection / empty list) returns null", () => {
    expect(nextAnnotationNavStep({ topLevel: [], currentIdx: -1, delta: 1 })).toBeNull();
    expect(nextAnnotationNavStep({ topLevel: [], currentIdx: -1, delta: -1 })).toBeNull();
  });

  it("single-annotation list n is a no-op", () => {
    expect(
      nextAnnotationNavStep({ topLevel: [A], currentIdx: 0, delta: 1 }),
    ).toBeNull();
  });

  it("single-annotation list p is a no-op", () => {
    expect(
      nextAnnotationNavStep({ topLevel: [A], currentIdx: 0, delta: -1 }),
    ).toBeNull();
  });
});

describe("nextAnnotationNavStep: cursor coupling shape", () => {
  // The β-rule: preferredSide tracks the steered-toward side so a follow-up
  // j/k or `a` lands on the column the user just navigated to. This is what
  // makes "n then a" annotate the file the user just landed on, even when
  // the prior cursor was elsewhere or null.
  it("preferredSide always updates to the target Annotation's side", () => {
    // First navigation: target is on 'deletions' side
    const out1 = nextAnnotationNavStep({ topLevel: [A, B], currentIdx: 0, delta: 1 });
    expect(out1?.cursor.preferredSide).toBe("deletions");

    // Second navigation back: target is on 'additions' side
    const out2 = nextAnnotationNavStep({ topLevel: [A, B], currentIdx: 1, delta: -1 });
    expect(out2?.cursor.preferredSide).toBe("additions");
  });

  it("uses line_end (not line_start) for multi-line annotation cursor anchor (#170)", () => {
    const multi = ann({ id: "m1", file: "m.ts", side: "additions", line_start: 30, line_end: 45 });
    const out = nextAnnotationNavStep({ topLevel: [A, multi], currentIdx: 0, delta: 1 });
    expect(out?.cursor.lineNumber).toBe(45);
  });

  it("after `n` to a different file the cursor's file matches the target — `a` next opens the composer in that file", () => {
    // Cursor was previously on a.ts (or null); n to b.ts should move cursor to b.ts.
    const out = nextAnnotationNavStep({ topLevel: [A, B], currentIdx: 0, delta: 1 });
    expect(out?.cursor.file).toBe("b.ts");
    expect(out?.target.file).toBe("b.ts");
  });
});
