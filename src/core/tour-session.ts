import { useSyncExternalStore } from "react";
import type { PickerRow } from "./tour-list.js";
import type { BundleFile, TourBundle } from "./tour-bundle.js";
import type { ReplyLock } from "./reply-lock.js";
import type { Annotation, Tour } from "./types.js";
import type { Cursor } from "./cursor-state.js";
import { isCardAnchor, isRowAnchor } from "./cursor-state.js";
import type {
  BoundaryRef,
  ExpandMode,
  ExpansionState,
  FileBoundaryGap,
  OrphanWindow,
} from "./expansion-state.js";
import {
  emptyExpansion,
  expand as expandBoundary,
  expandBottom as expansionExpandBottom,
  expandFile as expansionExpandFile,
  expandFileAll as expansionExpandFileAll,
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

// Composer target: parent annotation id for replies, file + side + line range
// for a top-level annotation. The reply target deliberately carries the parent
// annotation **id** (not the full Annotation) so the slice doesn't go stale
// when the bundle refreshes mid-composition — issue #236, PRD #234 under
// PRD #207.
export type ComposerTarget =
  | {
      kind: "top-level";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
    }
  | { kind: "reply"; replies_to: string };

// Tagged-union state machine for the annotation composer (PRD #234). The
// surface's three useStates (composerTarget + composerError + textarea body
// on the webapp; one ComposerState | null on the TUI) collapse to one
// authoritative slice. `submitting` and `errored` preserve target + body so
// retry / dismissError can resume cleanly.
export type ComposerSlice =
  | { kind: "closed" }
  | { kind: "open"; target: ComposerTarget; body: string }
  | { kind: "submitting"; target: ComposerTarget; body: string }
  | { kind: "errored"; target: ComposerTarget; body: string; error: string };

// The state aggregate a single surface drives for one opened Tour. Per
// the CONTEXT.md Tour-session entry: layout is preserved across Tour-switch;
// cursor + expansion slices arrive in slice 2 (PRD #229 / issue #230);
// composer + folds slices land in slice 3 (PRD #234 / issue #236).
export interface TourSessionState {
  currentTourId: string | null;
  tourList: RemoteData<TourSummary[]>;
  bundle: RemoteData<TourBundle>;
  replyLock: RemoteData<ReplyLock | null>;
  picker: PickerState;
  layout: Layout;
  cursor: Cursor | null;
  expansion: ExpansionState;
  composer: ComposerSlice;
  collapsedFolders: Set<string>;
  collapsedOverrides: Record<string, boolean>;
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
  | { type: "cursor.set"; anchor: Cursor; placement?: ScrollPlacement }
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
  | {
      type: "expansion.expandFileAll";
      file: string;
      boundaries: ReadonlyArray<FileBoundaryGap>;
    }
  | { type: "expansion.seedFromOrphans"; windows: OrphanWindow[] }
  | { type: "composer.open"; target: ComposerTarget }
  | { type: "composer.close" }
  | { type: "composer.setBody"; body: string }
  | { type: "composer.submit" }
  | { type: "composer.submitted"; annotation: Annotation }
  | { type: "composer.failed"; error: string }
  | { type: "composer.retry" }
  | { type: "composer.dismissError" }
  | { type: "composer.recall" }
  | { type: "folds.toggleFolder"; path: string }
  | { type: "folds.setOverride"; file: string; value: boolean }
  | { type: "folds.clearOverride"; file: string }
  | { type: "folds.clearAll" }
  | { type: "layout.set"; layout: Layout }
  | { type: "send-to-agent"; tourId: string; annotationId: string };

export type ScrollCursorTarget =
  | { kind: "row"; file: string; side: "additions" | "deletions"; lineNumber: number }
  | { kind: "card"; annotationId: string };

// `nearest`: only scroll when target is off-screen — used for `n`/`p` and
// `j`/`k` so adjacent landings don't jolt. `center`: always frame the target
// in the middle — used for fresh landings (initial bundle load, URL `?ann=`
// restore, post-create scroll-to-new-card) where the user is arriving cold.
export type ScrollPlacement = "nearest" | "center";

export type Intent =
  | { type: "loadTour"; tourId: string }
  | { type: "scrollPickerRow"; idx: number }
  | { type: "mirrorUrl"; tourId: string }
  | { type: "revalidateCursor" }
  | { type: "scrollCursorTarget"; target: ScrollCursorTarget; placement: ScrollPlacement }
  | { type: "selectSidebarFile"; file: string }
  | { type: "mirrorAnnUrl"; annotationId: string | null }
  | { type: "submitAnnotation"; tourId: string; target: ComposerTarget; body: string }
  | { type: "scrollToAnnotation"; annotationId: string }
  | { type: "scrollToComposer"; target: ComposerTarget }
  | { type: "requestReply"; tourId: string; annotationId: string };

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
    composer: { kind: "closed" },
    collapsedFolders: new Set<string>(),
    collapsedOverrides: {},
  };
}

