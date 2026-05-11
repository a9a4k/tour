import type { DiffFile } from "../core/diff-model.js";
import type { Annotation } from "../core/types.js";
import type { FileClassification } from "../core/file-classifier.js";
import { isTopLevel } from "../core/threads.js";
import { formatRenameLabel, RENAME_PLACEHOLDER_BODY } from "../core/rename-label.js";

export function statusIcon(type: string): string {
  switch (type) {
    case "new":
    case "add": return "A";
    case "delete": return "D";
    case "rename": return "R";
    case "change": return "M";
    default: return "M";
  }
}

function annotationCountForFile(annotations: Annotation[], fileName: string): number {
  return annotations.filter((a) => a.file === fileName && isTopLevel(a)).length;
}

export function fileClassification(
  classifications: Record<string, FileClassification> | undefined,
  fileName: string,
): FileClassification {
  return classifications?.[fileName] ?? { collapsed: false };
}

function reasonLabel(reason?: string): string {
  if (!reason) return "";
  return ` [${reason}]`;
}

export function fileEntryLabel(
  file: DiffFile,
  classifications: Record<string, FileClassification> | undefined,
  annotations: Annotation[],
): string {
  const annCount = annotationCountForFile(annotations, file.name);
  const cls = fileClassification(classifications, file.name);
  const icon = statusIcon(file.type);
  const path = formatRenameLabel(file.name, file.prevName) ?? file.name;
  const badge = annCount > 0 ? ` [${annCount}]` : "";
  const marker = cls.reason ? reasonLabel(cls.reason) : "";
  return ` ${icon} ${path}${marker}${badge} `;
}

// Returns the muted placeholder text for the card body when the file
// is either collapsed or has no hunks; null when the diff rows should
// be rendered. A pure rename (collapsed + reason "renamed") gets the
// explicit "File renamed without changes." line so reviewers see an
// acknowledgement instead of an empty card.
export function fileCardPlaceholder(
  collapsed: boolean,
  hasHunks: boolean,
  reason: string | undefined,
): string | null {
  if (collapsed && reason === "renamed") return RENAME_PLACEHOLDER_BODY;
  if (collapsed) return "[collapsed — c to expand]";
  if (!hasHunks) return "[no textual changes]";
  return null;
}
