import { useSyncExternalStore } from "react";
import type { PickerRow } from "./tour-list.js";
import type { TourBundle } from "./tour-bundle.js";
import type { ReplyLock } from "./reply-lock.js";
import type { Tour } from "./types.js";
import type { Cursor } from "./cursor-state.js";
import { isCardAnchor, isRowAnchor } from "./cursor-state.js";
import type {
  BoundaryRef,
  ExpandMode,
  ExpansionState,
  OrphanWindow,
} from "./expansion-state.js";
import {
  emptyExpansion,
  expand as expandBoundary,
  expandBottom as expansionExpandBottom,
  expandFile as expansionExpandFile,
  expandTop as expansionExpandTop,
  seedFromOrphans as expansionSeedFromOrphans,
} from "./expansion-state.js";

// RemoteData<T> — one uniform shape for asynchronously-loaded values.
// Replaces the three encodings used today across the surfaces:
//   { bundle, error, loaded }  →  RemoteData<TourBundle>
//   T | null                    →  RemoteData<T[]>
//   T | null + silent catch     →  RemoteData<T | null>
// Crucially makes the "loaded + null bundle + non-null error" combination
// unrepresentable. The Tour bundle's existing `{kind: "ok" | "snapshot-lost"}`
// domain discriminator nests inside `ok(...)` cleanly.
export type RemoteData<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: T }
  | { kind: "err"; error: string };

export function isOk<T>(d: RemoteData<T>): d is { kind: "ok"; value: T } {
  return d.kind === "ok";
}

export function map<T, U>(d: RemoteData<T>, f: (value: T) => U): RemoteData<U> {
  return d.kind === "ok" ? { kind: "ok", value: f(d.value) } : d;
}

export function withDefault<T>(d: RemoteData<T>, fallback: T): T {
  return d.kind === "ok" ? d.value : fallback;
}

export interface TourSummary {
  id: string;
  title: string;
  status: Tour["status"];
  created_at: string;
}

export type PickerState =
  | { kind: "closed" }
  | { kind: "open"; rows: PickerRow[]; cursor: number };

export type Layout = "split" | "unified";

// The state aggregate a single surface drives for one opened Tour. Per
// the CONTEXT.md Tour-session entry: layout is preserved across Tour-switch;
// cursor + expansion slices arrive in slice 2 (PRD #229 / issue #230);
// folds / composer slices land later still.
export interface TourSessionState {
  currentTourId: string | null;
  tourList: RemoteData<TourSummary[]>;
  bundle: RemoteData<TourBundle>;
  replyLock: RemoteData<ReplyLock | null>;
  picker: PickerState;
  layout: Layout;
  cursor: Cursor | null;
  expansion: ExpansionState;
}

export type Action =
  | { type: "picker.open"; rows: PickerRow[] }
  | { type: "picker.close" }
  | { type: "picker.move"; delta: number }
  | { type: "picker.commit" }
  | { type: "bundle.loading"; tourId: string }
  | { type: "bundle.refreshed"; bundle: TourBundle }
  | { type: "bundle.failed"; tourId: string; error: string }
  | { type: "tour.switched"; tourId: string; bundle: TourBundle }
  | { type: "replyLock.loaded"; replyLock: ReplyLock | null }
  | { type: "tourList.loading" }
  | { type: "tourList.loaded"; tours: TourSummary[] }
  | { type: "tourList.failed"; error: string }
  | { type: "cursor.set"; anchor: Cursor }
  | { type: "cursor.clear" }
  | { type: "cursor.setSide"; side: "additions" | "deletions" }
  | { type: "cursor.materialize"; anchor: Cursor }
  | {
      type: "expansion.expand";
      file: string;
      ref: BoundaryRef;
      direction: "up" | "down" | "both";
      mode: ExpandMode;
      gapSize: number;
    }
  | { type: "expansion.expandTop"; file: string; mode: ExpandMode; gapSize: number }
  | { type: "expansion.expandBottom"; file: string; mode: ExpandMode; gapSize: number }
  | { type: "expansion.expandFile"; file: string }
  | { type: "expansion.seedFromOrphans"; windows: OrphanWindow[] };

