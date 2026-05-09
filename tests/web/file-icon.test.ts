import { describe, it, expect } from "vitest";
import {
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  DiffRenamedIcon,
} from "@primer/octicons-react";
import { fileIcon } from "../../src/web/client/file-icon.js";

describe("fileIcon", () => {
  it.each([
    ["new", DiffAddedIcon, "added"],
    ["add", DiffAddedIcon, "added"],
    ["change", DiffModifiedIcon, "modified"],
    ["modify", DiffModifiedIcon, "modified"],
    ["deleted", DiffRemovedIcon, "deleted"],
    ["delete", DiffRemovedIcon, "deleted"],
    ["rename", DiffRenamedIcon, "renamed"],
    ["rename-pure", DiffRenamedIcon, "renamed"],
    ["rename-changed", DiffRenamedIcon, "renamed"],
  ])("maps %s -> (%s, %s)", (type, expectedIcon, expectedClass) => {
    const { Icon, statusClass } = fileIcon(type);
    expect(Icon).toBe(expectedIcon);
    expect(statusClass).toBe(expectedClass);
  });

  it("falls back to modified for unknown types", () => {
    const { Icon, statusClass } = fileIcon("totally-unknown");
    expect(Icon).toBe(DiffModifiedIcon);
    expect(statusClass).toBe("modified");
  });
});
