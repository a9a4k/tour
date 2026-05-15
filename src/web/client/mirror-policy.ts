import type { Comment } from "../../core/types.js";
import type { Cursor } from "../../core/cursor-state.js";
import { composeUrl } from "./url-routing.js";

/**
 * URL-mirror policy (issue #198). Decides what the "mirror the cursor's
 * card target into the URL" effect should do given the current cursor and
 * the loaded Tour's top-level comments.
 *
 * The discriminator is `cursor === null` (true tour-load — the re-anchor
 * effect is about to seed from `#<ann-id>`, so we defer the URL write to
 * avoid a strip-then-restore in one cycle), NOT `cursorCardId === null` —
 * a RowAnchor cursor from `j`/`k`/click on a diff row ALSO has no card id,
 * and the previous gate collapsed both cases into "defer," leaving the
 * stale `#<ann-id>` of the card the user just left. The fix discriminates
 * on the full cursor: null → skip, RowAnchor → write a bare `/<tour-id>`
 * (drop the hash), CardAnchor → write `/<tour-id>#<ann-id>`.
 *
 * Symmetric to `decideReanchor` from issue #197 — both effects key off
 * the same discrimination.
 */
export type MirrorEffect =
  | { kind: "skip" }
  | { kind: "write"; url: string };

export function decideMirrorUrl(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Comment>,
  tourId: string,
): MirrorEffect {
  if (cursor === null && topLevel.length > 0) return { kind: "skip" };
  const annId = cursor?.kind === "card" ? cursor.commentId : null;
  return { kind: "write", url: composeUrl(tourId, annId) };
}
