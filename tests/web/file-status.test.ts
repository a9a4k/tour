import { describe, it, expect } from "vitest";
import { fileStatusIcon, countAnnotationsForFile, fileStat } from "../../src/web/client/file-status.js";

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

describe("fileStat", () => {
  it("counts pure additions and deletions", () => {
    const hunks = [
      { content: [{ type: "addition" as const }, { type: "addition" as const }, { type: "deletion" as const }] },
    ];
    expect(fileStat(hunks)).toEqual({ add: 2, del: 1 });
  });

  it("treats a change as both add and del", () => {
    const hunks = [{ content: [{ type: "change" as const }] }];
    expect(fileStat(hunks)).toEqual({ add: 1, del: 1 });
  });

  it("ignores context lines", () => {
    const hunks = [
      {
        content: [
          { type: "context" as const },
          { type: "addition" as const },
          { type: "context" as const },
        ],
      },
    ];
    expect(fileStat(hunks)).toEqual({ add: 1, del: 0 });
  });
});
