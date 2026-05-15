// Cursor → open-target resolver (PRD #349 / ADR 0032).
// Issue #352 shipped the row-cursor case. Issue #354 fills in permissive
// resolution: card cursor → annotation `line_end`, sidebar file row →
// (file, 1), folder selection / null → null. Both surfaces share this
// resolver; the surface handlers translate `null` into the "o: no file
// under cursor" footer hint.

import type { Cursor } from "./cursor-state.js";
import type { Comment } from "./types.js";
import type { PaneFocus } from "./pane-focus-state.js";
import type { SidebarSelectedRow } from "./yank-target.js";

export interface OpenTarget {
  file: string;
  line: number;
}

export interface ResolveOpenTargetArgs {
  paneFocus: PaneFocus;
  cursor: Cursor | null;
  sidebarSelectedRow: SidebarSelectedRow | null;
  comments: ReadonlyArray<Comment>;
}

export function resolveOpenTarget(args: ResolveOpenTargetArgs): OpenTarget | null {
  const { paneFocus, cursor, sidebarSelectedRow, comments } = args;

  if (paneFocus === "sidebar") {
    if (sidebarSelectedRow?.kind === "file") {
      return { file: sidebarSelectedRow.path, line: 1 };
    }
    return null;
  }

  if (!cursor) return null;

  if (cursor.kind === "card") {
    // Card cursor → annotation `line_end`. Cards render below their
    // anchored range; `line_end` is the line the reader's eye lands on
    // before the card (locked in during PRD #349 grilling, ADR 0032).
    const ann = comments.find((a) => a.id === cursor.commentId);
    if (!ann) return null;
    return { file: ann.file, line: ann.line_end };
  }

  if (cursor.interactive) return null;
  return { file: cursor.file, line: cursor.lineNumber };
}