const NO_INTENTS: Intent[] = [];

// Stitch `BundleFile.orphanWindows` (file-grouped, no `file` field) into the
// flat `OrphanWindow[]` shape `expansionSeedFromOrphans` consumes. Used by
// the `tour.switched` and `bundle.refreshed` branches to fold orphan-window
// seeding into the reducer (PRD #278 slice 1).
function flattenOrphanWindows(files: ReadonlyArray<BundleFile>): OrphanWindow[] {
  const out: OrphanWindow[] = [];
  for (const f of files) {
    for (const w of f.orphanWindows) {
      out.push({ file: f.name, ref: w.ref, fromStart: w.fromStart, fromEnd: w.fromEnd });
    }
  }
  return out;
}

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
      // Emits `loadTour` so the surface entry points (popstate / auto-pick /
      // initial mount) can route through the Tour-session runtime instead of
      // calling their own fetcher. `picker.commit` separately emits its own
      // `loadTour` (alongside `mirrorUrl`) — it does NOT dispatch
      // `bundle.loading` so there's no double-emit. PRD #278 slice 3.
      return {
        state: {
          ...state,
          bundle: { kind: "loading" },
          currentTourId: action.tourId,
        },
        intents: [{ type: "loadTour", tourId: action.tourId }],
      };

    case "bundle.refreshed": {
      // Same-tour bundle update (watcher reload / SSE annotation-changed).
      // Replaces the bundle slice in place; intentionally does NOT touch
      // picker / replyLock / currentTourId — the user is still on the same
      // tour, so the Tour-switch reset cascade must not fire. Emits
      // `revalidateCursor` iff the cursor slice is non-null so the surface
      // can recompute its substrate-derived flat-rows and snap/clear the
      // anchor against the new bundle.
      //
      // PRD #278 slice 1: orphan-window seeding is folded into the reducer.
      // The expansion slice unions with `bundle.files[*].orphanWindows` via
      // per-side `Math.max`, so manual user expansion is preserved across
      // watcher reloads (issue #114). Empty / absent windows leave the slice
      // ref-equal (same-ref short-circuit in `expansionSeedFromOrphans`).
      const expansion =
        action.bundle.kind === "ok"
          ? expansionSeedFromOrphans(state.expansion, flattenOrphanWindows(action.bundle.files))
          : state.expansion;
      return {
        state: { ...state, bundle: { kind: "ok", value: action.bundle }, expansion },
        intents: revalidateIfCursor(state),
      };
    }

    case "bundle.failed":
      return {
        state: { ...state, bundle: { kind: "err", error: action.error } },
        intents: NO_INTENTS,
      };

    case "tour.switched": {
      // CONTEXT-pinned Tour-switch reset rules: layout preserved; picker
      // closed; reply-lock reset; cursor → null and expansion → empty
      // (slice 2 additions per PRD #229 / issue #230); composer → closed
      // and folds (collapsedFolders + collapsedOverrides) → empty (slice 3
      // additions per PRD #234 / issue #236). Distinct from
      // `bundle.refreshed` so a same-tour watcher reload doesn't dump
      // picker / replyLock / cursor / expansion / composer / folds.
      //
      // PRD #278 slice 1: expansion resets to empty, then seeds from the
      // inbound bundle's orphan windows so Annotations whose anchor lives
      // in Hidden context render inline on first paint of the new tour.
      const expansion =
        action.bundle.kind === "ok"
          ? expansionSeedFromOrphans(emptyExpansion(), flattenOrphanWindows(action.bundle.files))
          : emptyExpansion();
      return {
        state: {
          ...state,
          bundle: { kind: "ok", value: action.bundle },
          currentTourId: action.tourId,
          picker: { kind: "closed" },
          replyLock: { kind: "idle" },
          cursor: null,
          expansion,
          composer: { kind: "closed" },
          collapsedFolders: new Set<string>(),
          collapsedOverrides: {},
        },
        intents: NO_INTENTS,
      };
    }

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
      return setCursor(state, action.anchor, action.placement ?? "nearest");

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
      // anchor. First-landing uses `center` placement: the surface frames
      // the cursor mid-viewport because the user is arriving cold.
      if (state.cursor !== null) return { state, intents: NO_INTENTS };
      return setCursor(state, action.anchor, "center");

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

    case "expansion.expandFileAll":
      return withExpansion(
        state,
        expansionExpandFileAll(state.expansion, action.file, action.boundaries),
      );

    case "expansion.seedFromOrphans":
      // No revalidateCursor: this action runs during `bundle.refreshed` /
      // `tour.switched`, both of which own their own cursor revalidation
      // (or reset). The action is also a no-op outside those paths.
      return withExpansion(state, expansionSeedFromOrphans(state.expansion, action.windows));

    case "composer.open":
      // Any prior kind → fresh `open` with empty body and the new target.
      // The reducer is the single home for "what does opening a composer
      // mean" — the surfaces no longer need to clear stale draft text or
      // error state when re-targeting.
      return {
        state: { ...state, composer: { kind: "open", target: action.target, body: "" } },
        intents: NO_INTENTS,
      };

    case "composer.close":
      if (state.composer.kind === "closed") return { state, intents: NO_INTENTS };
      return { state: { ...state, composer: { kind: "closed" } }, intents: NO_INTENTS };

    case "composer.setBody": {
      const c = state.composer;
      // Strict no-op on closed; harmless update on submitting / errored
      // (the user may keep typing while the submit is in flight, and
      // errored's body is preserved verbatim for retry).
      if (c.kind === "closed") return { state, intents: NO_INTENTS };
      if (c.body === action.body) return { state, intents: NO_INTENTS };
      return { state: { ...state, composer: { ...c, body: action.body } }, intents: NO_INTENTS };
    }

    case "composer.submit":
      return enterSubmitting(state, "open");

    case "composer.submitted": {
      // Submitting → closed; emit `scrollToAnnotation` so the freshly-
      // created annotation card scrolls into view (replaces the TUI's
      // `pendingScrollAnnotationId` useState per PRD #234).
      if (state.composer.kind !== "submitting") return { state, intents: NO_INTENTS };
      return {
        state: { ...state, composer: { kind: "closed" } },
        intents: [{ type: "scrollToAnnotation", annotationId: action.annotation.id }],
      };
    }

    case "composer.failed": {
      // Submitting → errored, preserving target + body so the user can
      // retry without re-typing.
      if (state.composer.kind !== "submitting") return { state, intents: NO_INTENTS };
      const { target, body } = state.composer;
      return {
        state: { ...state, composer: { kind: "errored", target, body, error: action.error } },
        intents: NO_INTENTS,
      };
    }

    case "composer.retry":
      return enterSubmitting(state, "errored");

    case "composer.dismissError": {
      // Errored → open with body preserved (target stays put; the
      // user can edit the draft and re-submit).
      if (state.composer.kind !== "errored") return { state, intents: NO_INTENTS };
      const { target, body } = state.composer;
      return {
        state: { ...state, composer: { kind: "open", target, body } },
        intents: NO_INTENTS,
      };
    }

    case "composer.recall": {
      // Issue #320: no state change. Emits `scrollToComposer` so the
      // adapter pulls the in-flight composer's anchor row + textarea
      // back to the user. Guarded no-op on closed (only the App-level
      // `+`-button branch dispatches it, and only while non-closed —
      // the guard is defence in depth).
      if (state.composer.kind === "closed") return { state, intents: NO_INTENTS };
      return {
        state,
        intents: [{ type: "scrollToComposer", target: state.composer.target }],
      };
    }

    case "folds.toggleFolder": {
      const next = new Set(state.collapsedFolders);
      if (next.has(action.path)) next.delete(action.path);
      else next.add(action.path);
      return {
        state: { ...state, collapsedFolders: next },
        intents: revalidateIfCursor(state),
      };
    }

    case "folds.setOverride": {
      if (state.collapsedOverrides[action.file] === action.value) {
        return { state, intents: NO_INTENTS };
      }
      return {
        state: {
          ...state,
          collapsedOverrides: { ...state.collapsedOverrides, [action.file]: action.value },
        },
        intents: revalidateIfCursor(state),
      };
    }

    case "folds.clearOverride": {
      if (!(action.file in state.collapsedOverrides)) return { state, intents: NO_INTENTS };
      const next = { ...state.collapsedOverrides };
      delete next[action.file];
      return {
        state: { ...state, collapsedOverrides: next },
        intents: revalidateIfCursor(state),
      };
    }

    case "folds.clearAll": {
      // Mirrors the inline fold reset inside `tour.switched`; exposed as an
      // action so surfaces (or tests) can clear both fold slices in one
      // dispatch. Same-ref short-circuit when both slices are already empty.
      if (state.collapsedFolders.size === 0 && Object.keys(state.collapsedOverrides).length === 0) {
        return { state, intents: NO_INTENTS };
      }
      return {
        state: {
          ...state,
          collapsedFolders: new Set<string>(),
          collapsedOverrides: {},
        },
        intents: revalidateIfCursor(state),
      };
    }

    case "layout.set":
      if (state.layout === action.layout) return { state, intents: NO_INTENTS };
      return { state: { ...state, layout: action.layout }, intents: NO_INTENTS };

    case "send-to-agent": {
      // Holds no state — the action's job is to emit the auto-recall + dispatch
      // intent pair (mirrors `composer.submit` → `submitAnnotation`). Defended
      // in depth: cursor must be on a CardAnchor and the reply-lock must not be
      // held. The full `canSendToAgent` verdict (author-kind, hasReply,
      // replyAgentConfigured) is gated upstream by the surface affordance —
      // the surface only dispatches when the verdict is `enabled`. PRD #278
      // slice 7.
      if (state.cursor === null || state.cursor.kind !== "card") {
        return { state, intents: NO_INTENTS };
      }
      if (state.replyLock.kind === "ok" && state.replyLock.value !== null) {
        return { state, intents: NO_INTENTS };
      }
      return {
        state,
        intents: [
          {
            type: "scrollCursorTarget",
            target: { kind: "card", annotationId: state.cursor.annotationId },
            placement: "center",
          },
          { type: "requestReply", tourId: action.tourId, annotationId: action.annotationId },
        ],
      };
    }
  }
}

