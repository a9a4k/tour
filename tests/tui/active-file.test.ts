import { describe, it, expect } from "vitest";
import {
  deriveActiveFile,
  collectFileCardOffsets,
} from "../../src/tui/active-file.js";
import type { ScrollBoxRenderable } from "@opentui/core";

type FakeNode = {
  id?: string;
  y?: number;
  height?: number;
  getChildren?: () => FakeNode[];
  updateFromLayout?: () => void;
};

function makeFakeScrollbox(
  viewportY: number,
  scrollTop: number,
  cards: ReadonlyArray<{ name: string; contentY: number; height: number }>,
): ScrollBoxRenderable {
  const children: FakeNode[] = cards.map((c) => ({
    id: `file-card-${c.name}`,
    y: viewportY + (c.contentY - scrollTop),
    height: c.height,
    getChildren: () => [],
  }));
  const content: FakeNode = {
    getChildren: () => children,
  };
  return {
    content,
    viewport: { y: viewportY, x: 0, width: 80, height: 30 },
    scrollTop,
  } as unknown as ScrollBoxRenderable;
}

// Pure derivation tested in isolation — no scrollbox, no opentui.
// The rule is: "last file card whose contentY ≤ scrollTop", with two
// fallbacks (above first → first; below last → last) and a null result
// for the empty case. Mirrors GitHub's "previous-file stays sticky
// until the next reaches the top" semantics.
describe("deriveActiveFile (issue #307 — active-file derivation for sticky pane-top header)", () => {
  it("returns null when the file list is empty", () => {
    expect(deriveActiveFile(0, [])).toBeNull();
    expect(deriveActiveFile(123, [])).toBeNull();
  });

  it("falls back to the first card when scrollTop is above the first card's top", () => {
    const cards = [
      { name: "a.ts", contentY: 10, height: 20 },
      { name: "b.ts", contentY: 40, height: 20 },
    ];
    // Above the first card's top edge (10) → first card.
    expect(deriveActiveFile(0, cards)).toBe("a.ts");
    expect(deriveActiveFile(9, cards)).toBe("a.ts");
  });

  it("returns the first card when scrollTop sits inside the first card", () => {
    const cards = [
      { name: "a.ts", contentY: 10, height: 20 }, // covers 10..29
      { name: "b.ts", contentY: 40, height: 20 },
    ];
    expect(deriveActiveFile(10, cards)).toBe("a.ts"); // top edge
    expect(deriveActiveFile(15, cards)).toBe("a.ts"); // middle
    expect(deriveActiveFile(29, cards)).toBe("a.ts"); // bottom-edge
  });

  it("returns the previous card when scrollTop sits in the gap between two cards", () => {
    // GitHub semantics: previous-file stays sticky until the NEXT file's
    // top edge crosses the viewport top.
    const cards = [
      { name: "a.ts", contentY: 10, height: 20 }, // 10..29
      { name: "b.ts", contentY: 40, height: 20 }, // 40..59
    ];
    expect(deriveActiveFile(30, cards)).toBe("a.ts"); // just past a's bottom
    expect(deriveActiveFile(35, cards)).toBe("a.ts"); // mid-gap
    expect(deriveActiveFile(39, cards)).toBe("a.ts"); // just before b's top
    expect(deriveActiveFile(40, cards)).toBe("b.ts"); // b's top edge → b becomes active
  });

  it("returns the middle card when scrollTop sits inside the middle card", () => {
    const cards = [
      { name: "a.ts", contentY: 10, height: 20 },
      { name: "b.ts", contentY: 40, height: 30 }, // 40..69
      { name: "c.ts", contentY: 80, height: 20 },
    ];
    expect(deriveActiveFile(40, cards)).toBe("b.ts");
    expect(deriveActiveFile(55, cards)).toBe("b.ts");
    expect(deriveActiveFile(69, cards)).toBe("b.ts");
  });

  it("returns the last card when scrollTop sits inside the last card", () => {
    const cards = [
      { name: "a.ts", contentY: 10, height: 20 },
      { name: "b.ts", contentY: 40, height: 20 },
      { name: "c.ts", contentY: 70, height: 20 }, // 70..89
    ];
    expect(deriveActiveFile(70, cards)).toBe("c.ts");
    expect(deriveActiveFile(80, cards)).toBe("c.ts");
    expect(deriveActiveFile(89, cards)).toBe("c.ts");
  });

  it("falls back to the last card when scrollTop is below the last card's bottom", () => {
    const cards = [
      { name: "a.ts", contentY: 10, height: 20 },
      { name: "b.ts", contentY: 40, height: 20 }, // ends at 60
    ];
    expect(deriveActiveFile(60, cards)).toBe("b.ts");
    expect(deriveActiveFile(100, cards)).toBe("b.ts"); // well below last card
    expect(deriveActiveFile(9999, cards)).toBe("b.ts");
  });

  it("handles a single-card list across all fallback ranges", () => {
    const cards = [{ name: "only.ts", contentY: 5, height: 10 }];
    expect(deriveActiveFile(0, cards)).toBe("only.ts"); // above
    expect(deriveActiveFile(5, cards)).toBe("only.ts"); // top edge
    expect(deriveActiveFile(10, cards)).toBe("only.ts"); // inside
    expect(deriveActiveFile(99, cards)).toBe("only.ts"); // below
  });
});

