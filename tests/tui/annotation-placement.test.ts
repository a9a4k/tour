import { describe, it, expect } from "vitest";
import { annotationCardSlot } from "../../src/tui/annotation-placement.js";

describe("annotationCardSlot", () => {
  it("returns 'full' in unified layout regardless of side", () => {
    expect(annotationCardSlot("unified", "additions")).toBe("full");
    expect(annotationCardSlot("unified", "deletions")).toBe("full");
  });

  it("anchors additions-side cards to the right column in split layout", () => {
    expect(annotationCardSlot("split", "additions")).toBe("right");
  });

  it("anchors deletions-side cards to the left column in split layout", () => {
    expect(annotationCardSlot("split", "deletions")).toBe("left");
  });
});
