import { describe, it, expect } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { Annotation } from "../../src/core/types.js";
import type { FileClassification } from "../../src/core/file-classifier.js";
import {
  fileCardPlaceholder,
  fileEntryLabel,
  statusIcon,
} from "../../src/tui/file-entry-label.js";

function makeFile(partial: Partial<DiffFile> & { name: string }): DiffFile {
  return {
    type: "change",
    hunks: [],
    ...partial,
  };
}

const NO_ANNOTATIONS: Annotation[] = [];

describe("fileEntryLabel", () => {
  it("renders just the path when no classification / annotations / rename", () => {
    const file = makeFile({ name: "src/a.ts" });
    expect(fileEntryLabel(file, undefined, NO_ANNOTATIONS)).toBe(" M src/a.ts ");
  });

  it("shows prevName → name when the file is a rename (pure rename)", () => {
    const file = makeFile({
      name: "src/new.ts",
      prevName: "src/old.ts",
      type: "rename",
    });
    const cls: Record<string, FileClassification> = {
      "src/new.ts": { collapsed: true, reason: "renamed" },
    };
    expect(fileEntryLabel(file, cls, NO_ANNOTATIONS)).toBe(
      " R src/old.ts → src/new.ts [renamed] ",
    );
  });

  it("shows prevName → name on rename-with-changes too", () => {
    const file = makeFile({
      name: "src/new.ts",
      prevName: "src/old.ts",
      type: "rename",
      hunks: [
        {
          additionStart: 1,
          additionCount: 1,
          deletionStart: 1,
          deletionCount: 1,
          content: [],
        },
      ],
    });
    // rename-with-changes is NOT classified as renamed (no reason set,
    // not collapsed) — the header still shows the path pair.
    expect(fileEntryLabel(file, {}, NO_ANNOTATIONS)).toBe(
      " R src/old.ts → src/new.ts ",
    );
  });

  it("does not insert an arrow when prevName equals name", () => {
    const file = makeFile({ name: "src/a.ts", prevName: "src/a.ts" });
    expect(fileEntryLabel(file, undefined, NO_ANNOTATIONS)).toBe(" M src/a.ts ");
  });
});

describe("statusIcon", () => {
  it("maps rename to R", () => {
    expect(statusIcon("rename")).toBe("R");
  });
});

describe("fileCardPlaceholder", () => {
  it("returns the rename placeholder for pure renames", () => {
    expect(fileCardPlaceholder(true, false, "renamed")).toBe(
      "File renamed without changes.",
    );
  });

  it("returns the generic collapsed placeholder for other collapsed reasons", () => {
    expect(fileCardPlaceholder(true, false, "generated")).toBe(
      "[collapsed — c to expand]",
    );
    expect(fileCardPlaceholder(true, false, "binary")).toBe(
      "[collapsed — c to expand]",
    );
    expect(fileCardPlaceholder(true, false, undefined)).toBe(
      "[collapsed — c to expand]",
    );
  });

  it("returns the no-hunks placeholder for non-collapsed empty diffs", () => {
    expect(fileCardPlaceholder(false, false, undefined)).toBe(
      "[no textual changes]",
    );
  });

  it("returns null when DiffRows should render", () => {
    expect(fileCardPlaceholder(false, true, undefined)).toBeNull();
  });
});
