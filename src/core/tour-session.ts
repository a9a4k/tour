import { useSyncExternalStore } from "react";
import type { PickerRow } from "./tour-list.js";
import type { BundleFile, TourBundle } from "./tour-bundle.js";
import type { ReplyLock } from "./reply-lock.js";
import type { Comment, Tour } from "./types.js";
import type { Cursor } from "./cursor-state.js";
import {
  cursorFromComment,
  findThreadByNode,
  hasLiveReply,
  isCardAnchor,
  isRowAnchor,
  preferredSideOf,
  threadRootIdOf,
  validateCursorStructural,
} from "./cursor-state.js";
import { buildThreads } from "./threads.js";
import type { PaneFocus, PaneFocusAction } from "./pane-focus-state.js";
import { reducePaneFocus } from "./pane-focus-state.js";
import type { AnchorToken } from "./tour-session-runtime.js";
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

// Composer target: parent comment id for replies, file + side + line range
// for a top-level comment. The reply target deliberately carries the parent
// comment **id** (not the full Comment) so the slice doesn't go stale
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

// Tagged-union state machine for the comment composer (PRD #234). The
// surface's three useStates (composerTarget + composerError + textarea body
// on the webapp; one ComposerState | null on the TUI) collapse to one
// authoritative slice. `submitting` and `errored` preserve target + body so
// retry / dismissError can resume cleanly.
export type ComposerSlice =
  | { kind: "closed" }
  | { kind: "open"; target: ComposerTarget; body: string }
  | { kind: "submitting"; target: ComposerTarget; body: string }
  | { kind: "errored"; target: ComposerTarget; body: string; error: string };

// Delete-confirm modal slice (ADR 0036, Slice D / issue #388). Mirrors the
// composer's open / submitting / errored shape so the App's modal-unwind
// precedence (ADR 0031: Esc closes modals before any other gesture) treats
// both modals uniformly. `targetId` survives the submitting / errored
// transitions so the user sees the same Comment in the modal preview
// across an in-flight write or retry.
export type DeleteConfirmSlice =
  | { kind: "closed" }
  | { kind: "open"; targetId: string }
  | { kind: "submitting"; targetId: string }
  | { kind: "errored"; targetId: string; error: string };

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
  // Delete-confirm modal (ADR 0036, Slice D / issue #388). Sibling to
  // `composer`; shares the modal-unwind precedence (ADR 0031) and follows
  // the same open / submitting / errored shape so the App's `Esc` routing
  // treats both modals uniformly.
  deleteConfirm: DeleteConfirmSlice;
  collapsedFolders: Set<string>;
  collapsedOverrides: Record<string, boolean>;
  // Per-Thread collapse (PRD #397 / ADR 0038). Holds the top-level
  // Comment ids of Threads the user has minimised to a one-liner. Mirrors
  // GitHub's "minimize comment" gesture. `Shift+C` toggles membership of
  // the cursored Card; modifying action seams (`r`, `R`) pre-dispatch
  // `thread.expand` before acting; destructive cascade actions (`d`)
  // refuse to act on a collapsed Thread. Watcher-delivered events never
  // auto-expand. Reset on tour switch (matches collapsedFolders);
  // preserved across bundle.refreshed except for ids no longer in
  // top-level (cascade-delete drop).
  collapsedThreads: Set<string>;
  sidebarWidth: number;
  // Cross-surface pane focus (PRD #343 / ADR 0031 / issue #344). Sibling
  // to `cursor`; routes keyboard input between the sidebar tree and the
  // diff pane on both surfaces. Initial value is "sidebar" — matching the
  // TUI's retired `sidebarFocused = useState(true)` default; the surface
  // overrides via `paneFocus.setDiff` in the bundle-load seed-effect when
  // the Tour has top-level Comments.
  paneFocus: PaneFocus;
}