export type ScrollCursorTarget =
  | { kind: "row"; file: string; side: "additions" | "deletions"; lineNumber: number }
  | { kind: "card"; annotationId: string };

export type Intent =
  | { type: "loadTour"; tourId: string }
  | { type: "scrollPickerRow"; idx: number }
  | { type: "mirrorUrl"; tourId: string }
  | { type: "revalidateCursor" }
  | { type: "scrollCursorTarget"; target: ScrollCursorTarget }
  | { type: "revealSidebarFile"; file: string }
  | { type: "mirrorAnnUrl"; annotationId: string | null };

export interface ReduceResult {
  state: TourSessionState;
  intents: Intent[];
}

export function initialTourSessionState(): TourSessionState {
  return {
    currentTourId: null,
    tourList: { kind: "idle" },
    bundle: { kind: "idle" },
    replyLock: { kind: "idle" },
    picker: { kind: "closed" },
    layout: "split",
    cursor: null,
    expansion: emptyExpansion(),
  };
}

const NO_INTENTS: Intent[] = [];

export function reduce(state: TourSessionState, action: Action): ReduceResult {
  switch (action.type) {
    case "picker.open":
      return {
        state: { ...state, picker: { kind: "open", rows: action.rows, cursor: 0 } },
        intents: NO_INTENTS,
      };

    case "picker.close":
      if (state.picker.kind === "closed") return { state, intents: NO_INTENTS };
      return { state: { ...state, picker: { kind: "closed" } }, intents: NO_INTENTS };

    case "picker.move": {
      if (state.picker.kind !== "open") return { state, intents: NO_INTENTS };
      const len = state.picker.rows.length;
      if (len === 0) return { state, intents: NO_INTENTS };
      const clamped = Math.max(0, Math.min(len - 1, state.picker.cursor + action.delta));
      const nextPicker: PickerState =
        clamped === state.picker.cursor
          ? state.picker
          : { ...state.picker, cursor: clamped };
      const nextState = nextPicker === state.picker ? state : { ...state, picker: nextPicker };
      return { state: nextState, intents: [{ type: "scrollPickerRow", idx: clamped }] };
    }

    case "picker.commit": {
      if (state.picker.kind !== "open") return { state, intents: NO_INTENTS };
      if (state.picker.rows.length === 0) return { state, intents: NO_INTENTS };
      const tourId = state.picker.rows[state.picker.cursor].id;
      return {
        state: {
          ...state,
          picker: { kind: "closed" },
          bundle: { kind: "loading" },
          currentTourId: tourId,
        },
        intents: [
          { type: "loadTour", tourId },
          { type: "mirrorUrl", tourId },
        ],
      };
    }

    case "bundle.loading":
      return {
        state: {
          ...state,
          bundle: { kind: "loading" },
          currentTourId: action.tourId,
        },
        intents: NO_INTENTS,
      };

    case "bundle.refreshed":
      // Same-tour bundle update (watcher reload / SSE annotation-changed).
      // Replaces the bundle slice in place; intentionally does NOT touch
      // picker / replyLock / currentTourId — the user is still on the same
      // tour, so the Tour-switch reset cascade must not fire. Emits
      // `revalidateCursor` iff the cursor slice is non-null so the surface
      // can recompute its substrate-derived flat-rows and snap/clear the
      // anchor against the new bundle.
      return {
        state: { ...state, bundle: { kind: "ok", value: action.bundle } },
        intents:
          state.cursor === null
            ? NO_INTENTS
            : [{ type: "revalidateCursor" }],
      };

    case "bundle.failed":
      return {
        state: { ...state, bundle: { kind: "err", error: action.error } },
        intents: NO_INTENTS,
      };

    case "tour.switched":
      // CONTEXT-pinned Tour-switch reset rules: layout preserved; picker
      // closed; reply-lock reset; cursor → null and expansion → empty
      // (slice 2 additions per PRD #229 / issue #230); folds / composer
      // reset when those slices land. Distinct from `bundle.refreshed` so
      // a same-tour watcher reload doesn't dump picker / replyLock /
      // cursor / expansion state.
      return {
        state: {
          ...state,
          bundle: { kind: "ok", value: action.bundle },
          currentTourId: action.tourId,
          picker: { kind: "closed" },
          replyLock: { kind: "idle" },
          cursor: null,
          expansion: emptyExpansion(),
        },
        intents: NO_INTENTS,
      };

    case "replyLock.loaded":
      return {
        state: { ...state, replyLock: { kind: "ok", value: action.replyLock } },
        intents: NO_INTENTS,
      };

    case "tourList.loading":
      return { state: { ...state, tourList: { kind: "loading" } }, intents: NO_INTENTS };

    case "tourList.loaded":
      return {
        state: { ...state, tourList: { kind: "ok", value: action.tours } },
        intents: NO_INTENTS,
      };

    case "tourList.failed":
      return {
        state: { ...state, tourList: { kind: "err", error: action.error } },
        intents: NO_INTENTS,
      };

    case "cursor.set":
      return setCursor(state, action.anchor);

    case "cursor.clear": {
      if (state.cursor === null) return { state, intents: NO_INTENTS };
      const intents: Intent[] = isCardAnchor(state.cursor)
        ? [{ type: "mirrorAnnUrl", annotationId: null }]
        : NO_INTENTS;
      return { state: { ...state, cursor: null }, intents };
    }

    case "cursor.setSide": {
      if (state.cursor === null) return { state, intents: NO_INTENTS };
      const c = state.cursor;
      // RowAnchor on a paired diff row: surfaces dispatch `cursor.set` with
      // the lineNumber recomputed by `setCursorSide(...)` so the action
      // payload stays small. This action is the pure-preference update path
      // — used by `h`/`l` on cards and interactive rows where the visible
      // anchor doesn't move but the next diff-row landing should honour the
      // new preferredSide. Updating `side` on a RowAnchor in addition to
      // preferredSide keeps the slice consistent if a surface dispatches
      // setSide directly on a row anchor (no lineNumber recomputation —
      // that's the surface's job via the helper).
      if (c.kind === "row") {
        if (c.side === action.side && c.preferredSide === action.side) {
          return { state, intents: NO_INTENTS };
        }
        return {
          state: { ...state, cursor: { ...c, side: action.side, preferredSide: action.side } },
          intents: NO_INTENTS,
        };
      }
      if (c.preferredSide === action.side) return { state, intents: NO_INTENTS };
      return {
        state: { ...state, cursor: { ...c, preferredSide: action.side } },
        intents: NO_INTENTS,
      };
    }

    case "cursor.materialize":
      // Lazy first-interaction landing (ADR 0012 / PRD #192 / issue #125):
      // only initialises when the cursor is null. A non-null cursor is a
      // strict no-op — same state ref, no intents — so subsequent
      // keystrokes use `cursor.set` to update an already-materialised
      // anchor.
      if (state.cursor !== null) return { state, intents: NO_INTENTS };
      return setCursor(state, action.anchor);

    case "expansion.expand":
      return withExpansion(
        state,
        expandBoundary(
          state.expansion,
          { file: action.file, ref: action.ref },
          action.mode,
          action.gapSize,
          action.direction,
        ),
      );

    case "expansion.expandTop":
      return withExpansion(
        state,
        expansionExpandTop(state.expansion, action.file, action.mode, action.gapSize),
      );

    case "expansion.expandBottom":
      return withExpansion(
        state,
        expansionExpandBottom(state.expansion, action.file, action.mode, action.gapSize),
      );

    case "expansion.expandFile":
      return withExpansion(state, expansionExpandFile(state.expansion, action.file));

    case "expansion.seedFromOrphans":
      return withExpansion(state, expansionSeedFromOrphans(state.expansion, action.windows));
  }
}

