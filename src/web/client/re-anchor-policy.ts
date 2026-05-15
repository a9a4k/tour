import type { Comment } from "../../core/types.js";
import type { Cursor } from "../../core/cursor-state.js";

/**
 * Bundle-load re-anchor policy (issue #197). Decides what the
 * "re-anchor cursor to a top-level Comment card on bundle load"
 * effect should do given the current cursor, the URL fragment, and
 * the loaded Tour's top-level comments.
 *
 * The discriminator is `cursor === null` (true tour-load / tour-switch),
 * NOT `cursorCardId === null` — a `RowAnchor` cursor written by `j` / `k`
 * also nulls the card id, and the previous gate snapped it back to a
 * CardAnchor within the same render (Bug B: j/k flickered and never
 * landed). The fix: only run the URL-restore branch on a fully null
 * cursor; only run the stale-fallback branch on a CardAnchor whose id
 * is no longer in `topLevel`; otherwise leave the cursor alone.
 */
export type ReanchorEffect =
  | { kind: "noop" }
  | { kind: "url-restore"; target: Comment }
  | { kind: "stale-fallback"; target: Comment };

export function decideReanchor(
  cursor: Cursor | null,
  annFromUrl: string | null,
  topLevel: ReadonlyArray<Comment>,
): ReanchorEffect {
  if (topLevel.length === 0) return { kind: "noop" };
  if (cursor === null) {
    const target = topLevel.find((a) => a.id === annFromUrl) ?? topLevel[0];
    return { kind: "url-restore", target };
  }
  if (cursor.kind === "card") {
    const found = topLevel.some((a) => a.id === cursor.commentId);
    if (!found) return { kind: "stale-fallback", target: topLevel[0] };
  }
  // RowAnchor cursor: user is walking rows; never override.
  return { kind: "noop" };
}
