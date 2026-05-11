import { describe, it, expect } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import {
  folderRowLabel,
  fileRowLabel,
  folderRowFixedCost,
  fileRowFixedCost,
} from "../../src/tui/sidebar-row-label.js";

// Sidebar row label composition. Asserts the full composed label string,
// including indent, prefix glyph / icon, name, badge, and trailing space.
// The `nameBudget` parameter drives middle-truncation of the name slot
// only; the rest of the row stays unchanged. `folderRowFixedCost` and
// `fileRowFixedCost` give the caller the per-row decoration width so it
// can subtract from the sidebar content width without duplicating the
// constants.

function folder(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "folder" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "folder" }> {
  return {
    kind: "folder",
    path: "src",
    displayName: "src",
    depth: 0,
    hasChildren: true,
    annotationCount: 0,
    collapsed: false,
    ...overrides,
  };
}

function file(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "file" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "file" }> {
  const f: DiffFile = { name: "src/a.ts", type: "change", hunks: [] };
  return {
    kind: "file",
    path: "src/a.ts",
    displayName: "a.ts",
    depth: 0,
    file: f,
    annotationCount: 0,
    ...overrides,
  };
}

describe("folderRowLabel", () => {
  it("renders a short folder name untouched with leading + trailing space and expanded caret", () => {
    expect(folderRowLabel(folder({ displayName: "src", collapsed: false }), 100))
      .toBe(" ▾ src ");
  });

  it("uses the collapsed caret '▸' when row.collapsed is true", () => {
    expect(folderRowLabel(folder({ displayName: "src", collapsed: true }), 100))
      .toBe(" ▸ src ");
  });

  it("indents two spaces per depth", () => {
    expect(folderRowLabel(folder({ displayName: "deep", depth: 3 }), 100))
      .toBe("       ▾ deep ");
  });

  it("truncates the name slot to the supplied budget, leaving the rest intact", () => {
    // Sidebar content width 28, fixed cost at depth 0 = 4 → name budget 24.
    const row = folder({ displayName: "supabase/migrations/20260508144406", depth: 0 });
    const out = folderRowLabel(row, 28 - folderRowFixedCost(row));
    expect(out.length).toBe(28);
    expect(out.startsWith(" ▾ ")).toBe(true);
    expect(out.endsWith(" ")).toBe(true);
    expect(out).toContain("…");
  });

  it("never exceeds the sidebar content width regardless of name length", () => {
    const row = folder({ displayName: "a".repeat(100), depth: 2 });
    const out = folderRowLabel(row, 28 - folderRowFixedCost(row));
    expect(out.length).toBe(28);
  });
});

describe("fileRowLabel", () => {
  it("renders a short file untouched with leading + trailing space and status icon", () => {
    expect(fileRowLabel(file({ displayName: "a.ts" }), 100))
      .toBe(" M a.ts ");
  });

  it("indents two spaces per depth", () => {
    expect(fileRowLabel(file({ displayName: "a.ts", depth: 2 }), 100))
      .toBe("     M a.ts ");
  });

  it("appends [N] badge when annotationCount > 0", () => {
    expect(fileRowLabel(file({ displayName: "a.ts", annotationCount: 3 }), 100))
      .toBe(" M a.ts [3] ");
  });

  it("uses the file.type to derive the status icon (A for add)", () => {
    const f: DiffFile = { name: "src/a.ts", type: "add", hunks: [] };
    const row = file({ displayName: "a.ts", file: f });
    expect(fileRowLabel(row, 100)).toBe(" A a.ts ");
  });

  it("truncates the name slot when over budget, leaving icon + badge intact", () => {
    const row = file({
      displayName: "evses-utilization.controller.spec.ts",
      annotationCount: 3,
    });
    const out = fileRowLabel(row, 28 - fileRowFixedCost(row));
    expect(out.length).toBe(28);
    expect(out.startsWith(" M ")).toBe(true);
    expect(out.endsWith(" [3] ")).toBe(true);
    expect(out).toContain("…");
  });

  it("never exceeds the sidebar content width regardless of name length", () => {
    const row = file({
      displayName: "a".repeat(100),
      depth: 4,
      annotationCount: 12,
    });
    const out = fileRowLabel(row, 28 - fileRowFixedCost(row));
    expect(out.length).toBe(28);
  });
});

describe("folderRowFixedCost", () => {
  it("at depth 0: leading(1) + caret(1) + space(1) + trailing(1) = 4", () => {
    expect(folderRowFixedCost(folder({ depth: 0 }))).toBe(4);
  });

  it("adds 2 columns per depth level", () => {
    expect(folderRowFixedCost(folder({ depth: 3 }))).toBe(4 + 6);
  });

  it("is independent of caret direction (collapsed vs expanded)", () => {
    expect(folderRowFixedCost(folder({ collapsed: true }))).toBe(
      folderRowFixedCost(folder({ collapsed: false })),
    );
  });
});

describe("fileRowFixedCost", () => {
  it("at depth 0 with no badge: leading(1) + icon(1) + space(1) + trailing(1) = 4", () => {
    expect(fileRowFixedCost(file({ depth: 0, annotationCount: 0 }))).toBe(4);
  });

  it("adds 2 columns per depth level", () => {
    expect(fileRowFixedCost(file({ depth: 2, annotationCount: 0 }))).toBe(4 + 4);
  });

  it("adds the badge width ' [N]' when annotationCount > 0", () => {
    // base 4 + " [3]" = 4 chars added.
    expect(fileRowFixedCost(file({ depth: 0, annotationCount: 3 }))).toBe(4 + 4);
    // base 4 + " [12]" = 5 chars added.
    expect(fileRowFixedCost(file({ depth: 0, annotationCount: 12 }))).toBe(4 + 5);
  });
});
