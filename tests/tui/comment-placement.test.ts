import { describe, it, expect } from "vitest";
import { commentCardSlot } from "../../src/tui/comment-placement.js";

describe("commentCardSlot", () => {
  it("returns 'full' in unified layout regardless of side", () => {
    expect(commentCardSlot("unified", "additions")).toBe("full");
    expect(commentCardSlot("unified", "deletions")).toBe("full");
  });

  it("anchors additions-side cards to the right column in split layout", () => {
    expect(commentCardSlot("split", "additions")).toBe("right");
  });

  it("anchors deletions-side cards to the left column in split layout", () => {
    expect(commentCardSlot("split", "deletions")).toBe("left");
  });
});
