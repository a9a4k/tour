import { describe, it, expect } from "vitest";
import {
  reducePaneFocus,
  autoFlipPaneFocus,
  seedPaneFocus,
  type PaneFocus,
  type AutoFlipActionKind,
} from "../../src/core/pane-focus-state.js";

// PRD #343 / ADR 0031 — slice 1 (issue #344).
// The `paneFocus: "sidebar" | "diff"` slice lives in core/ and is the
// cross-surface successor to the TUI's `sidebarFocused` boolean. This
// test locks the reducer's three transitions, the auto-flip matrix that
// drives surface-side `paneFocus.*` dispatch on action keys, and the
// seed-effect conditional used at bundle-load time.

describe("reducePaneFocus", () => {
  it("paneFocus.setSidebar moves diff → sidebar", () => {
    expect(reducePaneFocus("diff", { type: "paneFocus.setSidebar" })).toBe("sidebar");
  });

  it("paneFocus.setSidebar is idempotent on sidebar", () => {
    expect(reducePaneFocus("sidebar", { type: "paneFocus.setSidebar" })).toBe("sidebar");
  });

  it("paneFocus.setDiff moves sidebar → diff", () => {
    expect(reducePaneFocus("sidebar", { type: "paneFocus.setDiff" })).toBe("diff");
  });

  it("paneFocus.setDiff is idempotent on diff", () => {
    expect(reducePaneFocus("diff", { type: "paneFocus.setDiff" })).toBe("diff");
  });

  it("paneFocus.toggle flips sidebar → diff", () => {
    expect(reducePaneFocus("sidebar", { type: "paneFocus.toggle" })).toBe("diff");
  });

  it("paneFocus.toggle flips diff → sidebar", () => {
    expect(reducePaneFocus("diff", { type: "paneFocus.toggle" })).toBe("sidebar");
  });
});

describe("autoFlipPaneFocus — action's target pane drives the flip", () => {
  // Actions whose target is the diff pane: comment-jump (n/p), click on
  // a diff row / card, and Enter on a sidebar file row (commit + flip).
  const toDiff: AutoFlipActionKind[] = ["comment-jump", "click-diff", "select-file"];
  for (const kind of toDiff) {
    it(`${kind} flips sidebar → diff`, () => {
      expect(autoFlipPaneFocus(kind, "sidebar")).toBe("diff");
    });
    it(`${kind} is a no-flip when already on diff`, () => {
      expect(autoFlipPaneFocus(kind, "diff")).toBeNull();
    });
  }

  it("click-sidebar flips diff → sidebar", () => {
    expect(autoFlipPaneFocus("click-sidebar", "diff")).toBe("sidebar");
  });

  it("click-sidebar is a no-flip when already on sidebar", () => {
    expect(autoFlipPaneFocus("click-sidebar", "sidebar")).toBeNull();
  });

  // Pane-agnostic actions (`t`/`L`/`e`/`y`/`q`) and pane-internal motion
  // (j/k/h/l, folder toggle/expand/collapse, cursor motion) never flip.
  const noFlip: AutoFlipActionKind[] = [
    "open-picker",
    "toggle-layout",
    "expand-file-all",
    "yank-file-path",
    "quit",
    "toggle-folder",
    "expand-folder",
    "collapse-folder",
    "collapse-parent",
    "move-file-up",
    "move-file-down",
    "cursor-up",
    "cursor-down",
    "cursor-side-left",
    "cursor-side-right",
  ];
  for (const kind of noFlip) {
    it(`${kind} never flips from sidebar`, () => {
      expect(autoFlipPaneFocus(kind, "sidebar")).toBeNull();
    });
    it(`${kind} never flips from diff`, () => {
      expect(autoFlipPaneFocus(kind, "diff")).toBeNull();
    });
  }
});

describe("seedPaneFocus — bundle.loaded seed-effect conditional", () => {
  // PRD #343: Tour with Comments → diff (cursor seeds at first Comment
  // via the existing initialCursor helper); Tour with no Comments →
  // sidebar (cursor stays null; sidebar lands at first file row).
  it("returns 'diff' when the Tour has at least one top-level Comment", () => {
    expect(seedPaneFocus(true)).toBe("diff");
  });

  it("returns 'sidebar' when the Tour has no top-level Comments", () => {
    expect(seedPaneFocus(false)).toBe("sidebar");
  });
});
