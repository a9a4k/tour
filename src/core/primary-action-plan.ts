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
import { SYMMETRIC_STEP, type BoundaryExpansion } from "./expansion-state.js";
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

/** Per-press total for a single-direction `symmetric-20` press
 *  (`"up"` or `"down"`). Mirrors the reducer's `Math.min(SYMMETRIC_STEP *
 *  2, remaining)` for those directions; importing `SYMMETRIC_STEP` keeps
 *  the planner's orphan prediction in lockstep with the reducer math. */
const SYMMETRIC_STEP_TOTAL = SYMMETRIC_STEP * 2;

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
      let orphanKind: ExpandOrphanKind | null = null;
      if (boundaryRef === "bottom") {
        if (newRemaining <= 0) orphanKind = "expand-down-bottom";
      } else if (newRemaining < GAP_TWO_ROW_THRESHOLD) {
        orphanKind = "expand-down-mid";
      }
      const landing =
        orphanKind === null
          ? null
          : pickLanding(synthetic, flatRowsBefore, orphanKind);
      // Issue #381: producer-side translation from the standalone row's
      // user-facing `↓` glyph to the reducer's gap-edge direction. The
      // user expects ↓ to grow the visible context downward from the
      // previous hunk's end (line numbers `prevEnd + 1, ...`), which
      // sits at the *top edge* of the gap — that's `direction: "up"`
      // in the reducer's gap-edge vocabulary. The file-bottom case
      // (boundaryRef === "bottom") is unilateral and unaffected; the
      // reducer's `expandBottom` always grows `down` regardless.
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
              direction: "up",
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
        // Issue #381: producer-side translation from the banner's
        // user-facing `↑` glyph to the reducer's gap-edge direction.
        // The user expects ↑ to reveal lines that render immediately
        // above the banner (line numbers approaching `currentStart - 1`
        // from below), which sits at the *bottom edge* of the gap —
        // that's `direction: "down"` in the reducer's gap-edge
        // vocabulary. The file-top case (boundaryRef === "top") is
        // unilateral and unaffected; the reducer's `expandTop` always
        // grows `up` regardless.
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
                direction: "down",
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
      let expansion: ExpansionAction;
      if (boundaryRef === "top") {
        expansion = { type: "expansion.expandTop", file, mode: "all", gapSize };
      } else if (boundaryRef === "bottom") {
        expansion = { type: "expansion.expandBottom", file, mode: "all", gapSize };
      } else {
        expansion = {
          type: "expansion.expand",
          file,
          ref: boundaryRef,
          direction: "both",
          mode: "all",
          gapSize,
        };
      }
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