// Shared expansion-slice writer: every `expansion.*` action delegates to a
// pure helper in `core/expansion-state.ts` and is otherwise structurally
// identical — same-ref short-circuit, no intents, slice-only mutation.
function withExpansion(state: TourSessionState, next: ExpansionState): ReduceResult {
  if (next === state.expansion) return { state, intents: NO_INTENTS };
  return { state: { ...state, expansion: next }, intents: NO_INTENTS };
}

// Shared `cursor.set` / `cursor.materialize` transition: writes the slice
// and derives the visual-side-effect intent stream from the (prev, next)
// pair. `scrollCursorTarget` always fires (the cursor moved, so the
// surface re-centers it). `revealSidebarFile` fires when the resolved
// file changed — only RowAnchors have a resolvable file, so a Card→Card
// or Row→Card move doesn't reveal anything. `mirrorAnnUrl` fires when
// the annotation-id under the cursor changed (entering, leaving, or
// switching cards) so the webapp `?ann=` URL stays in sync.
function setCursor(state: TourSessionState, next: Cursor): ReduceResult {
  const intents: Intent[] = [
    { type: "scrollCursorTarget", target: scrollTargetOf(next) },
  ];
  const prevFile = isRowAnchor(state.cursor) ? state.cursor.file : null;
  const nextFile = isRowAnchor(next) ? next.file : null;
  if (nextFile !== null && nextFile !== prevFile) {
    intents.push({ type: "revealSidebarFile", file: nextFile });
  }
  const prevAnnId = isCardAnchor(state.cursor) ? state.cursor.annotationId : null;
  const nextAnnId = isCardAnchor(next) ? next.annotationId : null;
  if (prevAnnId !== nextAnnId) {
    intents.push({ type: "mirrorAnnUrl", annotationId: nextAnnId });
  }
  return { state: { ...state, cursor: next }, intents };
}

