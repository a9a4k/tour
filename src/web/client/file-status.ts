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

export function fileStat(
  hunks: { content: { type: "context" | "addition" | "deletion" | "change" }[] }[],
): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const hunk of hunks) {
    for (const line of hunk.content) {
      if (line.type === "addition") add++;
      else if (line.type === "deletion") del++;
      else if (line.type === "change") {
        add++;
        del++;
      }
    }
  }
  return { add, del };
}
