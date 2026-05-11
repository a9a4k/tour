import { describe, it, expect } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import {
  folderRowLabel,
  fileRowLabel,
} from "../../src/tui/sidebar-row-label.js";

// Sidebar row label composition (issue #156). Asserts the full composed
// label string, including indent, prefix glyph / icon, name, badge, and
// trailing space. The `nameBudget` parameter drives middle-truncation of
// the name slot only; the rest of the row stays unchanged.

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

  it("truncates the name slot when the budget is exceeded but leaves the rest intact", () => {
    const out = folderRowLabel(
      folder({ displayName: "supabase/migrations/20260508144406", depth: 0 }),
      // sidebar content width 28: leading(1) + caret(1) + space(1) + name + trailing(1) = name budget 24
      28,
    );
    expect(out.length).toBe(28);
    expect(out.startsWith(" ▾ ")).toBe(true);
    expect(out.endsWith(" ")).toBe(true);
    expect(out).toContain("…");
  });

  it("never exceeds the sidebar content width regardless of name length", () => {
    const out = folderRowLabel(
      folder({ displayName: "a".repeat(100), depth: 2 }),
      28,
    );
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
    const out = fileRowLabel(
      file({
        displayName: "evses-utilization.controller.spec.ts",
        annotationCount: 3,
      }),
      28,
    );
    expect(out.length).toBe(28);
    expect(out.startsWith(" M ")).toBe(true);
    expect(out.endsWith(" [3] ")).toBe(true);
    expect(out).toContain("…");
  });

  it("never exceeds the sidebar content width regardless of name length", () => {
    const out = fileRowLabel(
      file({
        displayName: "a".repeat(100),
        depth: 4,
        annotationCount: 12,
      }),
      28,
    );
    expect(out.length).toBe(28);
  });
});
