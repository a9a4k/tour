import type { Annotation } from "./types.js";
import type { Cursor } from "./cursor-state.js";
import { latestHumanLeafId } from "./threads.js";

export interface SendTarget {
  leafId: string;
  leaf: Annotation;
}

// The `s` dispatch target shared by both surfaces (issue #196, PRD #181).
// The cursor walks top-levels only (`n`/`p` semantics unchanged); the
// keystroke targets the latest human leaf in the focused Thread — mirrors
// the webapp's #190/#191 collapse so once the conversation has started,
// the focused top-level being `already-replied` doesn't dead-end the `s`
// keystroke.
//
// Returns null when there is no dispatch to perform:
//   - cursor is null or on a row (no focused Thread)
//   - the focused top-level's id isn't in the annotation list (stale)
//   - the latest turn in the focused Thread is agent-authored (no human
//     turn to send; user must write a Reply first)
//
// Canonical home (PRD #242 / issue #243). The TUI's prior `tuiSendTarget`
// is a thin re-export so callers keep working until slices 2 + 3 migrate
// through `view.nav.sendTarget`.
export function sendTarget(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  repliesByRoot: ReadonlyMap<string, ReadonlyArray<Annotation>>,
): SendTarget | null {
  if (!cursor || cursor.kind !== "card") return null;
  const cardId = cursor.annotationId;
  const top = topLevel.find((a) => a.id === cardId);
  if (!top) return null;
  const descendants = repliesByRoot.get(cardId) ?? [];
  const leafId = latestHumanLeafId(top, [...descendants]);
  if (leafId === null) return null;
  const leaf =
    leafId === cardId ? top : descendants.find((a) => a.id === leafId);
  if (!leaf) return null;
  return { leafId, leaf };
}
