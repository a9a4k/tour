import { describe, it, expect } from "vitest";
import {
  toPierreLineAnnotations,
  buildRangeBackgroundCSS,
  resolveCursorById,
} from "../../src/web/client/annotations.js";
import type { Annotation } from "../../src/web/client/types.js";

const ann = (over: Partial<Annotation>): Annotation => ({
  id: "a1",
  file: "src/main.ts",
  side: "additions",
  line_start: 1,
  line_end: 1,
  body: "looks good",
  author: "agent",
  created_at: "2026-05-08T00:00:00Z",
  ...over,
});

describe("toPierreLineAnnotations", () => {
  it("filters by file path", () => {
    const out = toPierreLineAnnotations(
      [ann({ file: "a.ts" }), ann({ id: "a2", file: "b.ts" })],
      "a.ts",
    );
    expect(out).toHaveLength(1);
    expect(out[0].metadata.annotation.file).toBe("a.ts");
  });

  it("preserves the annotation side as Pierre's AnnotationSide", () => {
    const out = toPierreLineAnnotations([ann({ side: "deletions" })], "src/main.ts");
    expect(out[0].side).toBe("deletions");
  });

  it("anchors a single-line annotation at its only line with isAnchor=true", () => {
    const out = toPierreLineAnnotations(
      [ann({ line_start: 7, line_end: 7 })],
      "src/main.ts",
    );
    expect(out).toEqual([
      expect.objectContaining({ lineNumber: 7, metadata: expect.objectContaining({ isAnchor: true }) }),
    ]);
  });

  it("expands a multi-line annotation into one entry per line in the range", () => {
    const out = toPierreLineAnnotations(
      [ann({ line_start: 5, line_end: 8 })],
      "src/main.ts",
    );
    expect(out.map((e) => e.lineNumber)).toEqual([5, 6, 7, 8]);
  });

  it("marks only the LAST line as the anchor for a multi-line range (GitHub-style)", () => {
    const out = toPierreLineAnnotations(
      [ann({ line_start: 5, line_end: 8 })],
      "src/main.ts",
    );
    const anchors = out.filter((e) => e.metadata.isAnchor);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].lineNumber).toBe(8);
  });

  it("threads the same source annotation through every metadata entry in the range", () => {
    const source = ann({ line_start: 5, line_end: 7, body: "shared body" });
    const out = toPierreLineAnnotations([source], "src/main.ts");
    for (const entry of out) {
      expect(entry.metadata.annotation).toBe(source);
    }
  });
});

describe("buildRangeBackgroundCSS", () => {
  it("returns empty string when no annotations match the file", () => {
    expect(buildRangeBackgroundCSS([ann({ file: "other.ts" })], "src/main.ts")).toBe("");
  });

  it("returns empty string when only single-line annotations exist", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ line_start: 5, line_end: 5 }), ann({ id: "a2", line_start: 9, line_end: 9 })],
      "src/main.ts",
    );
    expect(css).toBe("");
  });

  it("emits a [data-line] selector for every line in a multi-line additions range", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ side: "additions", line_start: 5, line_end: 7 })],
      "src/main.ts",
    );
    expect(css).toContain('[data-line="5"]');
    expect(css).toContain('[data-line="6"]');
    expect(css).toContain('[data-line="7"]');
    expect(css).toContain("addition");
  });

  it("emits a [data-line] selector for every line in a multi-line deletions range", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ side: "deletions", line_start: 10, line_end: 12 })],
      "src/main.ts",
    );
    expect(css).toContain('[data-line="10"]');
    expect(css).toContain('[data-line="11"]');
    expect(css).toContain('[data-line="12"]');
    expect(css).toContain("deletion");
  });

  it("filters annotations by file path", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ file: "other.ts", line_start: 1, line_end: 9 })],
      "src/main.ts",
    );
    expect(css).toBe("");
  });

  it("emits a 3px accent gutter stripe alongside the tint for additions ranges", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ side: "additions", line_start: 5, line_end: 7 })],
      "src/main.ts",
    );
    expect(css).toContain("box-shadow: inset 3px 0 0 #58a6ff");
    expect(css).toContain("addition");
  });

  it("emits the same accent gutter stripe for deletions ranges", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ side: "deletions", line_start: 3, line_end: 4 })],
      "src/main.ts",
    );
    expect(css).toContain("box-shadow: inset 3px 0 0 #58a6ff");
    expect(css).toContain("deletion");
  });

  it("preserves the existing tint when emitting the gutter stripe", () => {
    const css = buildRangeBackgroundCSS(
      [ann({ side: "additions", line_start: 1, line_end: 2 })],
      "src/main.ts",
    );
    expect(css).toContain("background-image");
    expect(css).toContain("rgba(88, 166, 255, 0.12)");
    expect(css).toContain("box-shadow");
  });
});

describe("resolveCursorById", () => {
  it("returns -1 for an empty list (no cursor)", () => {
    expect(resolveCursorById([], "a1")).toBe(-1);
    expect(resolveCursorById([], null)).toBe(-1);
  });

  it("returns 0 when prevId is null (initial state with annotations)", () => {
    expect(resolveCursorById([ann({ id: "a1" }), ann({ id: "a2" })], null)).toBe(0);
  });

  it("preserves the cursor id by relocating to its new index after a prepend", () => {
    const before = [ann({ id: "a1" }), ann({ id: "a2" })];
    const after = [ann({ id: "a0" }), ann({ id: "a1" }), ann({ id: "a2" })];
    expect(resolveCursorById(before, "a2")).toBe(1);
    expect(resolveCursorById(after, "a2")).toBe(2);
  });

  it("preserves the cursor index after an append (id still resolves)", () => {
    const before = [ann({ id: "a1" }), ann({ id: "a2" })];
    const after = [ann({ id: "a1" }), ann({ id: "a2" }), ann({ id: "a3" })];
    expect(resolveCursorById(before, "a2")).toBe(1);
    expect(resolveCursorById(after, "a2")).toBe(1);
  });

  it("resets to 0 when the cursor id is no longer present", () => {
    expect(
      resolveCursorById([ann({ id: "a1" }), ann({ id: "a2" })], "missing"),
    ).toBe(0);
  });
});
