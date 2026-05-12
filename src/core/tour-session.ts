import { useSyncExternalStore } from "react";
import type { PickerRow } from "./tour-list.js";
import type { TourBundle } from "./tour-bundle.js";
import type { ReplyLock } from "./reply-lock.js";
import type { Tour } from "./types.js";

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
// cursor/folds/composer slices land in later slices and are intentionally
// absent from slice 1.
export interface TourSessionState {
  currentTourId: string | null;
  tourList: RemoteData<TourSummary[]>;
  bundle: RemoteData<TourBundle>;
  replyLock: RemoteData<ReplyLock | null>;
  picker: PickerState;
  layout: Layout;
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
  | { type: "tourList.failed"; error: string };

export type Intent =
  | { type: "loadTour"; tourId: string }
  | { type: "scrollPickerRow"; idx: number }
  | { type: "mirrorUrl"; tourId: string };

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
      // tour, so the Tour-switch reset cascade must not fire.
      return {
        state: { ...state, bundle: { kind: "ok", value: action.bundle } },
        intents: NO_INTENTS,
      };

    case "bundle.failed":
      return {
        state: { ...state, bundle: { kind: "err", error: action.error } },
        intents: NO_INTENTS,
      };

    case "tour.switched":
      // CONTEXT-pinned Tour-switch reset rules: layout preserved; picker
      // closed; reply-lock reset; cursor/folds/composer reset when those
      // slices land in later slices (no-op for slice 1). Distinct from
      // `bundle.refreshed` so a same-tour watcher reload doesn't dump
      // picker / replyLock state.
      return {
        state: {
          ...state,
          bundle: { kind: "ok", value: action.bundle },
          currentTourId: action.tourId,
          picker: { kind: "closed" },
          replyLock: { kind: "idle" },
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
  }
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
