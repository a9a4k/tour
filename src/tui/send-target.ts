import type { Annotation } from "../core/types.js";
import type { Cursor } from "../core/cursor-state.js";
import { latestHumanLeafId } from "../core/threads.js";

export interface SendTarget {
  leafId: string;
  leaf: Annotation;
}

// The TUI's `s` dispatch target (issue #196, PRD #181 latest-human-leaf
// rule). The cursor walks top-levels only (`n`/`p` semantics unchanged);
// the keystroke targets the latest human leaf in the focused Thread —
// mirrors the webapp's #190/#191 collapse so once the conversation has
// started, the focused top-level being `already-replied` doesn't dead-
// end the `s` keystroke.
//
// Returns null when there is no dispatch to perform:
//   - cursor is null or on a row (no focused Thread)
//   - the focused top-level's id isn't in the annotation list (stale)
//   - the latest turn in the focused Thread is agent-authored (no human
//     turn to send; user must write a Reply first)
export function tuiSendTarget(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  repliesByRoot: ReadonlyMap<string, ReadonlyArray<Annotation>>,
): SendTarget | null {
  if (!cursor || cursor.kind !== "card") return null;
  const cardId = cursor.annotationId;
  const top = topLevel.find((a) => a.id === cardId);
  if (!top) return null;
  const descendants = repliesByRoot.get(cardId) ?? [];
  const leafId = latestHumanLeafId(top, descendants as Annotation[]);
  if (leafId === null) return null;
  const leaf =
    leafId === cardId ? top : descendants.find((a) => a.id === leafId);
  if (!leaf) return null;
  return { leafId, leaf };
}
