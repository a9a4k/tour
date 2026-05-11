import { describe, it, expect } from "vitest";
import { FileAddedIcon, FileDiffIcon, FileMovedIcon, FileRemovedIcon } from "@primer/octicons-react";
import { fileIcon } from "../../src/web/client/file-icon.js";

describe("fileIcon", () => {
  it.each([
    ["new", FileAddedIcon, "added"],
    ["add", FileAddedIcon, "added"],
    ["change", FileDiffIcon, "modified"],
    ["modify", FileDiffIcon, "modified"],
    ["deleted", FileRemovedIcon, "deleted"],
    ["delete", FileRemovedIcon, "deleted"],
    ["rename", FileMovedIcon, "renamed"],
    ["rename-pure", FileMovedIcon, "renamed"],
    ["rename-changed", FileMovedIcon, "renamed"],
  ])("maps %s -> (%s, %s)", (type, expectedIcon, expectedClass) => {
    const { Icon, statusClass } = fileIcon(type);
    expect(Icon).toBe(expectedIcon);
    expect(statusClass).toBe(expectedClass);
  });

  it("falls back to modified for unknown types", () => {
    const { Icon, statusClass } = fileIcon("totally-unknown");
    expect(Icon).toBe(FileDiffIcon);
    expect(statusClass).toBe("modified");
  });
});
