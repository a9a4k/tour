/**
 * Pure planner for the primary-action dispatch on interactive rows
 * (Enter or click). Both the keyboard and the mouse-click paths feed
 * through this helper so they produce the same expansion + orphan-
 * landing dispatch for a given (file, subKind, boundaryRef) target.
 *
 * Issue #372: pre-fix the TUI's `onInteractiveClick` only moved the
 * cursor — clicking `↑` / `↕` / `↓` / a collapsed-file row did not
 * fire the row's expansion, forcing users to click then press Enter.
 * The planner centralises the dispatch decisions so the click handler
 * delegates to the same logic the keyboard handler runs.
 *
 * The planner is pure: it takes a target, the pre-dispatch flatRows,
 * the gap size, and the boundary's current up/down expansion, and
 * returns the (expansion, landing) plan. The dispatcher (in
 * `tui/app.tsx` / `web/client/App.tsx`) is responsible for resolving
 * the gap size from `fileMetadata` + `bundleSlice` and for issuing
 * `store.dispatch` for the returned actions.
 */
import type { RowAnchor } from "./cursor-state.js";
import {
  cursorAfterExpand,
  cursorOnInteractive,
  type ExpandOrphanKind,
} from "./cursor-state.js";
import type { InteractiveSubKind, BoundaryRef } from "./diff-rows.js";
import { GAP_TWO_ROW_THRESHOLD, hunkHeaderExpandPlan } from "./diff-rows.js";
import type { BoundaryExpansion } from "./expansion-state.js";
import type { FlatRow } from "./flat-rows.js";

/**
 * Dispatchable expansion action — 1:1 with the reducer's `expansion.*`
 * action shapes (subset; the planner never emits `expansion.expandFileAll`,
 * which is the whole-file escape hatch routed elsewhere).
 */
export type ExpansionAction =
  | {
      type: "expansion.expandTop";
      file: string;
      mode: "symmetric-20" | "all";
      gapSize: number;
    }
  | {
      type: "expansion.expandBottom";
      file: string;
      mode: "symmetric-20" | "all";
      gapSize: number;
    }
  | {
      type: "expansion.expand";
      file: string;
      ref: number;
      direction: "up" | "down" | "both";
      mode: "symmetric-20" | "all";
      gapSize: number;
    }
  | { type: "expansion.expandFile"; file: string };

export interface PrimaryActionPlan {
  /** Expansion action to dispatch, or null when the target is non-
   *  actionable (gap fully consumed, banner has no primaryExpand). */
  expansion: ExpansionAction | null;
  /** Cursor anchor to land on when the activated row vanishes from the
   *  next planner emission (issue #306). `null` means the activated row
   *  survives the dispatch and the cursor stays where it was set. */
  landing: RowAnchor | null;
}

export interface PrimaryActionTarget {
  file: string;
  subKind: InteractiveSubKind;
  boundaryRef: BoundaryRef;
}

export interface PrimaryActionContext {
  target: PrimaryActionTarget;
  /** Threaded onto the synthetic target anchor so a subsequent h/l
   *  honours the user's last side preference (ADR 0023 / issue #200). */
  preferredSide: "additions" | "deletions";
  /** Pre-dispatch flatRows. `cursorAfterExpand` walks this stream to find
   *  the orphan-landing target. */
  flatRowsBefore: ReadonlyArray<FlatRow>;
  /** Hidden-line count at the boundary. The dispatcher computes this
   *  from `fileMetadata` (mid-file) or `fileMetadata + bundleSlice`
   *  (file-bottom). `0` means there's nothing to reveal. */
  gapSize: number;
  /** Current up/down at this boundary. Used by `expand-down` to predict
   *  whether the post-dispatch remaining gap drops below
   *  `GAP_TWO_ROW_THRESHOLD` (mid-file) or to zero (file-bottom). */
  boundaryExpansion: BoundaryExpansion;
}

/** Step size for the `↓ Expand Down` / `↑ Expand Up` symmetric ladder.
 *  Mirrors the reducer's `addDown` / `addUp` calculation. */
const SYMMETRIC_STEP_TOTAL = 20;

