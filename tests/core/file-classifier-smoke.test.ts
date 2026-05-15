import { describe, it, expect } from "vitest";
import { classifyFile, type FileClassification } from "../../src/core/file-classifier.js";
import type { DiffFile } from "../../src/core/diff-model.js";

function makeFile(name: string, overrides?: Partial<DiffFile>): DiffFile {
  return {
    name,
    type: overrides?.type ?? "change",
    hunks: overrides?.hunks ?? [{ additionStart: 1, additionCount: 1, deletionStart: 1, deletionCount: 1, content: [{ type: "addition", addition: "line" }] }],
    prevName: overrides?.prevName,
  };
}

describe("file-classifier smoke: lockfile + source file fixture", () => {
  const fixtureFiles: DiffFile[] = [
    makeFile("package-lock.json"),
    makeFile("src/index.ts"),
  ];

  it("lockfile is collapsed with reason generated", () => {
    const lockfile = fixtureFiles[0];
    const cls = classifyFile(lockfile.name, {});
    expect(cls).toEqual({ collapsed: true, reason: "generated" });
  });

  it("source file is not collapsed", () => {
    const source = fixtureFiles[1];
    const cls = classifyFile(source.name, {});
    expect(cls).toEqual({ collapsed: false });
  });

  it("renderer should expand lockfile when it has comments", () => {
    const lockfile = fixtureFiles[0];
    const cls = classifyFile(lockfile.name, {});
    const hasComments = true;
    const shouldCollapse = cls.collapsed && cls.reason !== "binary" && !hasComments;
    expect(shouldCollapse).toBe(false);
  });

  it("renderer should collapse lockfile when it has no comments", () => {
    const lockfile = fixtureFiles[0];
    const cls = classifyFile(lockfile.name, {});
    const hasComments = false;
    const shouldCollapse = cls.collapsed && cls.reason !== "binary" && !hasComments;
    expect(shouldCollapse).toBe(true);
  });

  it("binary file stays collapsed even with comments", () => {
    const cls = classifyFile("image.png", { isBinary: true });
    const hasComments = true;
    const shouldCollapse = cls.collapsed && cls.reason === "binary";
    expect(shouldCollapse).toBe(true);
  });
});
