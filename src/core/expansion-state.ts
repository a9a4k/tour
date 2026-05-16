/**
 * Per-tour Hidden-context expansion state (ADR 0013, PRD #108).
 *
 * The TUI keeps a single `ExpansionState` in App-level React state, feeds it
 * to `core/diff-rows.ts` `planRows` each render, and updates it via the
 * reducers below in response to cursor + Enter / Shift+Enter on an
 * interactive row. The reducer is pure and immutable in / immutable out so
 * React state-update semantics hold.
 *
 * Boundary identity:
 *   - `ref: number` — hunk-separator gap *before* hunk index `n`. Matches
 *     `InteractiveRow.boundaryRef` for `subKind: 'hunk-separator'`.
 *   - `ref: 'top'`  — file-top synthetic boundary (gap from line 1 to first
 *     hunk).
 *   - `ref: 'bottom'` — file-bottom synthetic boundary (gap from last hunk
 *     to EOF).
 *
 * `BoundaryExpansion.up` counts lines revealed at the *top* of the gap
 * (lower line numbers, closer to the previous hunk's end for separators,
 * closer to line 1 for `'top'`, closer to the last hunk for `'bottom'`).
 * `down` counts at the *bottom* of the gap (higher line numbers). `up + down`
 * may not exceed the gap's hidden-line count; the reducer enforces this
 * saturation invariant.
 */

export type BoundaryRef = number | "top" | "bottom";

export interface BoundaryKey {
  file: string;
  ref: BoundaryRef;
}

export interface BoundaryExpansion {
  up: number;
  down: number;
}

export interface FileExpansion {
  /** Set by `expandFile` (PRD #108 issue #113). When `true`, a classifier-
   *  collapsed file emits its normal diff stream instead of the synthetic
   *  CollapsedFileRow. One-way in this slice — re-collapse is not exposed
   *  through a reducer (the App layer owns the parallel `c` toggle path). */
  fileExpanded: boolean;
  boundaries: Map<BoundaryRef, BoundaryExpansion>;
}

export type ExpansionState = Map<string, FileExpansion>;

export type ExpandMode = "symmetric-20" | "all";

export interface OrphanWindow {
  file: string;
  ref: BoundaryRef;
  fromStart: number;
  fromEnd: number;
}

/** Per-side step in `symmetric-20` mode. A single-direction press
 *  (`"up"` / `"down"`) reveals `SYMMETRIC_STEP * 2` lines total; a
 *  `"both"` press reveals `SYMMETRIC_STEP` lines on each side. Exported
 *  so the per-press total is computable from one source — see
 *  `core/primary-action-plan.ts`, which uses `SYMMETRIC_STEP * 2` to
 *  predict orphan-landings against the same reducer math. */
export const SYMMETRIC_STEP = 10;

export function emptyExpansion(): ExpansionState {
  return new Map();
}

export function getBoundary(
  state: ExpansionState,
  key: BoundaryKey,
): BoundaryExpansion {
  const file = state.get(key.file);
  if (!file) return { up: 0, down: 0 };
  return file.boundaries.get(key.ref) ?? { up: 0, down: 0 };
}

export function getFileExpanded(state: ExpansionState, file: string): boolean {
  return state.get(file)?.fileExpanded ?? false;
}

export function expand(
  state: ExpansionState,
  key: BoundaryKey,
  mode: ExpandMode,
  gapSize: number,
  direction: "up" | "down" | "both" = "both",
): ExpansionState {
  return applyExpand(state, key, mode, gapSize, direction);
}

export function expandTop(
  state: ExpansionState,
  file: string,
  mode: ExpandMode,
  gapSize: number,
): ExpansionState {
  return applyExpand(state, { file, ref: "top" }, mode, gapSize, "up");
}

export function expandBottom(
  state: ExpansionState,
  file: string,
  mode: ExpandMode,
  gapSize: number,
): ExpansionState {
  return applyExpand(state, { file, ref: "bottom" }, mode, gapSize, "down");
}

export function expandFile(state: ExpansionState, file: string): ExpansionState {
  const cur = state.get(file);
  if (cur?.fileExpanded) return state;
  const next: ExpansionState = new Map(state);
  next.set(file, {
    fileExpanded: true,
    boundaries: cur?.boundaries ?? new Map<BoundaryRef, BoundaryExpansion>(),
  });
  return next;
}

