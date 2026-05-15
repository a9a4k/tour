import type { Comment } from "../core/types.js";

export type CommentCardSlot = "full" | "left" | "right";

// In split layout, the comment card occupies only the half matching its
// `side` so it visually anchors under the line range it discusses — the same
// placement the webapp gets for free from `@pierre/diffs`'s `<FileDiff>`.
// In unified layout, both surfaces agree there's only one column.
export function commentCardSlot(
  layout: "split" | "unified",
  side: Comment["side"],
): CommentCardSlot {
  if (layout === "unified") return "full";
  return side === "additions" ? "right" : "left";
}