// Shared expansion-slice writer: every `expansion.*` action delegates to a
// pure helper in `core/expansion-state.ts` and is otherwise structurally
// identical — same-ref short-circuit, slice-only mutation, and emits
// `revalidateCursor` when state mutated AND the cursor is non-null (issue
// #309, mirrors the `folds.*` wiring). Defence in depth on top of the
// surface-side `cursorAfterExpand` helper from issue #306 — surfaces that
// don't pre-compute a landing (or that miss an orphan kind) still recover.
function withExpansion(state: TourSessionState, next: ExpansionState): ReduceResult {
  if (next === state.expansion) return { state, intents: NO_INTENTS };
  return {
    state: { ...state, expansion: next },
    intents: revalidateIfCursor(state),
  };
}

// Returns the standard `revalidateCursor` intent list iff a non-null cursor
// is present. Shared by every reducer branch that mutates flat-rows-shape
// state in a way that can orphan `state.cursor`: `bundle.refreshed`, the
// four `folds.*` branches, and the `expansion.*` cluster via
// `withExpansion` (issue #309). The surface drains the intent by
// re-deriving the view and snapping (or clearing) the anchor via
// `validateCursor`.
function revalidateIfCursor(state: TourSessionState): Intent[] {
  return state.cursor === null ? NO_INTENTS : [{ type: "revalidateCursor" }];
}