function scrollTargetOf(c: Cursor): ScrollCursorTarget {
  if (c.kind === "card") return { kind: "card", annotationId: c.annotationId };
  return { kind: "row", file: c.file, side: c.side, lineNumber: c.lineNumber };
}

// --- Selectors --------------------------------------------------------------

export function isPickerOpen(state: TourSessionState): boolean {
  return state.picker.kind === "open";
}

export function pickerHighlighted(state: TourSessionState): PickerRow | null {
  if (state.picker.kind !== "open") return null;
  return state.picker.rows[state.picker.cursor] ?? null;
}

export function currentTourSummary(state: TourSessionState): TourSummary | null {
  if (state.currentTourId === null) return null;
  if (state.tourList.kind !== "ok") return null;
  const id = state.currentTourId;
  return state.tourList.value.find((t) => t.id === id) ?? null;
}

// Returns the resolved TourBundle when the bundle slice is in `ok` state,
// regardless of the bundle's inner `{kind: "ok" | "snapshot-lost"}` domain
// discriminator. Lets callers ask "is the bundle ready to render?" in one
// call instead of two `if` ladders. Returns null when the bundle is idle /
// loading / failed.
export function isBundleResolved(state: TourSessionState): TourBundle | null {
  return state.bundle.kind === "ok" ? state.bundle.value : null;
}

// Returns the resolved ReplyLock value when the replyLock slice is in `ok`
// state, else null. Mirrors `isBundleResolved` so callers don't repeat the
// `state.replyLock.kind === "ok" ? state.replyLock.value : null` ladder.
// Note: the inner value can itself be null (lock genuinely absent) — that
// is distinct from `idle` (slice never observed).
export function resolvedReplyLock(state: TourSessionState): ReplyLock | null {
  return state.replyLock.kind === "ok" ? state.replyLock.value : null;
}

// --- Store ------------------------------------------------------------------

type StateListener = () => void;
type IntentListener = (intent: Intent) => void;

export class TourSessionStore {
  private state: TourSessionState;
  private readonly listeners = new Set<StateListener>();
  private readonly intentListeners = new Set<IntentListener>();

  constructor(initial: TourSessionState = initialTourSessionState()) {
    this.state = initial;
  }

  readonly getState = (): TourSessionState => this.state;

  readonly subscribe = (listener: StateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly onIntent = (listener: IntentListener): (() => void) => {
    this.intentListeners.add(listener);
    return () => {
      this.intentListeners.delete(listener);
    };
  };

  readonly dispatch = (action: Action): void => {
    const { state: next, intents } = reduce(this.state, action);
    if (next !== this.state) {
      this.state = next;
      for (const l of this.listeners) l();
    }
    for (const intent of intents) {
      for (const l of this.intentListeners) l(intent);
    }
  };
}

// --- React glue -------------------------------------------------------------

export function useTourSession(store: TourSessionStore): TourSessionState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
