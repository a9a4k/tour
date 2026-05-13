import { describe, it, expect } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import {
  folderRowLabel,
  fileRowSegments,
  folderRowFixedCost,
  fileRowFixedCost,
} from "../../src/tui/sidebar-row-label.js";

// Sidebar row label composition. Asserts the full composed label string,
// including indent, prefix glyph / icon, name, badge, and trailing space.
// The `nameBudget` parameter drives middle-truncation of the name slot
// only; the rest of the row stays unchanged. `folderRowFixedCost` and
// `fileRowFixedCost` give the caller the per-row decoration width so it
// can subtract from the sidebar content width without duplicating the
// constants. `fileRowSegments` (issue #265) returns a structured set of
// segments so the caller can paint `+N` in `theme.fg.success` and `-M`
// in `theme.fg.danger` while keeping the rest of the row in the default
// foreground.

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

const NO_STATS = { additions: 0, deletions: 0 };

function fullLabel(segs: ReturnType<typeof fileRowSegments>): string {
  return segs.leading + segs.additions + segs.deletions + segs.badge + segs.trailing;
}

describe("fileRowSegments (issue #265)", () => {
  it("renders a short file as a single leading segment with no stats and no badge", () => {
    expect(fileRowSegments(file({ displayName: "a.ts" }), NO_STATS, 100))
      .toEqual({
        leading: " M a.ts",
        additions: "",
        deletions: "",
        badge: "",
        trailing: " ",
      });
  });

  it("indents two spaces per depth on the leading segment", () => {
    const out = fileRowSegments(file({ displayName: "a.ts", depth: 2 }), NO_STATS, 100);
    expect(out.leading).toBe("     M a.ts");
  });

  it("appends [N] badge segment when annotationCount > 0", () => {
    const out = fileRowSegments(file({ displayName: "a.ts", annotationCount: 3 }), NO_STATS, 100);
    expect(out.badge).toBe(" [3]");
    expect(fullLabel(out)).toBe(" M a.ts [3] ");
  });

  it("uses the file.type to derive the status icon (A for add)", () => {
    const f: DiffFile = { name: "src/a.ts", type: "add", hunks: [] };
    const row = file({ displayName: "a.ts", file: f });
    expect(fileRowSegments(row, NO_STATS, 100).leading).toBe(" A a.ts");
  });

  it("emits ' +N' on additions and ' -M' on deletions when both > 0 (mixed change rows)", () => {
    const out = fileRowSegments(
      file({ displayName: "a.ts" }),
      { additions: 43, deletions: 27 },
      100,
    );
    expect(out.additions).toBe(" +43");
    expect(out.deletions).toBe(" -27");
    expect(fullLabel(out)).toBe(" M a.ts +43 -27 ");
  });

  it("omits ' +N' when additions === 0 (deletion-only file)", () => {
    const out = fileRowSegments(
      file({ displayName: "a.ts" }),
      { additions: 0, deletions: 27 },
      100,
    );
    expect(out.additions).toBe("");
    expect(out.deletions).toBe(" -27");
    expect(fullLabel(out)).toBe(" M a.ts -27 ");
  });

  it("omits ' -M' when deletions === 0 (addition-only file)", () => {
    const out = fileRowSegments(
      file({ displayName: "a.ts" }),
      { additions: 43, deletions: 0 },
      100,
    );
    expect(out.additions).toBe(" +43");
    expect(out.deletions).toBe("");
    expect(fullLabel(out)).toBe(" M a.ts +43 ");
  });

  it("emits no stats segments when additions === 0 AND deletions === 0 (pure-rename, no content change)", () => {
    const f: DiffFile = { name: "src/a.ts", type: "rename-pure", hunks: [] };
    const row = file({ displayName: "a.ts -> b.ts", file: f });
    const out = fileRowSegments(row, NO_STATS, 100);
    expect(out.additions).toBe("");
    expect(out.deletions).toBe("");
  });

  it("places stats after the filename and before the annotation badge", () => {
    const out = fileRowSegments(
      file({ displayName: "a.ts", annotationCount: 3 }),
      { additions: 43, deletions: 27 },
      100,
    );
    expect(fullLabel(out)).toBe(" M a.ts +43 -27 [3] ");
  });

  it("truncates the name slot when over budget, leaving stats + badge intact after the truncated name", () => {
    const row = file({
      displayName: "evses-utilization.controller.spec.ts",
      annotationCount: 3,
    });
    const stats = { additions: 43, deletions: 27 };
    const out = fileRowSegments(row, stats, 28 - fileRowFixedCost(row, stats));
    const full = fullLabel(out);
    expect(full.length).toBe(28);
    expect(full.startsWith(" M ")).toBe(true);
    expect(full.endsWith(" +43 -27 [3] ")).toBe(true);
    expect(full).toContain("…");
  });

  it("never exceeds the sidebar content width regardless of name length", () => {
    const row = file({
      displayName: "a".repeat(100),
      depth: 4,
      annotationCount: 12,
    });
    const stats = { additions: 999, deletions: 999 };
    const out = fileRowSegments(row, stats, 28 - fileRowFixedCost(row, stats));
    expect(fullLabel(out).length).toBe(28);
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
  it("at depth 0 with no badge and no stats: leading(1) + icon(1) + space(1) + trailing(1) = 4", () => {
    expect(fileRowFixedCost(file({ depth: 0, annotationCount: 0 }), NO_STATS)).toBe(4);
  });

  it("adds 2 columns per depth level", () => {
    expect(fileRowFixedCost(file({ depth: 2, annotationCount: 0 }), NO_STATS)).toBe(4 + 4);
  });

  it("adds the badge width ' [N]' when annotationCount > 0", () => {
    // base 4 + " [3]" = 4 chars added.
    expect(fileRowFixedCost(file({ depth: 0, annotationCount: 3 }), NO_STATS)).toBe(4 + 4);
    // base 4 + " [12]" = 5 chars added.
    expect(fileRowFixedCost(file({ depth: 0, annotationCount: 12 }), NO_STATS)).toBe(4 + 5);
  });

  it("adds ' +N' width when additions > 0 (issue #265)", () => {
    // base 4 + " +43" = 4 chars added.
    expect(fileRowFixedCost(file({ depth: 0 }), { additions: 43, deletions: 0 })).toBe(4 + 4);
  });

  it("adds ' -M' width when deletions > 0 (issue #265)", () => {
    // base 4 + " -27" = 4 chars added.
    expect(fileRowFixedCost(file({ depth: 0 }), { additions: 0, deletions: 27 })).toBe(4 + 4);
  });

  it("adds both ' +N' and ' -M' widths when both > 0 (issue #265)", () => {
    // base 4 + " +43" + " -27" = 8 chars added.
    expect(fileRowFixedCost(file({ depth: 0 }), { additions: 43, deletions: 27 })).toBe(4 + 4 + 4);
  });

  it("adds no stats width when both are 0 (pure-rename / no content change)", () => {
    expect(fileRowFixedCost(file({ depth: 0 }), NO_STATS)).toBe(4);
  });
});
