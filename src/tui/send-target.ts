// Thin re-export of the canonical `core/send-target.ts` (PRD #242 / issue
// #243 slice 1). The TUI's `tuiSendTarget` name is preserved so existing
// callers compile until slice 2 migrates them through `view.nav.sendTarget`.
import type { Annotation } from "../core/types.js";
import type { Cursor } from "../core/cursor-state.js";
import { sendTarget, type SendTarget } from "../core/send-target.js";

export type { SendTarget };

export function tuiSendTarget(
  cursor: Cursor | null,
  topLevel: ReadonlyArray<Annotation>,
  repliesByRoot: ReadonlyMap<string, Annotation[]>,
): SendTarget | null {
  return sendTarget(cursor, topLevel, repliesByRoot);
}