export type Action =
  | { type: "picker.open"; rows: PickerRow[] }
  | { type: "picker.close" }
  | { type: "picker.move"; delta: number }
  | { type: "picker.commit" }
  | { type: "bundle.loading"; tourId: string }
  | { type: "bundle.refreshed"; bundle: TourBundle }
  | {
      type: "bundle.commentInsertedWithLanding";
      comment: Comment;
      preferredSide: "additions" | "deletions";
    }
  | { type: "bundle.failed"; tourId: string; error: string }
  | { type: "tour.switched"; tourId: string; bundle: TourBundle }
  | { type: "replyLock.loaded"; replyLock: ReplyLock | null }
  | { type: "tourList.loading" }
  | { type: "tourList.loaded"; tours: TourSummary[] }
  | { type: "tourList.failed"; error: string }
  | {
      type: "cursor.set";
      anchor: Cursor;
      placement?: ScrollPlacement;
      behavior?: ScrollMotion;
    }
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
  | { type: "composer.submitted"; comment: Comment }
  | { type: "composer.failed"; error: string }
  | { type: "composer.retry" }
  | { type: "composer.dismissError" }
  | { type: "composer.recall" }
  | { type: "deleteConfirm.open"; targetId: string }
  | { type: "deleteConfirm.close" }
  | { type: "deleteConfirm.confirm" }
  | { type: "deleteConfirm.succeeded"; targetId: string }
  | { type: "deleteConfirm.failed"; error: string }
  | { type: "folds.toggleFolder"; path: string }
  | { type: "folds.setOverride"; file: string; value: boolean }
  | { type: "folds.clearOverride"; file: string }
  | { type: "folds.clearAll" }
  | { type: "thread.collapse"; id: string }
  | { type: "thread.expand"; id: string }
  | { type: "thread.toggle"; id: string }
  | { type: "thread.collapseAll" }
  | { type: "thread.expandAll" }
  | { type: "layout.set"; layout: Layout; reanchor?: AnchorToken | null }
  | { type: "sidebar.resize"; width: number; reanchor?: AnchorToken | null }
  | { type: "sidebar.autoFit"; width: number; reanchor?: AnchorToken | null }
  | { type: "send-to-agent"; tourId: string; commentId: string }
  | PaneFocusAction;

export type ScrollCursorTarget =
  | { kind: "row"; file: string; side: "additions" | "deletions"; lineNumber: number }
  | { kind: "card"; commentId: string };

// `ScrollPlacement` and `ScrollMotion` are independent axes on the
// `scrollCursorTarget` intent (PRD / issue #348).
//
// Placement — *where* does the frame land.
//   `nearest`: only scroll when target is off-screen — used for `j`/`k`
//   step motion and click (spatial gestures).
//   `center`: always frame the target mid-viewport — used for `n`/`p`
//   comment-walking and fresh landings (cursor materialize, URL `?ann=`
//   restore, `r`/`R` auto-recall).
//
// Motion — *how* the frame gets there.
//   `instant`: write the scroll position in one frame — used for fresh
//   landings where there's no prior frame of reference to preserve.
//   `smooth`: animate the scroll so the eye tracks the travel distance —
//   used for in-flight navigation gestures (`n`/`p`, `j`/`k`, click).
//
// Default mapping when a `cursor.set` dispatch omits `behavior`:
// `center → instant, nearest → smooth`. This preserves today's wiring
// for sites that haven't migrated.
export type ScrollPlacement = "nearest" | "center";
export type ScrollMotion = "instant" | "smooth";

