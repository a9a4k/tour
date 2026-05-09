export type FileStatusIcon = "A" | "M" | "D" | "R";

export function fileStatusIcon(type: string): FileStatusIcon {
  switch (type) {
    case "new":
    case "add":
      return "A";
    case "deleted":
    case "delete":
      return "D";
    case "rename":
    case "rename-pure":
    case "rename-changed":
      return "R";
    default:
      return "M";
  }
}

export function countAnnotationsForFile<T extends { file: string }>(
  annotations: T[],
  fileName: string,
): number {
  return annotations.filter((a) => a.file === fileName).length;
}
