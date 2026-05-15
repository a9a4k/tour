import type { Cursor } from "./cursor-state.js";
import type { Comment } from "./types.js";
import type { BundleFile } from "./tour-bundle.js";
import type { PaneFocus } from "./pane-focus-state.js";

// PRD #356 / issue #357: cross-surface yank target resolver. Both the
// TUI and webapp surface handlers call this single pure function to
// collapse (paneFocus, cursor, sidebarSelectedRow, comments,
// bundleFiles) into a typed outcome the surface dispatches on. No I/O,
// no surface coupling — clipboard transport and footer-flash live in
// the surface handlers.

export type YankTarget =
  | { kind: "line"; text: string; file: string }
  | { kind: "path"; path: string }
  | { kind: "none"; reason: "no-file-selected" | "no-cursor" };

export interface SidebarFileSelection {
  kind: "file";
  path: string;
}

export interface SidebarFolderSelection {
  kind: "folder";
}

export type SidebarSelectedRow = SidebarFileSelection | SidebarFolderSelection;

export interface ResolveYankTargetArgs {
  paneFocus: PaneFocus;
  cursor: Cursor | null;
  sidebarSelectedRow: SidebarSelectedRow | null;
  comments: ReadonlyArray<Comment>;
  bundleFiles: ReadonlyMap<string, BundleFile>;
}

export function resolveYankTarget(args: ResolveYankTargetArgs): YankTarget {
  const { paneFocus, cursor, sidebarSelectedRow, comments, bundleFiles } = args;

  if (paneFocus === "sidebar") {
    if (sidebarSelectedRow?.kind === "file") {
      return { kind: "path", path: sidebarSelectedRow.path };
    }
    return { kind: "none", reason: "no-file-selected" };
  }

  if (cursor === null) return { kind: "none", reason: "no-cursor" };

  if (cursor.kind === "card") {
    const ann = comments.find((a) => a.id === cursor.commentId);
    if (!ann) return { kind: "none", reason: "no-cursor" };
    return { kind: "path", path: ann.file };
  }

  // Row cursor.
  if (cursor.interactive) return { kind: "path", path: cursor.file };

  const file = bundleFiles.get(cursor.file);
  const content =
    cursor.side === "additions" ? file?.newContent : file?.oldContent;
  if (content === undefined) return { kind: "path", path: cursor.file };

  const lines = splitContentLines(content);
  const idx = cursor.lineNumber - 1;
  if (idx < 0 || idx >= lines.length) return { kind: "path", path: cursor.file };

  return { kind: "line", text: lines[idx], file: cursor.file };
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) return [];
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n");
}