export type Intent =
  | { type: "loadTour"; tourId: string }
  | { type: "scrollPickerRow"; idx: number }
  | { type: "mirrorUrl"; tourId: string }
  | { type: "revalidateCursor" }
  | {
      type: "scrollCursorTarget";
      target: ScrollCursorTarget;
      placement: ScrollPlacement;
      behavior: ScrollMotion;
    }
  | { type: "selectSidebarFile"; file: string | null }
  | { type: "mirrorAnnUrl"; commentId: string | null }
  | { type: "submitComment"; tourId: string; target: ComposerTarget; body: string }
  | {
      type: "applyPostSubmitLanding";
      comment: Comment;
      preferredSide: "additions" | "deletions";
    }
  | { type: "scrollToComposer"; target: ComposerTarget }
  | { type: "reanchorApply"; token: AnchorToken }
  | { type: "requestReply"; tourId: string; commentId: string }
  | { type: "deleteComment"; tourId: string; targetId: string };

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
    layout: "unified",
    cursor: null,
    expansion: emptyExpansion(),
    composer: { kind: "closed" },
    deleteConfirm: { kind: "closed" },
    collapsedFolders: new Set<string>(),
    collapsedOverrides: {},
    collapsedThreads: new Set<string>(),
    sidebarWidth: 0,
    paneFocus: "sidebar",
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
      // Same-tour bundle update (watcher reload / SSE comment-changed).
      // Replaces the bundle slice in place; intentionally does NOT touch
      // picker / replyLock / currentTourId — the user is still on the same
      // tour, so the Tour-switch reset cascade must not fire. Structural
      // cursor validity is enforced here against the inbound bundle; projection
      // validity (fold / expansion visibility) stays in the view.
      //
      // PRD #278 slice 1: orphan-window seeding is folded into the reducer.
      // The expansion slice unions with `bundle.files[*].orphanWindows` via
      // per-side `Math.max`, so manual user expansion is preserved across
      // watcher reloads (issue #114). Empty / absent windows leave the slice
      // ref-equal (same-ref short-circuit in `expansionSeedFromOrphans`).
      //
      // PRD #397 / ADR 0038: collapsedThreads is preserved across watcher
      // reloads (the user's hide intent must survive). Cascade-deleted
      // Thread ids drop from the set automatically — a parent removed from
      // the bundle (no live nodes remaining) is no longer in topLevel.
      const expansion =
        action.bundle.kind === "ok"
          ? expansionSeedFromOrphans(state.expansion, flattenOrphanWindows(action.bundle.files))
          : state.expansion;
      const collapsedThreads = pruneCollapsedThreads(
        state.collapsedThreads,
        action.bundle.comments,
      );
      const cursor = validateCursorStructural(state.cursor, action.bundle);
      const cursorIntents = structuralCursorIntents(
        state.cursor,
        cursor,
        state.bundle.kind === "ok" ? state.bundle.value : null,
        action.bundle,
      );
      if (cursor !== null) cursorIntents.push({ type: "revalidateCursor" });
      return {
        state: {
          ...state,
          bundle: { kind: "ok", value: action.bundle },
          expansion,
          collapsedThreads,
          cursor,
        },
        intents: cursorIntents,
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
      // inbound bundle's orphan windows so Comments whose anchor lives
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
          deleteConfirm: { kind: "closed" },
          collapsedFolders: new Set<string>(),
          collapsedOverrides: {},
          collapsedThreads: new Set<string>(),
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

    case "cursor.set": {
      const placement = action.placement ?? "nearest";
      const behavior = action.behavior ?? defaultBehaviorFor(placement);
      return setCursor(state, action.anchor, placement, behavior);
    }

    case "cursor.clear": {
      if (state.cursor === null) return { state, intents: NO_INTENTS };
      const bundle = state.bundle.kind === "ok" ? state.bundle.value : null;
      const intents: Intent[] = [...sidebarFollowIntents(state.cursor, null, bundle)];
      if (isCardAnchor(state.cursor)) {
        intents.push({ type: "mirrorAnnUrl", commentId: null });
      }
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
      return setCursor(state, action.anchor, "center", "instant");

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
      // `tour.switched`, which own structural validation / reset. The action
      // is also a no-op outside those paths.
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
      // Submitting → closed. The cursor does NOT re-anchor here (issue
      // #405). It will re-anchor atomically with the deferred bundle
      // fold on `bundle.commentInsertedWithLanding`, in the same
      // dispatch / React commit as the fold. Issue #401 originally moved
      // the cursor in this branch, but the in-between cycle left a
      // CardAnchor pointing at a Comment that wasn't in `bundle.comments`
      // yet — structural validation would clear it before the deferred fold
      // landed.
      //
      // Issue #322 (preserved by issue #392): the freshly-created
      // Comment must land in the bundle before the SSE-driven
      // `bundle.refreshed` round-trip (~500-600 ms on large tours).
      // Issue #392 splits *how*: this branch doesn't fold the comment
      // inline. It emits `applyPostSubmitLanding`, which the runtime
      // defers (via a small post-paint timer) and dispatches
      // `bundle.commentInsertedWithLanding` separately. Two React
      // commits, ordered: (1) composer overlay unmounts here;
      // (2) ~50 ms later, after opentui has reflowed, the bundle gains
      // the new CommentRow AND the cursor lands on it in one commit.
      // Without the gap, opentui's yoga layout pass leaves the affected
      // file's content empty — the diff-pane-blank-after-submit symptom
      // from issue #392.
      //
      // `preferredSide` is captured here from the pre-submit cursor so
      // an `h`/`l` choice made before submission survives the deferred
      // landing.
      if (state.composer.kind !== "submitting") return { state, intents: NO_INTENTS };
      return {
        state: { ...state, composer: { kind: "closed" } },
        intents: [
          {
            type: "applyPostSubmitLanding",
            comment: action.comment,
            preferredSide: preferredSideOf(state.cursor),
          },
        ],
      };
    }

    case "bundle.commentInsertedWithLanding": {
      // Issue #392 + #405: the deferred optimistic fold AND the cursor
      // re-anchor land in the same dispatch / React commit. This closes
      // the race in which the cursor briefly pointed at a Comment id
      // that wasn't yet in `bundle.comments`.
      //
      // Bundle fold semantics are unchanged from the prior
      // `bundle.commentInserted`: append-if-absent on a resolved
      // bundle, defensive no-op on any other slice. Cursor landing only
      // fires when the bundle is resolved (`setCursor` against an
      // orphan CardAnchor would re-introduce the race).
      if (state.bundle.kind !== "ok") return { state, intents: NO_INTENTS };
      const inner = state.bundle.value;
      const alreadyPresent = inner.comments.some(
        (a) => a.id === action.comment.id,
      );
      const foldedBundle = alreadyPresent
        ? inner
        : { ...inner, comments: [...inner.comments, action.comment] };
      const folded: TourSessionState = alreadyPresent
        ? state
        : {
            ...state,
            bundle: {
              kind: "ok",
              value: foldedBundle,
            },
          };
      const landing = cursorFromComment(action.comment, action.preferredSide);
      const cursor = validateCursorStructural(landing, foldedBundle);
      if (cursor === null) {
        return {
          state: { ...folded, cursor: null },
          intents: structuralCursorIntents(
            state.cursor,
            null,
            state.bundle.value,
            foldedBundle,
          ),
        };
      }
      return setCursor(folded, cursor, "center", "instant");
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

    case "deleteConfirm.open":
      // ADR 0036 Slice D (issue #388). Any prior delete-confirm kind →
      // fresh `open` on the new target id. Mirrors the composer's
      // re-open semantic: a second `d` while the modal is in flight /
      // errored re-targets the modal without writing.
      return {
        state: {
          ...state,
          deleteConfirm: { kind: "open", targetId: action.targetId },
        },
        intents: NO_INTENTS,
      };

    case "deleteConfirm.close":
      if (state.deleteConfirm.kind === "closed") return { state, intents: NO_INTENTS };
      return {
        state: { ...state, deleteConfirm: { kind: "closed" } },
        intents: NO_INTENTS,
      };

    case "deleteConfirm.confirm": {
      // open | errored → submitting; emit `deleteComment` so the runtime
      // can call the write seam (`createDelete`). No-op on closed /
      // submitting. Guarded on currentTourId mirrors the composer's
      // enterSubmitting helper.
      const dc = state.deleteConfirm;
      if (dc.kind !== "open" && dc.kind !== "errored") {
        return { state, intents: NO_INTENTS };
      }
      if (state.currentTourId === null) return { state, intents: NO_INTENTS };
      return {
        state: {
          ...state,
          deleteConfirm: { kind: "submitting", targetId: dc.targetId },
        },
        intents: [
          { type: "deleteComment", tourId: state.currentTourId, targetId: dc.targetId },
        ],
      };
    }

    case "deleteConfirm.succeeded": {
      // submitting → closed. The watcher's `comment-changed` event will
      // refresh the bundle and the C4 cascade surfaces in the next render.
      //
      // Issue #402: when the cursor sits on the doomed Card, project it
      // onto the most-specific surviving node in the deleted node's
      // lineage *before* `bundle.refreshed` lands. Three cases mirror
      // the `DeleteCascade` union (delete-cascade.ts):
      //   reply-only       → land on the parent Thread root id
      //                      (parent live, or parent is a [deleted]
      //                      stub with ≥1 surviving sibling)
      //   parent-stub      → leave cursor on the same parent id
      //                      (the [deleted] stub Card row still exists)
      //   thread-vanishes  → clear the cursor
      // The projection runs against the still-old bundle because at
      // this dispatch the doomed node remains in `bundle.value.comments`
      // — `findThreadByNode(targetId, …)` resolves the lineage. The
      // follow-up `bundle.refreshed` is a cursor no-op for the snapped
      // anchor: parent's Card row is still in flatRows, or the cursor
      // is null and `revalidateIfCursor` short-circuits.
      if (state.deleteConfirm.kind !== "submitting") return { state, intents: NO_INTENTS };
      const closedDc = { kind: "closed" as const };
      const cursor = state.cursor;
      const noSnap = {
        state: { ...state, deleteConfirm: closedDc },
        intents: NO_INTENTS,
      };
      if (
        !isCardAnchor(cursor) ||
        cursor.commentId !== action.targetId ||
        state.bundle.kind !== "ok"
      ) {
        return noSnap;
      }
      const threads = buildThreads(state.bundle.value.comments);
      const found = findThreadByNode(action.targetId, threads);
      if (!found) return noSnap;
      let nextCursor: Cursor | null;
      if (found.nodeIdx === 0) {
        // Cursor on the doomed parent. ≥1 reply survives → parent-stub
        // (cursor stays on parent id). Otherwise the Thread vanishes.
        nextCursor = found.thread.replies.length === 0 ? null : cursor;
      } else {
        // Cursor on a doomed Reply. If parent already a [deleted] stub
        // AND this was the last live reply, the Thread vanishes.
        const otherLiveReplies = found.thread.replies.filter(
          (r) => r.id !== action.targetId,
        );
        const parentIsLive = found.thread.root.deleted === undefined;
        nextCursor =
          otherLiveReplies.length === 0 && !parentIsLive
            ? null
            : {
                kind: "card",
                commentId: found.thread.root.id,
                preferredSide: cursor.preferredSide,
              };
      }
      const structurallyValidCursor = validateCursorStructural(
        nextCursor,
        state.bundle.value,
        { treatDeletedCommentId: action.targetId },
      );
      if (structurallyValidCursor === cursor) return noSnap;
      return {
        state: { ...state, cursor: structurallyValidCursor, deleteConfirm: closedDc },
        intents: [
          {
            type: "mirrorAnnUrl",
            commentId: isCardAnchor(structurallyValidCursor)
              ? structurallyValidCursor.commentId
              : null,
          },
        ],
      };
    }

    case "deleteConfirm.failed": {
      // submitting → errored, preserving the target id so the user can
      // retry (Enter on the errored modal re-fires `deleteConfirm.confirm`)
      // or dismiss (Esc).
      if (state.deleteConfirm.kind !== "submitting") return { state, intents: NO_INTENTS };
      const { targetId } = state.deleteConfirm;
      return {
        state: {
          ...state,
          deleteConfirm: { kind: "errored", targetId, error: action.error },
        },
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

    case "thread.collapse": {
      // PRD #397 / ADR 0038. Add the Thread's top-level id to the set;
      // no-op when already present (same-ref short-circuit).
      if (state.collapsedThreads.has(action.id)) return { state, intents: NO_INTENTS };
      const next = new Set(state.collapsedThreads);
      next.add(action.id);
      return {
        state: { ...state, collapsedThreads: next },
        intents: revalidateIfCursor(state),
      };
    }

    case "thread.expand": {
      // PRD #397 / ADR 0038. Remove the Thread's top-level id from the
      // set; no-op when absent. Action seams for modifying verbs (`r`,
      // `R`) pre-dispatch this so the composer / in-flight pill never
      // mount under a hidden Card.
      if (!state.collapsedThreads.has(action.id)) return { state, intents: NO_INTENTS };
      const next = new Set(state.collapsedThreads);
      next.delete(action.id);
      return {
        state: { ...state, collapsedThreads: next },
        intents: revalidateIfCursor(state),
      };
    }

    case "thread.toggle": {
      // PRD #397 / ADR 0038. Flip membership. Surfaces wire `Enter`
      // on a Card (per-Thread, issue #406) and the surface header
      // chevron click here. `threadRootIdOf` upstream normalises a
      // Reply-cursor id to the parent root.
      const next = new Set(state.collapsedThreads);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return {
        state: { ...state, collapsedThreads: next },
        intents: revalidateIfCursor(state),
      };
    }

    case "thread.collapseAll": {
      // Issue #406 / ADR 0038 (amended). Add every top-level Comment id
      // in the current bundle to the set. No-op when bundle isn't `ok`
      // (no Threads to collapse) or every top-level id is already
      // present (same-ref short-circuit).
      if (state.bundle.kind !== "ok") return { state, intents: NO_INTENTS };
      const topLevelIds: string[] = [];
      for (const c of state.bundle.value.comments) {
        if (c.replies_to === undefined) topLevelIds.push(c.id);
      }
      if (topLevelIds.length === 0) return { state, intents: NO_INTENTS };
      const next = new Set(state.collapsedThreads);
      let changed = false;
      for (const id of topLevelIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (!changed) return { state, intents: NO_INTENTS };
      return {
        state: { ...state, collapsedThreads: next },
        intents: [
          ...recenterCardCursorIntents(state),
          ...revalidateIfCursor(state),
        ],
      };
    }

    case "thread.expandAll": {
      // Issue #406 / ADR 0038 (amended). Empty the set. Same-ref
      // short-circuit when already empty.
      if (state.collapsedThreads.size === 0) return { state, intents: NO_INTENTS };
      return {
        state: { ...state, collapsedThreads: new Set<string>() },
        intents: [
          ...recenterCardCursorIntents(state),
          ...revalidateIfCursor(state),
        ],
      };
    }

    case "layout.set":
      if (state.layout === action.layout) return { state, intents: NO_INTENTS };
      return {
        state: { ...state, layout: action.layout },
        intents: reflowIntents(state, action.reanchor),
      };

    case "sidebar.resize":
    case "sidebar.autoFit": {
      if (state.sidebarWidth === action.width) return { state, intents: NO_INTENTS };
      return {
        state: { ...state, sidebarWidth: action.width },
        intents: reflowIntents(state, action.reanchor),
      };
    }

    case "paneFocus.setSidebar":
    case "paneFocus.setDiff":
    case "paneFocus.toggle": {
      // PRD #343 / ADR 0031 / issue #344. Delegates to the pure
      // `reducePaneFocus` helper in core/pane-focus-state.ts so the
      // transition rules live next to the auto-flip predicate and the
      // seed-effect conditional. Same-ref short-circuit when the action
      // is a no-op (idempotent set on the current pane).
      const next = reducePaneFocus(state.paneFocus, action);
      if (next === state.paneFocus) return { state, intents: NO_INTENTS };
      return { state: { ...state, paneFocus: next }, intents: NO_INTENTS };
    }

    case "send-to-agent": {
      // Holds no state — the action's job is to emit the auto-recall + dispatch
      // intent pair (mirrors `composer.submit` → `submitComment`). Defended
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
            target: { kind: "card", commentId: state.cursor.commentId },
            placement: "center",
            behavior: "instant",
          },
          { type: "requestReply", tourId: action.tourId, commentId: action.commentId },
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

// Drop ids from `collapsedThreads` that are no longer top-level Comments
// in the inbound bundle. Handles ADR 0038's cascade-delete rule: a Thread
// fully removed (parent and all replies gone) drops out of the user's
// hide-set automatically — the bundle is authoritative for what Threads
// exist. Same-ref short-circuit when nothing changes.
function pruneCollapsedThreads(
  collapsed: ReadonlySet<string>,
  comments: ReadonlyArray<Comment>,
): Set<string> {
  if (collapsed.size === 0) return collapsed as Set<string>;
  const topLevelIds = new Set<string>();
  for (const c of comments) {
    if (c.replies_to === undefined) topLevelIds.add(c.id);
  }
  let changed = false;
  const next = new Set<string>();
  for (const id of collapsed) {
    if (topLevelIds.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : (collapsed as Set<string>);
}

function resolvedCursorFile(
  cursor: Cursor | null,
  bundle: TourBundle | null,
): string | null {
  if (cursor === null) return null;
  if (cursor.kind === "row") {
    return cursor.file;
  }
  if (bundle === null || bundle.kind !== "ok") return null;
  const comment = bundle.comments.find((c) => c.id === cursor.commentId);
  if (!comment) return null;
  if (comment.deleted === undefined || hasLiveReply(comment.id, bundle.comments)) {
    return comment.file;
  }
  return null;
}

function sidebarFollowIntents(
  prevCursor: Cursor | null,
  nextCursor: Cursor | null,
  bundle: TourBundle | null,
): Intent[] {
  const prevFile = resolvedCursorFile(prevCursor, bundle);
  const nextFile = resolvedCursorFile(nextCursor, bundle);
  if (prevFile === nextFile) return NO_INTENTS;
  return [{ type: "selectSidebarFile", file: nextFile }];
}

function structuralCursorIntents(
  prevCursor: Cursor | null,
  nextCursor: Cursor | null,
  prevBundle: TourBundle | null,
  nextBundle: TourBundle,
): Intent[] {
  const intents: Intent[] = [];
  const prevAnnId = isCardAnchor(prevCursor) ? prevCursor.commentId : null;
  const nextAnnId = isCardAnchor(nextCursor) ? nextCursor.commentId : null;
  if (prevAnnId !== nextAnnId) {
    intents.push({ type: "mirrorAnnUrl", commentId: nextAnnId });
  }
  const prevFile = resolvedCursorFile(prevCursor, prevBundle);
  const nextFile = resolvedCursorFile(nextCursor, nextBundle);
  if (nextFile !== null && nextFile !== prevFile) {
    intents.push({ type: "selectSidebarFile", file: nextFile });
  }
  return intents;
}

// Returns the projection revalidation intent iff a non-null cursor is
// present. Shared by reducer branches that mutate flat-rows-shape state
// without changing bundle structure: folds, Thread collapse, and the
// expansion cluster via `withExpansion` (issue #309).
function revalidateIfCursor(state: TourSessionState): Intent[] {
  return state.cursor === null ? NO_INTENTS : [{ type: "revalidateCursor" }];
}

function reflowIntents(
  state: TourSessionState,
  reanchor: AnchorToken | null | undefined,
): Intent[] {
  if (reanchor) return [{ type: "reanchorApply", token: reanchor }];
  if (state.cursor === null) return NO_INTENTS;
  return [
    {
      type: "scrollCursorTarget",
      target: scrollTargetOf(state.cursor),
      placement: "nearest",
      behavior: "smooth",
    },
  ];
}

// Issue #407. The bulk `Shift+C` toggle reshapes the document by potentially
// hundreds of rows — the cursored Card can land far off-screen. After
// `thread.collapseAll` / `thread.expandAll` lands, recenter the viewport on
// the cursored Card with `center` + `instant` (a smooth scroll over a
// freshly-resized doc reads as glitchy). Row / interactive-row cursors are
// doc-position-stable; no scroll fires. Reply-cursor ids normalise to the
// Thread root via `threadRootIdOf` — after `collapseAll` the Reply row is
// gone, so the intent must carry the parent's id.
function recenterCardCursorIntents(state: TourSessionState): Intent[] {
  const cursor = state.cursor;
  if (!isCardAnchor(cursor) || state.bundle.kind !== "ok") return NO_INTENTS;
  const threads = buildThreads(state.bundle.value.comments);
  const rootId = threadRootIdOf(cursor.commentId, threads);
  return [
    {
      type: "scrollCursorTarget",
      target: { kind: "card", commentId: rootId },
      placement: "center",
      behavior: "instant",
    },
  ];
}

// Open → submitting and errored → submitting share their entire transition:
// preserve target + body, move to submitting, emit `submitComment` for the
// surface to realise via its `writeComment` plumbing (in-process TUI / HTTP
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
    intents: [{ type: "submitComment", tourId: state.currentTourId, target, body }],
  };
}

// Shared `cursor.set` / `cursor.materialize` transition: writes the slice
// and derives the visual-side-effect intent stream from the (prev, next)
// pair. `scrollCursorTarget` always fires (the cursor moved, so the
// surface re-centers it). `selectSidebarFile` fires when the resolved
// file changed — RowAnchors resolve directly through `cursor.file`, and
// CardAnchors resolve through the loaded bundle's Comment file. The intent
// is sidebar-selection only — issue #310 split `revealSidebarFile`
// (force-uncollapse + sidebar select) into two semantics so a `j`
// traversal into a classifier-collapsed file no longer dispatches a
// `folds.setOverride { value: false }` the user never asked for. Issue
// #313 extends the same rule to sidebar click — explicit force-unfold is
// reserved for comment jumps (n/p, `?ann=` restore), which dispatch
// `folds.setOverride` themselves alongside the `cursor.set`. `mirrorAnnUrl`
// fires when the comment-id under the cursor changed (entering, leaving, or
// switching cards) so the webapp `?ann=` URL stays in sync.
function setCursor(
  state: TourSessionState,
  next: Cursor,
  placement: ScrollPlacement,
  behavior: ScrollMotion,
): ReduceResult {
  const intents: Intent[] = [
    { type: "scrollCursorTarget", target: scrollTargetOf(next), placement, behavior },
  ];
  const bundle = state.bundle.kind === "ok" ? state.bundle.value : null;
  intents.push(...sidebarFollowIntents(state.cursor, next, bundle));
  const prevAnnId = isCardAnchor(state.cursor) ? state.cursor.commentId : null;
  const nextAnnId = isCardAnchor(next) ? next.commentId : null;
  if (prevAnnId !== nextAnnId) {
    intents.push({ type: "mirrorAnnUrl", commentId: nextAnnId });
  }
  return { state: { ...state, cursor: next }, intents };
}

function scrollTargetOf(c: Cursor): ScrollCursorTarget {
  if (c.kind === "card") return { kind: "card", commentId: c.commentId };
  return { kind: "row", file: c.file, side: c.side, lineNumber: c.lineNumber };
}

// Default motion when a `cursor.set` dispatch omits `behavior` (issue
// #348). Preserves today's wiring: fresh landings (`center`) write
// instantly with no prior frame of reference to preserve; in-flight
// gestures (`nearest`) animate so the eye tracks the travel distance.
// Sites that want the off-diagonal combinations (smooth-to-center for
// `n`/`p`, instant-to-nearest for the TUI's post-submit retry budget)
// pass `behavior` explicitly.
function defaultBehaviorFor(placement: ScrollPlacement): ScrollMotion {
  return placement === "center" ? "instant" : "smooth";
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
