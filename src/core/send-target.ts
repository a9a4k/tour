import type { Comment } from "./types.js";
import type { Cursor } from "./cursor-state.js";
import { findThreadByNode } from "./cursor-state.js";
import { latestHumanLeafId, type Thread } from "./threads.js";

export interface SendTarget {
  leafId: string;
  leaf: Comment;
}

// The `R` dispatch target shared by both surfaces (issue #196, PRD #181).
// The cursor identifies the focused Thread; the keystroke targets the
// Thread's latest human leaf — mirrors the webapp's #190/#191 collapse
// so once the conversation has started, the focused top-level being
// `already-replied` doesn't dead-end the `R` keystroke.
//
// Thread-scoped resolution (issue #395). ADR 0037 introduced reply-level
// cursor stops, so `cursor.commentId` may be a parent OR a Reply id. We
// resolve through `findThreadByNode` so `R` dispatches Thread-scoped
// regardless of which node the cursor sits on — including the natural
// post-Reply-submit landing on the freshly-created Reply.
//
// Returns null when there is no dispatch to perform:
//   - cursor is null or on a row (no focused Thread)
//   - the cursor's commentId isn't in any Thread (stale)
//   - the latest turn in the focused Thread is agent-authored (no human
//     turn to send; user must write a Reply first)
//
// Canonical home (PRD #242 / issue #243).
export function sendTarget(
  cursor: Cursor | null,
  threads: ReadonlyArray<Thread>,
): SendTarget | null {
  if (!cursor || cursor.kind !== "card") return null;
  const found = findThreadByNode(cursor.commentId, threads);
  if (!found) return null;
  const { thread } = found;
  const leafId = latestHumanLeafId(thread.root, [...thread.replies]);
  if (leafId === null) return null;
  const leaf =
    leafId === thread.root.id
      ? thread.root
      : thread.replies.find((a) => a.id === leafId);
  if (!leaf) return null;
  return { leafId, leaf };
}
