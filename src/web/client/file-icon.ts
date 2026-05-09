import {
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  DiffRenamedIcon,
} from "./icons.js";
import type { Icon } from "@primer/octicons-react";

export interface FileIcon {
  Icon: Icon;
  statusClass: "added" | "modified" | "deleted" | "renamed";
}

export function fileIcon(type: string): FileIcon {
  switch (type) {
    case "new":
    case "add":
      return { Icon: DiffAddedIcon, statusClass: "added" };
    case "deleted":
    case "delete":
      return { Icon: DiffRemovedIcon, statusClass: "deleted" };
    case "rename":
    case "rename-pure":
    case "rename-changed":
      return { Icon: DiffRenamedIcon, statusClass: "renamed" };
    default:
      return { Icon: DiffModifiedIcon, statusClass: "modified" };
  }
}
