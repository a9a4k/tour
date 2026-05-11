import { describe, it, expect } from "vitest";
import {
  formatRenameLabel,
  RENAME_PLACEHOLDER_BODY,
} from "../../src/core/rename-label.js";

describe("formatRenameLabel", () => {
  it("returns null when prevName is undefined", () => {
    expect(formatRenameLabel("src/a.ts", undefined)).toBeNull();
  });

  it("returns null when prevName equals name", () => {
    expect(formatRenameLabel("src/a.ts", "src/a.ts")).toBeNull();
  });

  it("returns 'prev → new' when prevName differs from name", () => {
    expect(formatRenameLabel("src/b.ts", "src/a.ts")).toBe(
      "src/a.ts → src/b.ts",
    );
  });
});

describe("RENAME_PLACEHOLDER_BODY", () => {
  it("is the exact text the issue requires", () => {
    expect(RENAME_PLACEHOLDER_BODY).toBe("File renamed without changes.");
  });
});