/** One file boundary's gap size — caller provides one entry per addressable
 *  boundary (file-top, file-bottom, each mid-file hunk-separator). PRD #270
 *  / issue #274 (Slice 4): drives `expandFileAll` so the reducer can saturate
 *  every gap in the file in one pure-helper call, without re-deriving the
 *  per-boundary gap size that the surfaces already computed for the row
 *  stream. */
export interface FileBoundaryGap {
  ref: BoundaryRef;
  gapSize: number;
}

/** Saturate every hidden gap in a file in one pass. PRD #270 / issue #274
 *  (Slice 4): the per-file Expand-all-hidden button / TUI affordance
 *  dispatches a single action that reveals every gap in the file at once
 *  (replacing the role that `Shift+Enter` used to play for whole-file
 *  expansion). Direction follows the existing per-boundary convention:
 *  `"top"` reveals toward line 1 (`up`), `"bottom"` reveals toward EOF
 *  (`down`), numeric refs split symmetrically (`both`). Empty `boundaries`
 *  list returns the input state by reference. */
export function expandFileAll(
  state: ExpansionState,
  file: string,
  boundaries: ReadonlyArray<FileBoundaryGap>,
): ExpansionState {
  if (boundaries.length === 0) return state;
  let next = state;
  for (const b of boundaries) {
    const direction: Direction =
      b.ref === "top" ? "up" : b.ref === "bottom" ? "down" : "both";
    next = applyExpand(next, { file, ref: b.ref }, "all", b.gapSize, direction);
  }
  return next;
}

export function seedFromOrphans(
  state: ExpansionState,
  windows: OrphanWindow[],
): ExpansionState {
  if (windows.length === 0) return state;
  const next: ExpansionState = new Map(state);
  for (const w of windows) {
    const file = next.get(w.file);
    const boundaries = file ? new Map(file.boundaries) : new Map<BoundaryRef, BoundaryExpansion>();
    const prev = boundaries.get(w.ref) ?? { up: 0, down: 0 };
    boundaries.set(w.ref, {
      up: Math.max(prev.up, w.fromStart),
      down: Math.max(prev.down, w.fromEnd),
    });
    next.set(w.file, {
      fileExpanded: file?.fileExpanded ?? false,
      boundaries,
    });
  }
  return next;
}

type Direction = "both" | "up" | "down";

function applyExpand(
  state: ExpansionState,
  key: BoundaryKey,
  mode: ExpandMode,
  gapSize: number,
  direction: Direction,
): ExpansionState {
  if (gapSize <= 0) return state;
  const cur = getBoundary(state, key);
  const remaining = gapSize - cur.up - cur.down;
  if (remaining <= 0) return state;

  let addUp = 0;
  let addDown = 0;

  if (mode === "all") {
    if (direction === "up") addUp = remaining;
    else if (direction === "down") addDown = remaining;
    else {
      // Distribute remaining across up + down; halves keep the visual centred.
      addUp = Math.ceil(remaining / 2);
      addDown = remaining - addUp;
    }
  } else {
    // symmetric-20: each press adds up to SYMMETRIC_STEP per side, capped by
    // remaining capacity. For unilateral boundaries (top/bottom), all of the
    // 2× step lands on the active side.
    if (direction === "up") {
      addUp = Math.min(SYMMETRIC_STEP * 2, remaining);
    } else if (direction === "down") {
      addDown = Math.min(SYMMETRIC_STEP * 2, remaining);
    } else {
      addUp = Math.min(SYMMETRIC_STEP, remaining);
      addDown = Math.min(SYMMETRIC_STEP, remaining - addUp);
    }
  }

  if (addUp === 0 && addDown === 0) return state;

  const next: ExpansionState = new Map(state);
  const file = next.get(key.file);
  const boundaries = file ? new Map(file.boundaries) : new Map<BoundaryRef, BoundaryExpansion>();
  boundaries.set(key.ref, { up: cur.up + addUp, down: cur.down + addDown });
  next.set(key.file, {
    fileExpanded: file?.fileExpanded ?? false,
    boundaries,
  });
  return next;
}