export function planPrimaryAction(ctx: PrimaryActionContext): PrimaryActionPlan {
  const { target, preferredSide, flatRowsBefore, gapSize, boundaryExpansion } =
    ctx;
  const { file, subKind, boundaryRef } = target;

  // Synthetic anchor at the action target. cursorAfterExpand consumes a
  // RowAnchor; the click path may fire with the real cursor on a card or
  // a sidebar selection. Synthesising the anchor here means the keyboard
  // and click paths predict identical orphan-landings for the same target.
  const synthetic: RowAnchor = cursorOnInteractive({
    file,
    subKind,
    boundaryRef,
    preferredSide,
  });

  switch (subKind) {
    case "expand-down": {
      if (gapSize === 0) return { expansion: null, landing: null };
      const remaining =
        gapSize - boundaryExpansion.up - boundaryExpansion.down;
      if (remaining <= 0) return { expansion: null, landing: null };
      const addition = Math.min(SYMMETRIC_STEP_TOTAL, remaining);
      const newRemaining = remaining - addition;
      const orphanKind: ExpandOrphanKind | null =
        boundaryRef === "bottom"
          ? newRemaining <= 0
            ? "expand-down-bottom"
            : null
          : newRemaining < GAP_TWO_ROW_THRESHOLD
            ? "expand-down-mid"
            : null;
      const landing =
        orphanKind === null
          ? null
          : pickLanding(synthetic, flatRowsBefore, orphanKind);
      const expansion: ExpansionAction =
        boundaryRef === "bottom"
          ? {
              type: "expansion.expandBottom",
              file,
              mode: "symmetric-20",
              gapSize,
            }
          : {
              type: "expansion.expand",
              file,
              ref: boundaryRef as number,
              direction: "down",
              mode: "symmetric-20",
              gapSize,
            };
      return { expansion, landing };
    }
    case "boundary-top":
    case "hunk-separator": {
      if (gapSize === 0) return { expansion: null, landing: null };
      const plan = hunkHeaderExpandPlan(gapSize, subKind === "boundary-top");
      if (plan.primaryExpand === null) {
        return { expansion: null, landing: null };
      }
      if (plan.primaryExpand === "up") {
        const expansion: ExpansionAction =
          boundaryRef === "top"
            ? {
                type: "expansion.expandTop",
                file,
                mode: "symmetric-20",
                gapSize,
              }
            : {
                type: "expansion.expand",
                file,
                ref: boundaryRef as number,
                direction: "up",
                mode: "symmetric-20",
                gapSize,
              };
        return { expansion, landing: null };
      }
      // "all": the entire remaining gap is revealed → next render drops
      // the banner. Issue #306 orphan path.
      const orphanKind: ExpandOrphanKind =
        subKind === "boundary-top" ? "boundary-top" : "hunk-separator";
      const landing = pickLanding(synthetic, flatRowsBefore, orphanKind);
      const expansion: ExpansionAction =
        boundaryRef === "top"
          ? { type: "expansion.expandTop", file, mode: "all", gapSize }
          : boundaryRef === "bottom"
            ? {
                type: "expansion.expandBottom",
                file,
                mode: "all",
                gapSize,
              }
            : {
                type: "expansion.expand",
                file,
                ref: boundaryRef as number,
                direction: "both",
                mode: "all",
                gapSize,
              };
      return { expansion, landing };
    }
    case "collapsed-file": {
      const landing = pickLanding(synthetic, flatRowsBefore, "collapsed-file");
      return {
        expansion: { type: "expansion.expandFile", file },
        landing,
      };
    }
  }
}

/** Wraps `cursorAfterExpand` and returns `null` when the helper hands the
 *  input back (its fallback branch when no walkable diff row exists in
 *  the file). This way the dispatcher can `if (landing) dispatch(...)`
 *  without redispatching the synthetic anchor's own state. */
function pickLanding(
  synthetic: RowAnchor,
  flatRowsBefore: ReadonlyArray<FlatRow>,
  orphanKind: ExpandOrphanKind,
): RowAnchor | null {
  const landed = cursorAfterExpand(synthetic, flatRowsBefore, orphanKind);
  if (landed === synthetic) return null;
  if (landed.kind !== "row") return null;
  return landed;
}
