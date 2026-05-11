import { FileAddedIcon, FileDiffIcon, FileMovedIcon, FileRemovedIcon } from "./icons.js";
import type { Icon } from "@primer/octicons-react";

export interface FileIcon {
  Icon: Icon;
  statusClass: "added" | "modified" | "deleted" | "renamed";
}

export function fileIcon(type: string): FileIcon {
  switch (type) {
    case "new":
    case "add":
      return { Icon: FileAddedIcon, statusClass: "added" };
    case "deleted":
    case "delete":
      return { Icon: FileRemovedIcon, statusClass: "deleted" };
    case "rename":
    case "rename-pure":
    case "rename-changed":
      return { Icon: FileMovedIcon, statusClass: "renamed" };
    default:
      return { Icon: FileDiffIcon, statusClass: "modified" };
  }
}