describe("collectFileCardOffsets", () => {
  it("translates screen-absolute child.y into content-y under a scrollbox", () => {
    // Header above scrollbox → viewport.y=5; user scrolled to scrollTop=100.
    // Three file cards at content positions 100/130/160 → screen 5/35/65.
    const viewportY = 5;
    const scrollTop = 100;
    const sb = makeFakeScrollbox(viewportY, scrollTop, [
      { name: "a.ts", contentY: 100, height: 30 },
      { name: "b.ts", contentY: 130, height: 30 },
      { name: "c.ts", contentY: 160, height: 30 },
    ]);
    const offsets = collectFileCardOffsets(sb, ["a.ts", "b.ts", "c.ts"]);
    expect(offsets).toEqual([
      { name: "a.ts", contentY: 100, height: 30 },
      { name: "b.ts", contentY: 130, height: 30 },
      { name: "c.ts", contentY: 160, height: 30 },
    ]);
  });

  it("returns results in `fileNames` order even if tree traversal yields a different order", () => {
    const viewportY = 0;
    const scrollTop = 0;
    const sb = makeFakeScrollbox(viewportY, scrollTop, [
      { name: "z.ts", contentY: 0, height: 10 },
      { name: "a.ts", contentY: 10, height: 10 },
    ]);
    const offsets = collectFileCardOffsets(sb, ["a.ts", "z.ts"]);
    expect(offsets.map((o) => o.name)).toEqual(["a.ts", "z.ts"]);
  });

  it("skips file names that don't resolve in the tree", () => {
    const sb = makeFakeScrollbox(0, 0, [
      { name: "a.ts", contentY: 0, height: 10 },
    ]);
    const offsets = collectFileCardOffsets(sb, ["a.ts", "missing.ts"]);
    expect(offsets).toEqual([{ name: "a.ts", contentY: 0, height: 10 }]);
  });

  it("integrates end-to-end with deriveActiveFile (scrolled mid-second-card)", () => {
    const viewportY = 5;
    const scrollTop = 45;
    const sb = makeFakeScrollbox(viewportY, scrollTop, [
      { name: "a.ts", contentY: 0, height: 30 }, // 0..29
      { name: "b.ts", contentY: 30, height: 30 }, // 30..59
      { name: "c.ts", contentY: 60, height: 30 },
    ]);
    const offsets = collectFileCardOffsets(sb, ["a.ts", "b.ts", "c.ts"]);
    expect(deriveActiveFile(scrollTop, offsets)).toBe("b.ts");
  });
});
