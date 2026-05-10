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
  /** Flipped by the collapsed-file slice (PRD #108 slice #5); unused here. */
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

const SYMMETRIC_STEP = 10;

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
): ExpansionState {
  return applyExpand(state, key, mode, gapSize, "both");
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
