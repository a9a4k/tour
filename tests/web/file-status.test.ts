import { describe, it, expect } from "vitest";
import { fileStatusIcon, countAnnotationsForFile } from "../../src/web/client/file-status.js";

describe("fileStatusIcon", () => {
  it.each([
    ["new", "A"],
    ["add", "A"],
    ["deleted", "D"],
    ["delete", "D"],
    ["rename", "R"],
    ["rename-pure", "R"],
    ["rename-changed", "R"],
    ["change", "M"],
    ["modify", "M"],
  ])("maps %s -> %s", (type, icon) => {
    expect(fileStatusIcon(type)).toBe(icon);
  });
});

describe("countAnnotationsForFile", () => {
  it("counts annotations matching the file path", () => {
    const xs = [{ file: "a.ts" }, { file: "a.ts" }, { file: "b.ts" }];
    expect(countAnnotationsForFile(xs, "a.ts")).toBe(2);
    expect(countAnnotationsForFile(xs, "b.ts")).toBe(1);
    expect(countAnnotationsForFile(xs, "c.ts")).toBe(0);
  });
});
