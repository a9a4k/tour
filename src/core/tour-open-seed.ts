import type { Cursor } from "./cursor-state.js";
import { initialCursor } from "./cursor-state.js";
import type { FlatRow } from "./flat-rows.js";
import type { PaneFocus } from "./pane-focus-state.js";
import { topLevelComments } from "./threads.js";
import type { TourBundle } from "./tour-bundle.js";
import type { Intent } from "./tour-session.js";
import type { Comment } from "./types.js";

export interface TourOpenSeed {
  paneFocus: PaneFocus;
  cursor: Cursor | null;
  intents: Intent[];
}

function emptySeed(): TourOpenSeed {
  return {
    paneFocus: "sidebar",
    cursor: null,
    intents: [{ type: "mirrorAnnUrl", commentId: null }],
  };
}

function syntheticCardRow(comment: Comment): FlatRow {
  return {
    kind: "card",
    file: comment.file,
    side: comment.side,
    lineEnd: comment.line_end,
    commentId: comment.id,
  };
}

function seedCursor(comment: Comment): Cursor {
  return (
    initialCursor({
      topLevelComments: [comment],
      flatRows: [syntheticCardRow(comment)],
    }) ?? { kind: "card", commentId: comment.id, preferredSide: "additions" }
  );
}

export function computeTourOpenSeed(
  bundle: TourBundle,
  annId: string | null,
): TourOpenSeed {
  if (bundle.kind !== "ok") return emptySeed();

  const topLevel = topLevelComments(bundle.comments);
  if (topLevel.length === 0) return emptySeed();

  const matched =
    annId === null
      ? undefined
      : topLevel.find((comment) => comment.id === annId && comment.deleted === undefined);
  const seed = matched ?? topLevel[0];
  const cursor = seedCursor(seed);

  return {
    paneFocus: "diff",
    cursor,
    intents: [
      { type: "selectSidebarFile", file: seed.file },
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: seed.id },
        placement: "center",
        behavior: "instant",
      },
      { type: "mirrorAnnUrl", commentId: seed.id },
    ],
  };
}