// Open → submitting and errored → submitting share their entire transition:
// preserve target + body, move to submitting, emit `submitAnnotation` for the
// surface to realise via its `writeAnnotation` plumbing (in-process TUI / HTTP
// webapp). Guard on currentTourId: composer opens only while a tour is loaded
// (surface invariant), but a missing tourId would be a bug we surface as a
// no-op rather than emit an empty-string intent.
function enterSubmitting(
  state: TourSessionState,
  from: "open" | "errored",
): ReduceResult {
  if (state.composer.kind !== from) return { state, intents: NO_INTENTS };
  if (state.currentTourId === null) return { state, intents: NO_INTENTS };
  const { target, body } = state.composer;
  return {
    state: { ...state, composer: { kind: "submitting", target, body } },
    intents: [{ type: "submitAnnotation", tourId: state.currentTourId, target, body }],
  };
}

// Shared `cursor.set` / `cursor.materialize` transition: writes the slice
// and derives the visual-side-effect intent stream from the (prev, next)
// pair. `scrollCursorTarget` always fires (the cursor moved, so the
// surface re-centers it). `selectSidebarFile` fires when the resolved
// file changed — only RowAnchors have a resolvable file, so a Card→Card
// or Row→Card move doesn't reveal anything. The intent is sidebar-
// selection only — issue #310 split `revealSidebarFile` (force-uncollapse +
// sidebar select) into two semantics so a `j` traversal into a classifier-
// collapsed file no longer dispatches a `folds.setOverride { value: false }`
// the user never asked for. Issue #313 extends the same rule to sidebar
// click — explicit-reveal is now reserved for annotation jumps (n/p,
// `?ann=` restore), which dispatch `folds.setOverride` themselves
// alongside the `cursor.set`. `mirrorAnnUrl` fires when the annotation-id
// under the cursor changed (entering, leaving, or switching cards) so the
// webapp `?ann=` URL stays in sync.
function setCursor(
  state: TourSessionState,
  next: Cursor,
  placement: ScrollPlacement,
): ReduceResult {
  const intents: Intent[] = [
    { type: "scrollCursorTarget", target: scrollTargetOf(next), placement },
  ];
  const prevFile = isRowAnchor(state.cursor) ? state.cursor.file : null;
  const nextFile = isRowAnchor(next) ? next.file : null;
  if (nextFile !== null && nextFile !== prevFile) {
    intents.push({ type: "selectSidebarFile", file: nextFile });
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
