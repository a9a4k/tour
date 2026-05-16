import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Comment, BundleFile, TourBundle, TourSummary } from "./types.js";
import { fileIcon } from "./file-icon.js";
import { ChevronDownIcon, ChevronRightIcon, FileDirectoryFillIcon } from "./icons.js";
import { CommentMarkdown } from "./markdown/CommentMarkdown.js";
import { TourPicker } from "./TourPicker.js";
import { buildPickerRows, pickAutoTour } from "../../core/tour-list.js";
import {
  TourSessionStore,
  useTourSession,
  isPickerOpen,
  isBundleResolved,
  resolvedReplyLock,
  pickerHighlighted,
  initialTourSessionState,
  type ComposerTarget,
  type Layout,
  type TourSummary as SessionTourSummary,
} from "../../core/tour-session.js";
import { latestCommentId, latestHumanLeafId } from "../../core/threads.js";
import { ageMs, isStale, type ReplyLock } from "../../core/reply-lock.js";
import {
  canSendToAgent,
  type CanSendToAgentResult,
} from "../../core/can-send-to-agent.js";
import { revealAncestors, type VisibleRow } from "../../core/file-tree.js";
import { TourSessionRuntime } from "../../core/tour-session-runtime.js";
import { createWebTourSessionAdapter } from "./tour-session-adapter.js";
import {
  planRows,
  GAP_TWO_ROW_THRESHOLD,
  hunkHeaderExpandPlan,
  fileExpandableGapCount,
  type PlannedRow,
} from "../../core/diff-rows.js";
import { parseFileDiffMetadata, type FileDiffMetadata } from "../../core/diff-model.js";
import { emptyExpansion, getBoundary } from "../../core/expansion-state.js";
import {
  cursorAfterExpand,
  cursorAtFirstFileRow,
  cursorFromComment,
  initialCursor,
  moveCursor,
  nextCard,
  prevCard,
  preferredSideOf,
  resolveCursorRowIdx,
  setCursorSide,
  type Cursor,
  type ExpandOrphanKind,
} from "../../core/cursor-state.js";
import type { FlatRow } from "../../core/flat-rows.js";
import {
  useTourSessionView,
  type NavBase,
  type TourSessionView,
} from "../../core/tour-session-view.js";
import { dispatchCursorKey } from "./cursor-keymap.js";
import { resolveOpenTarget } from "../../core/open-target-resolver.js";
import { FileBlock, type ExpandAction } from "./FileBlock.js";
import { tourDiffStats } from "../../core/diff-stats.js";
import { headerSourcePair } from "../../core/header-source-pair.js";
import { EXPANSION_STEP } from "./row-components.js";
import { FILE_GRID_CSS } from "./file-grid-css.js";
import { decideReanchor } from "./re-anchor-policy.js";
import { readTourFromLocation, readAnnFromLocation } from "./url-routing.js";
import { recallCardIntoView } from "./auto-recall.js";
import { foldToggleAction } from "../../core/fold-toggle.js";
import { SidebarResizeHandle } from "./SidebarResizeHandle.js";
import {
  SIDEBAR_DEFAULT_PX,
  clampSidebarWidthManualPx,
  computeAutoFitWidthPx,
} from "./sidebar-width.js";
import {
  resizeReanchorTarget,
  type ResizeReanchorTarget,
} from "./resize-reanchor-target.js";
import { Footer } from "./Footer.js";
import { composeFooterHints } from "../../core/footer-hints.js";
import { seedPaneFocus } from "../../core/pane-focus-state.js";
import { resolveYankTarget } from "../../core/yank-target.js";
import { dispatchOpenInEditor } from "./dispatch-open-in-editor.js";
import { dispatchDeleteComment } from "./dispatch-delete-comment.js";
import { DeleteConfirmModal } from "./DeleteConfirmModal.js";

// PRD #356 / issue #358: footer flash for `y` on a diff-row preview
// truncates the displayed text to keep the legend strip readable while
// the full text reaches the clipboard. ~60-char ceiling + ellipsis,
// mirroring the TUI surface's `truncateForPreview` (src/tui/app.tsx).
const YANK_PREVIEW_MAX = 60;
function truncateForPreview(text: string): string {
  return text.length <= YANK_PREVIEW_MAX
    ? text
    : `${text.slice(0, YANK_PREVIEW_MAX)}…`;
}

// Escape a string for safe interpolation into a CSS attribute selector
// (`[data-file="${cssEscapeFile(path)}"]`). Uses the platform's
// `CSS.escape` when available; falls back to a minimal escaper for the
// characters file paths can carry.
function cssEscapeFile(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, (c) => `\\${c}`);
}

interface AppProps {
  initialTourId: string | null;
  // The renderer-configured reply-agent name (from `--reply-agent <name>`,
  // baked into the SPA via `__INITIAL_REPLY_AGENT__`). Null when the
  // server was launched without `--reply-agent`; the "Request reply"
  // affordance and header chip both stay hidden in that case.
  replyAgent?: string | null;
}

// Sentinel snapshot-lost bundle so `useTourSessionView` stays unconditional
// before the real bundle lands.
const EMPTY_BUNDLE: TourBundle = {
  kind: "snapshot-lost",
  tour: {
    id: "",
    title: "",
    status: "open",
    created_at: "",
    closed_at: "",
    head_sha: "",
    base_sha: "",
    head_source: "",
    base_source: "",
    wip_snapshot: false,
  },
  comments: [],
};

function readTourFromUrl(fallback: string | null): string | null {
  if (typeof window === "undefined") return fallback;
  return readTourFromLocation(window.location, fallback);
}

function readAnnFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return readAnnFromLocation(window.location);
}

export function App({ initialTourId, replyAgent }: AppProps): React.JSX.Element {
  // Tour-session store (PRD #207 slice 1, issue #210; bundle hoisted into
  // the store in issue #211). One store per SPA mount, seeded with the
  // URL-resolved tour id so the initial render sees the right
  // currentTourId. The store's `bundle` slice is the rendering source of
  // truth: `tour.switched` lands on picker.commit / popstate / auto-pick
  // resolves (applies the CONTEXT-pinned reset cascade);
  // `bundle.refreshed` lands on SSE comment-changed (same-tour
  // refresh; no resets).
  const storeRef = useRef<TourSessionStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new TourSessionStore({
      ...initialTourSessionState(),
      currentTourId: readTourFromUrl(initialTourId),
    });
  }
  const store = storeRef.current;
  const sessionState = useTourSession(store);
  const tourId = sessionState.currentTourId;
  const tourList: TourSummary[] | null =
    sessionState.tourList.kind === "ok"
      ? (sessionState.tourList.value as TourSummary[])
      : null;
  const pickerOpen = isPickerOpen(sessionState);
  const bundle = isBundleResolved(sessionState);
  const bundleError =
    sessionState.bundle.kind === "err" ? sessionState.bundle.error : null;
  const bundleLoaded =
    sessionState.bundle.kind === "ok" || sessionState.bundle.kind === "err";

  // Reply-lock lives in the Tour-session store's `replyLock` slice (issue
  // #213, follow-up to #211): the SSE handler + mount-time refetcher
  // dispatch `replyLock.loaded`; rendering reads via the selector. Mirrors
  // the TUI's #211 wiring; the local `useState<ReplyLock | null>` that
  // shadowed the slice on the webapp is gone.
  const replyLock = resolvedReplyLock(sessionState);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // PRD #343 / ADR 0031 / issue #346: sidebar keyboard cursor. Tracks the
  // path of the row that owns the roving `tabindex=0` when paneFocus =
  // sidebar; null when the bundle hasn't seeded yet. Distinct from
  // `selectedFile` (which highlights the active file's diff) because the
  // sidebar cursor can sit on a folder row too. Sidebar j/k motion
  // updates this; Enter on a file row syncs selectedFile to match.
  const [sidebarSelectedPath, setSidebarSelectedPath] = useState<string | null>(null);
  // PRD #330 / ADR 0028: transient footer status surface. The cursor-keymap's
  // `r` / `R` miss branches flash a reason here; the timer auto-dismisses
  // after ~2s. Last-write-wins — replacement clears the prior pending
  // timer; unmount clears any pending timer.
  const [footerStatus, setFooterStatus] = useState<string | null>(null);
  const footerStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashFooterStatus = useCallback((message: string) => {
    if (footerStatusTimerRef.current !== null) {
      clearTimeout(footerStatusTimerRef.current);
    }
    setFooterStatus(message);
    footerStatusTimerRef.current = setTimeout(() => {
      setFooterStatus(null);
      footerStatusTimerRef.current = null;
    }, 2000);
  }, []);
  useEffect(() => {
    return () => {
      if (footerStatusTimerRef.current !== null) {
        clearTimeout(footerStatusTimerRef.current);
        footerStatusTimerRef.current = null;
      }
    };
  }, []);
  // Issue #334: when the composer transitions into `errored` (the
  // runtime dispatches `composer.failed` on adapter rejection — see
  // core/tour-session-runtime.ts:238), flash the failure reason in
  // the footer status slot. Successful creates do NOT flash — the
  // watcher-driven repaint is the confirmation, per PRD #330's Out of
  // Scope. The ref gates on the *transition* so retry → submitting →
  // errored re-flashes even when the new error string matches the
  // previous (the slice-deps re-render alone would not pick that up).
  const wasComposerErroredRef = useRef(false);
  const composerSlice = sessionState.composer;
  useEffect(() => {
    const isErrored = composerSlice.kind === "errored";
    if (isErrored && !wasComposerErroredRef.current) {
      const verb =
        composerSlice.target.kind === "reply" ? "Reply" : "Comment";
      flashFooterStatus(`${verb} failed: ${composerSlice.error}`);
    }
    wasComposerErroredRef.current = isErrored;
  }, [composerSlice, flashFooterStatus]);
  // Folds (collapsedFolders + collapsedOverrides), layout, and composer
  // (target / body / error as one tagged-union slice) all live in the Tour-
  // session store (PRD #234 slice 3, issue #238). The webapp's three local
  // composer useStates (composerTarget + composerError + textarea body) and
  // the folds / layout useStates are gone; reads route through the store
  // slices; the reducer's `tour.switched` cascade owns all resets.
  const collapsedFolders = sessionState.collapsedFolders;
  const collapsedOverrides = sessionState.collapsedOverrides;
  const layout = sessionState.layout;
  const composer = sessionState.composer;
  const composerTarget: ComposerTarget | null =
    composer.kind === "closed" ? null : composer.target;
  const composerError: string | null =
    composer.kind === "errored" ? composer.error : null;
  const composerBody: string = composer.kind === "closed" ? "" : composer.body;
  // Unified cursor (ADR 0022 / PRD #192) lives in the Tour-session store
  // (PRD #229 slice 2, issue #232): the local `useState<Cursor | null>`
  // that previously shadowed the slice is gone. The reducer's cursor.*
  // branches own the lazy-materialization rule, the tour-switch reset,
  // and the cross-async revalidation pipeline; the surface translates
  // input events into cursor.* actions and realizes the emitted
  // visual-side-effect intents (scrollCursorTarget, selectSidebarFile,
  // mirrorAnnUrl) into DOM / history substrate.
  const cursor = sessionState.cursor;
  // Hidden-context expansion (PRD #212 / ADR 0024) lives in the Tour-
  // session store too (PRD #229 slice 2, issue #232). Orphan-window
  // seeding is folded into the reducer's `tour.switched` and
  // `bundle.refreshed` branches (PRD #278 slice 1) — the surface no
  // longer dispatches `expansion.seedFromOrphans` as a follow-up.
  const expansion = sessionState.expansion;
  // PRD #343 / ADR 0031 / issue #346: cross-surface pane focus reads
  // from the Tour-session slice. The webapp Esc handler dispatches
  // `paneFocus.toggle`; sidebar / diff clicks dispatch
  // `paneFocus.setSidebar` / `paneFocus.setDiff`; the bundle-load seed
  // effect dispatches one of the set actions based on `seedPaneFocus`.
  const paneFocus = sessionState.paneFocus;
  const commentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sidebarRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Issue #303 preserve-cursor-on-layout-toggle: pre-toggle snapshot of the
  // cursor row's viewport-y. Populated synchronously inside the toggle-
  // layout case below, BEFORE `layout.set` dispatches; consumed by the
  // layout-change useLayoutEffect after React commits the new layout
  // but BEFORE the browser paints, so the user sees no jump. The snapshot
  // stores only the screen-y; we re-locate the row after the commit
  // against the new DOM (row identity changes when the planner emits a
  // different row sequence). When the row isn't relocatable in the new
  // layout (rare — interactive rows, paired-deletion cursor against an
  // unrendered side), the effect skips the adjustment.
  const layoutToggleSnapshotRef = useRef<{ top: number } | null>(null);
  // Issue #323: stateful sidebar width. Seeded from SIDEBAR_DEFAULT_PX
  // (280, matching the pre-#323 hard-coded value) and overwritten by:
  //   1. Auto-fit on every tour switch (`tour.id` change with non-empty
  //      visible rows). Manual drag does NOT carry over across tours —
  //      session-local, mirrors the TUI semantics.
  //   2. The drag handle's `pointermove` frames during a user drag.
  // Both writers wrap their write in capture + applyPreserveScreenY so
  // the cursor row's on-screen y is pinned across the reflow. Without
  // the wire, a comment card above the cursor reflows when the
  // diff pane narrows and the cursor walks up or down the screen.
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_PX);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  // Tour id the auto-fit effect last ran against. Gated so folder
  // expand / collapse within a tour does NOT re-fit (the row list
  // changes but the user expects the width to stay put). Mirrors the
  // TUI's `lastFittedTourIdRef`.
  const lastFittedTourIdRef = useRef<string | null>(null);
  // Issue #323: pre-resize snapshot of the re-anchor target's
  // on-screen y. Populated synchronously inside the drag handler (and
  // the auto-fit effect) BEFORE `setSidebarWidth` triggers React's
  // re-render; consumed by the resize-apply useLayoutEffect after
  // React commits the new width. Same pattern as
  // `layoutToggleSnapshotRef` — the only difference is the trigger.
  // Issue #327 added the `target` descriptor so the apply path can
  // re-resolve the same logical target post-reflow; priority owned by
  // `resizeReanchorTarget`.
  const resizeSnapshotRef = useRef<{
    top: number;
    target: ResizeReanchorTarget;
  } | null>(null);
  // Refs holding the latest React-state inputs the intent handlers need.
  // The intent listener fires synchronously inside `store.dispatch`, BEFORE
  // React re-renders, so the listener's closure captures stale values. The
  // refs are written on every render so the listener reads "the values as
  // of the most recent commit," which is what we want — only the store
  // slice changed in this dispatch.
  const intentInputsRef = useRef<{
    setSelectedFile: (next: string | null) => void;
    revealFileAncestors: (file: string) => void;
    findFileBlock: (name: string) => HTMLElement | null;
  } | null>(null);

  // Tour-session runtime (PRD #278 slices 2-6). Subscribes to SSE via the
  // web adapter and dispatches `bundle.refreshed` / `replyLock.loaded` on
  // tour events; realises every intent the reducer emits (loadTour,
  // submitComment, scroll / mirror / reveal). The runtime re-subscribes
  // itself when `currentTourId` changes, so this effect runs once at mount
  // and tears down at unmount.
  //
  // Registered BEFORE the mount-time bundle.loading dispatch so the
  // runtime's `onIntent` subscription is live when the initial loadTour
  // intent fires. React runs useEffects in declaration order; reversing
  // the order drops the first intent and the bundle never loads.
  useEffect(() => {
    const adapter = createWebTourSessionAdapter({
      store,
      commentRefs,
      callbacksRef: intentInputsRef,
    });
    const runtime = new TourSessionRuntime(store, adapter);
    return runtime.start();
  }, [store]);

  // Mount-time: fetch tour list via store dispatches, auto-pick on bare URL,
  // and kick off the initial bundle load if a tour-id was already seeded
  // from the URL. `bundle.loading` emits `loadTour` (PRD #278 slice 3) so
  // the runtime owns the fetch / dispatch chain.
  useEffect(() => {
    store.dispatch({ type: "tourList.loading" });
    void (async () => {
      try {
        const res = await fetch("/api/tours?status=all");
        const tours = (await res.json()) as SessionTourSummary[];
        store.dispatch({ type: "tourList.loaded", tours });
        // Auto-pick at bare `/`: most-recent open (issue #187 — shared
        // with the server's bare-`tour serve` pre-pick). Closed-only
        // repos fall through to the most-recent overall.
        if (store.getState().currentTourId === null && tours.length > 0) {
          const auto = pickAutoTour(tours);
          const autoId = auto?.id ?? tours[tours.length - 1].id;
          store.dispatch({ type: "bundle.loading", tourId: autoId });
        }
      } catch (err) {
        store.dispatch({
          type: "tourList.failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // URL-seeded initial bundle load. picker.commit / popstate / auto-pick
    // all dispatch bundle.loading themselves; this branch handles the
    // single case where currentTourId was non-null at mount.
    const initial = store.getState().currentTourId;
    if (initial !== null) {
      store.dispatch({ type: "bundle.loading", tourId: initial });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const fromUrl = readTourFromUrl(null);
      const current = store.getState().currentTourId;
      if (fromUrl !== null && fromUrl !== current) {
        // popstate is the equivalent of a picker-commit (issue #210): the
        // session action sets bundle = loading + currentTourId and emits a
        // `loadTour` intent that the runtime realises through the adapter.
        // No mirrorUrl — popstate is following the URL, not writing it.
        store.dispatch({ type: "bundle.loading", tourId: fromUrl });
      }
      // Mirror `?ann=` / `#<ann-id>` back into the cursor on browser
      // back / forward (PRD #192 / ADR 0022 slice 2). The mount-time
      // restorer is the authoritative seed when the user changes Tour;
      // popstate within the same Tour needs an explicit cursor write
      // since cursorCardId won't change otherwise.
      const annFromUrl = readAnnFromUrl();
      if (annFromUrl !== null) {
        const prev = store.getState().cursor;
        store.dispatch({
          type: "cursor.set",
          anchor: {
            kind: "card",
            commentId: annFromUrl,
            preferredSide: preferredSideOf(prev),
          },
        });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [store]);

  // Tour-switch reset for sidebar selection. After PRD #234 slice 3
  // (issue #238) the reducer's `tour.switched` branch owns every reset
  // rule CONTEXT.md pins (picker, replyLock, cursor, expansion,
  // composer, folds; layout preserved). `selectedFile` is the last
  // surface-side `useState` (sidebar position, derivable from cursor,
  // explicitly out of scope per PRD #234 / issue #238).
  useEffect(() => {
    if (!tourId) return;
    setSelectedFile(null);
  }, [tourId]);

  const tourMeta = bundle?.tour ?? null;
  // Tour-session view (PRD #242 / issue #245). Per-namespace memoised
  // projection from `(bundle, state)`; consumes through `view.*` instead
  // of the parallel useMemo chain the App used to maintain. EMPTY_BUNDLE
  // keeps the hook call unconditional before the real bundle lands.
  const view: TourSessionView = useTourSessionView(store, bundle ?? EMPTY_BUNDLE);

  // tourStats re-plans every file with stable args (empty comments /
  // expansion, "split" layout) to compute the FULL-diff +N -M totals —
  // that pass needs the FileDiffMetadata shape the view doesn't surface,
  // so parse the raw diff once more here.
  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!bundle || bundle.kind !== "ok") return [];
    return parseFileDiffMetadata(bundle.diff);
  }, [bundle]);
  // Name-keyed lookup so the per-file Expand-all chrome gate (issue
  // #298) can call `fileExpandableGapCount(meta, expansion, newContent)`
  // in O(1) per render-pass file.
  const parsedFilesByName = useMemo<ReadonlyMap<string, FileDiffMetadata>>(() => {
    const m = new Map<string, FileDiffMetadata>();
    for (const f of parsedFiles) m.set(f.name, f);
    return m;
  }, [parsedFiles]);

  const revealFileAncestors = useCallback(
    (filePath: string) => {
      if (view.kind !== "ok") return;
      const ancestors = revealAncestors(view.tree.root, filePath);
      if (ancestors.length === 0) return;
      // Dispatch `folds.toggleFolder` for ancestors that ARE in the set.
      // The reducer's toggleFolder branch is presence-aware (delete on
      // present, add on absent); only-collapsed ancestors are toggled
      // off so already-open folders stay open. Reads the live store
      // snapshot at call time — safe to do per-iteration because the
      // ancestor list is stable and the snapshot is captured up-front.
      const current = store.getState().collapsedFolders;
      for (const a of ancestors) {
        if (current.has(a)) {
          store.dispatch({ type: "folds.toggleFolder", path: a });
        }
      }
    },
    [view, store],
  );

  const toggleFolder = useCallback(
    (folderPath: string) => {
      store.dispatch({ type: "folds.toggleFolder", path: folderPath });
    },
    [store],
  );

  const navigateBy = useCallback(
    (delta: -1 | 1) => {
      // n/p is the jump gesture: walks top-level order (issue #197 — same
      // as the SequencePill counter), independent of cursor position
      // (issue #206 revert of #203). NavBase is universal across branches
      // (issue #246), so this works in snapshot-lost mode too (though
      // selectSidebarFile is then a no-op since the tree slice isn't
      // available).
      //
      // Issue #348: n/p frames the card mid-viewport with a smooth tween
      // — predictable focal point + perceptible travel distance for
      // adjacent comments. The webapp adapter realises this via
      // `scrollIntoView({ behavior: "smooth", block: "center" })`;
      // browser-native smooth-scroll interrupts a prior tween on each
      // new call, so rapid `n n n n` sequences converge on the last
      // target without queueing.
      const topLevel = view.nav.topLevel;
      const target = delta === 1 ? nextCard(cursor, topLevel) : prevCard(cursor, topLevel);
      if (!target) return;
      const ann = topLevel.find((a) => a.id === target.commentId);
      if (!ann) return;
      setSelectedFile(ann.file);
      store.dispatch({
        type: "folds.setOverride",
        file: ann.file,
        value: false,
      });
      revealFileAncestors(ann.file);
      store.dispatch({
        type: "cursor.set",
        anchor: target,
        placement: "center",
        behavior: "smooth",
      });
    },
    [cursor, view, revealFileAncestors, store],
  );

  // Re-anchor cursor to a top-level Comment card on bundle load (PRD #192
  // / ADR 0022; issue #197 Bug B). When the URL carries `?ann=<id>` (or its
  // `#<ann-id>` fragment shape from Issue #179), resolve it to a top-level
  // Comment; a stale id (deleted, hand-edited, or pointing at a Reply)
  // falls back to the first top-level Comment. Gated on the loaded
  // Tour matching the routing Tour id so the in-flight Tour-switch window
  // doesn't anchor the new URL's `ann=` against the previous Tour's
  // comments. The policy discriminator is `cursor === null` (not
  // `cursorCardId === null`) — a RowAnchor cursor from a `j`/`k` press
  // is a noop, so row motion survives the same render. The cursor.set
  // dispatch fires the mirrorAnnUrl intent which keeps `?ann=` in sync;
  // url-restore anchors only fire the URL write as a no-op since the URL
  // already matches.
  useEffect(() => {
    if (!tourMeta || tourMeta.id !== tourId) return;
    // Re-anchor reads top-level comments from `view.nav` — NavBase lives
    // on both branches (issue #246), so snapshot-lost bundles still get
    // initial-selection / sidebar-reveal effects when comments are present.
    const topLevel = view.nav.topLevel;
    if (topLevel.length === 0) {
      setSelectedFile((curr) => (curr === null ? curr : null));
      return;
    }
    const action = decideReanchor(cursor, readAnnFromUrl(), topLevel);
    if (action.kind === "noop") return;
    // Fresh landing (URL `?ann=` restore or stale-fallback to first
    // comment): cursor.set carries `placement: "center"` so the
    // scrollCursorTarget intent frames the card mid-viewport. Behavior
    // defaults to `instant` (the reducer's `center → instant` mapping
    // per issue #348) — there's no prior frame of reference to preserve.
    // `j`/`k`/click sites omit placement and fall back to `nearest +
    // smooth`; `n`/`p` sites pass `center + smooth` explicitly.
    store.dispatch({
      type: "cursor.set",
      anchor: cursorFromComment(action.target, preferredSideOf(cursor)),
      placement: "center",
    });
    setSelectedFile(action.target.file);
    revealFileAncestors(action.target.file);
  }, [tourMeta, tourId, view, cursor, revealFileAncestors, store]);

  // PRD #343 / ADR 0031 / issue #346: cross-surface pane-focus seed
  // effect. Mirrors the TUI's bundle-load conditional in
  // src/tui/app.tsx — Tour with top-level Comments → paneFocus.setDiff
  // (cursor seeds at the first Comment); Tour without Comments →
  // paneFocus.setSidebar (sidebar lands at the first file row). Gated
  // on the seededTourIdRef so a same-tour bundle.refreshed doesn't
  // re-seed over user-driven flips. Also seeds the sidebar keyboard
  // cursor (`sidebarSelectedPath`) to the file of the first comment
  // (diff seed) or the first file row (sidebar seed) so the roving
  // tabindex has a starting target.
  const paneFocusSeededTourIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tourMeta || tourMeta.id !== tourId) return;
    if (paneFocusSeededTourIdRef.current === tourId) return;
    if (view.kind !== "ok") return;
    paneFocusSeededTourIdRef.current = tourId;
    const topLevel = view.nav.topLevel;
    const hasComments = topLevel.length > 0;
    store.dispatch(
      seedPaneFocus(hasComments) === "diff"
        ? { type: "paneFocus.setDiff" }
        : { type: "paneFocus.setSidebar" },
    );
    if (hasComments) {
      setSidebarSelectedPath(topLevel[0].file);
    } else {
      const firstFile = view.tree.visibleRows.find((r) => r.kind === "file");
      setSidebarSelectedPath(firstFile?.path ?? null);
    }
  }, [tourMeta, tourId, view, store]);

  // Keep the selected sidebar row visible. block:"nearest" — already-visible
  // rows don't jump.
  useEffect(() => {
    if (selectedFile === null) return;
    const el = sidebarRowRefs.current.get(selectedFile);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedFile]);

  // PRD #343 / ADR 0031 / issue #346: roving tabindex + DOM focus
  // realisation. When paneFocus = sidebar, the row at
  // sidebarSelectedPath gets `.focus()` so the browser-native
  // `:focus-visible` outline shows AND `Tab` from outside lands on
  // the keyboard-selected row. When paneFocus flips to diff, blur the
  // currently-focused sidebar row so subsequent keys target the diff.
  // Skip the focus call when the keyboard target hasn't seeded yet
  // (initial bundle-load race — the paneFocus seed effect populates
  // sidebarSelectedPath on its first run).
  useEffect(() => {
    if (paneFocus === "sidebar") {
      if (sidebarSelectedPath === null) return;
      const el = sidebarRowRefs.current.get(sidebarSelectedPath);
      el?.focus({ preventScroll: false });
      return;
    }
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.getAttribute("role") === "treeitem") {
      active.blur();
    }
  }, [paneFocus, sidebarSelectedPath]);

  // Issue #303: pin the cursor row at the same on-screen y-coordinate
  // across a layout toggle (shift+L / header `LayoutToggle`). The
  // pre-toggle snapshot was captured by `setLayoutChoice` before the
  // `layout.set` dispatch; here, after React commits the new layout
  // but BEFORE the browser paints, we re-locate the cursor row, measure
  // its new viewport-y, and `window.scrollBy(delta)` so it lands at the
  // captured y. useLayoutEffect (not useEffect) is load-bearing: a
  // post-paint adjustment would flash the user's eye to the wrong row
  // for one frame.
  //
  // Fallback rules (from the issue brief):
  //  • No snapshot (no cursor at toggle time, or row not findable
  //    pre-toggle) → behave as before #303.
  //  • Row not in the new layout's DOM (cursor anchor doesn't resolve in
  //    the new flat-rows, or its FlatRow is an interactive row) → skip
  //    the preserve. The default toggle motion remains.
  //  • Scroll adjustment pushed past a document bound → the browser
  //    clamps `window.scrollBy` automatically. If the row's still off-
  //    screen after the clamp, fall back to
  //    `scrollIntoView({ block: "center" })`.
  useLayoutEffect(() => {
    const snap = layoutToggleSnapshotRef.current;
    if (!snap) return;
    layoutToggleSnapshotRef.current = null;
    if (!cursor || view.kind !== "ok") return;
    if (typeof window === "undefined") return;
    const el = findCursorRowEl(cursor, view.rows.flatRowsList);
    if (!el) return;
    const newTop = el.getBoundingClientRect().top;
    const delta = newTop - snap.top;
    if (delta !== 0) {
      window.scrollBy({ top: delta, behavior: "instant" });
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      el.scrollIntoView({ behavior: "instant", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const restoreFocusAfterPicker = useCallback(() => {
    const back = triggerRef.current ?? pickerButtonRef.current;
    requestAnimationFrame(() => back?.focus());
  }, []);

  const openPicker = useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    const tourListData = store.getState().tourList;
    if (tourListData.kind !== "ok") return;
    const counts: Record<string, number> = {};
    if (bundle) counts[bundle.tour.id] = bundle.comments.length;
    const rows = buildPickerRows({
      tours: tourListData.value,
      commentCounts: counts,
      now: Date.now(),
    });
    store.dispatch({ type: "picker.open", rows });
  }, [store, bundle]);

  const closePicker = useCallback(() => {
    store.dispatch({ type: "picker.close" });
    restoreFocusAfterPicker();
  }, [store, restoreFocusAfterPicker]);

  const onPickerMove = useCallback(
    (delta: number) => {
      store.dispatch({ type: "picker.move", delta });
    },
    [store],
  );

  const onPickerCommit = useCallback(() => {
    // Short-circuit when the highlighted row is the current tour: don't
    // re-fetch the bundle, just close the picker. Preserves the pre-refactor
    // "Enter on current row" behavior (commitTour's `if (id !== tourId)`).
    const s = store.getState();
    const target = pickerHighlighted(s);
    if (!target) return;
    if (target.id === s.currentTourId) {
      store.dispatch({ type: "picker.close" });
    } else {
      store.dispatch({ type: "picker.commit" });
    }
    restoreFocusAfterPicker();
  }, [store, restoreFocusAfterPicker]);

  const registerCommentRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      commentRefs.current.set(id, el);
    } else {
      commentRefs.current.delete(id);
    }
  }, []);

  // Per-file fold predicate. Mirrors the view's `isFileFolded` rule
  // (PRD #242 reconciliation): user override wins; otherwise only binary
  // files fold automatically. Classifier-collapsed non-binary files now
  // emit a synthetic CollapsedFileRow via the planner.
  const isCollapsed = useCallback(
    (fileName: string): boolean => {
      if (fileName in collapsedOverrides) return collapsedOverrides[fileName];
      if (view.kind !== "ok") return false;
      const f = view.bundle.filesByName.get(fileName);
      return f ? f.classification.reason === "binary" : false;
    },
    [collapsedOverrides, view],
  );

  // Issue #316: dispatch decided by `foldToggleAction` (see helper for the
  // three-state rationale and why binary is the exception).
  const toggleCollapsed = useCallback(
    (fileName: string) => {
      const f = view.kind === "ok" ? view.bundle.filesByName.get(fileName) : null;
      const classification = f?.classification ?? { collapsed: false };
      store.dispatch(foldToggleAction(fileName, isCollapsed(fileName), classification));
    },
    [isCollapsed, store, view],
  );

  // Look up a file's outer wrapper by `data-file` attribute. Used for
  // scroll-into-view on sidebar selection. The wrapper is owned by
  // `<FileBlock>` (`tour-file-outer`); querying lazily avoids a ref-map
  // round-trip that React.memo would have to thread through the prop list.
  const findFileBlock = useCallback((name: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(`[data-file="${cssEscapeFile(name)}"]`);
  }, []);

  // Issue #303 preserve-cursor-on-layout-toggle: resolve a cursor anchor
  // to the DOM element that hosts its row. Card cursors return the
  // comment card wrapper (registered in `commentRefs`). Diff
  // cursors project through `resolveCursorRowIdx` to the FlatRow, then
  // query the `.tour-row` element by its layout-invariant `data-row-id`
  // attribute — emitted by `<DiffRow>` from leftLineNumber / rightLineNumber
  // via the same mapping as `flatRowFromLines`. The attribute is identical
  // across split and unified, so the same selector resolves in both layouts
  // even for paired-context cursors on the deletions side (where the
  // gutter's `data-side` reflects `preferredSide` and would otherwise miss).
  // Interactive rows return null (no clean DOM hook today; preserve-y
  // skips them, falling back to today's behaviour).
  const findCursorRowEl = useCallback(
    (c: Cursor, flatRows: ReadonlyArray<FlatRow>): HTMLElement | null => {
      if (typeof document === "undefined") return null;
      if (c.kind === "card") {
        return commentRefs.current.get(c.commentId) ?? null;
      }
      const idx = resolveCursorRowIdx(c, flatRows);
      if (idx === -1) return null;
      const r = flatRows[idx];
      if (r.kind === "card") return commentRefs.current.get(r.commentId) ?? null;
      if (r.kind === "interactive") return null;
      const block = findFileBlock(r.file);
      if (!block) return null;
      const rowId = `${r.side}-${r.lineNumber}`;
      return block.querySelector<HTMLElement>(
        `.tour-row[data-row-id="${rowId}"]`,
      );
    },
    [findFileBlock],
  );

  // Issue #323: sidebar-width-change preserveScreenY. The auto-fit
  // effect and the drag handler both write `resizeSnapshotRef` BEFORE
  // calling `setSidebarWidth`; this useLayoutEffect re-reads the
  // target's new on-screen y after React commits the width change but
  // BEFORE the browser paints, and scrolls by the delta so the target
  // stays put. Same algorithm as the layout-toggle effect above — the
  // only difference is the trigger (sidebarWidth, not layout).
  // Target resolution (cursor → active-file, issue #327) is owned by
  // `resizeReanchorTarget`; this effect just re-resolves the descriptor.
  useLayoutEffect(() => {
    const snap = resizeSnapshotRef.current;
    if (!snap) return;
    resizeSnapshotRef.current = null;
    if (view.kind !== "ok") return;
    if (typeof window === "undefined") return;
    const el =
      snap.target.kind === "cursor"
        ? findCursorRowEl(snap.target.cursor, view.rows.flatRowsList)
        : findFileBlock(snap.target.path);
    if (!el) return;
    const newTop = el.getBoundingClientRect().top;
    const delta = newTop - snap.top;
    if (delta !== 0) {
      window.scrollBy({ top: delta, behavior: "instant" });
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      el.scrollIntoView({ behavior: "instant", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarWidth]);

  // Issue #327: shared capture helper for both resize writers (auto-fit
  // effect and drag handler). Priority owned by `resizeReanchorTarget`.
  const captureResizeSnapshot = useCallback(() => {
    if (view.kind !== "ok") return;
    const target = resizeReanchorTarget({
      cursor,
      flatRows: view.rows.flatRowsList,
      activeFile: selectedFile,
    });
    if (!target) return;
    const el =
      target.kind === "cursor"
        ? findCursorRowEl(target.cursor, view.rows.flatRowsList)
        : findFileBlock(target.path);
    if (!el) return;
    resizeSnapshotRef.current = {
      top: el.getBoundingClientRect().top,
      target,
    };
  }, [cursor, view, selectedFile, findCursorRowEl, findFileBlock]);

  // Issue #323: auto-fit the sidebar on every tour switch. Runs at
  // most once per `tour.id` (gated by `lastFittedTourIdRef`); folder
  // expand / collapse within a tour does NOT re-fit. Manual drag
  // width does not carry over — the next tour-switch overwrites it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (view.kind !== "ok") return;
    const id = view.bundle.tour.id;
    if (lastFittedTourIdRef.current === id) return;
    if (view.tree.visibleRows.length === 0) return;
    lastFittedTourIdRef.current = id;
    captureResizeSnapshot();
    const fitted = computeAutoFitWidthPx(
      view.tree.visibleRows,
      window.innerWidth,
    );
    setSidebarWidth(fitted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Drag uses the manual clamp (see `clampSidebarWidthManualPx`); the
  // capture-before-commit / apply-after-commit pattern is owned by
  // `resizeSnapshotRef` + the resize-apply useLayoutEffect above.
  const handleSidebarResize = useCallback(
    (rawWidth: number) => {
      const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
      const next = clampSidebarWidthManualPx(rawWidth, vw);
      if (next === sidebarWidth) return;
      captureResizeSnapshot();
      setSidebarWidth(next);
    },
    [sidebarWidth, captureResizeSnapshot],
  );

  const handleSidebarResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleSidebarResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Defensive: keep the sidebar width inside the manual clamp when the
  // browser resizes. Without this, dragging out the window from
  // 1800 px to 800 px could leave the sidebar at 1400 px and hide the
  // diff entirely.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setSidebarWidth((w) =>
        clampSidebarWidthManualPx(w, window.innerWidth),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keep the intent-handler input ref fresh. The listener fires
  // synchronously inside store.dispatch, BEFORE React re-renders, so its
  // closure can't see post-dispatch state — but it can read the values
  // from the most recent commit via this ref.
  intentInputsRef.current = {
    setSelectedFile,
    revealFileAncestors,
    findFileBlock,
  };

  // Sidebar counterparts so memoized FileRow / FolderRow don't re-render
  // on every App state change. Path flows as an argument, so a single
  // stable function reference serves every sidebar row.
  const registerSidebarRef = useCallback(
    (path: string, el: HTMLButtonElement | null) => {
      if (el) sidebarRowRefs.current.set(path, el);
      else sidebarRowRefs.current.delete(path);
    },
    [],
  );
  const selectFile = useCallback(
    (name: string) => {
      setSelectedFile(name);
      // PRD #343 / ADR 0031 / issue #346: keep the sidebar keyboard
      // cursor in sync with file selection so a subsequent Esc into
      // sidebar mode lands the roving tabindex on the same row.
      setSidebarSelectedPath(name);
      const el = findFileBlock(name);
      // Instant scroll, file header at the top: clicking a file expresses
      // "show me from the top." Smooth scroll over multi-viewport distances
      // is disorienting in a code-review surface.
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
      // Sidebar click is a navigation gesture, not an explicit reveal —
      // issue #313. The cursor lands on the file's first walkable row
      // (synthetic `collapsed-file` banner when classifier-collapsed; first
      // diff row otherwise); Enter on the banner is the explicit-reveal
      // escape hatch. Comment jumps (n/p, ?ann= restore) still force-
      // unfold — see this file's `gotoNextCard` / `gotoPrevCard` callsites.
      // Cursor follows the click — matches the TUI rule (PRD US 20). The
      // reducer's `nearest` default for scrollCursorTarget keeps the
      // first-row scroll from fighting the file-block scroll above: the
      // row is already at the top after `block: "start"`, so `nearest`
      // is a no-op. `?ann=` (comment-focus bookmark) is left untouched.
      if (view.kind !== "ok") return;
      const seeded = cursorAtFirstFileRow(name, view.rows.flatRowsList);
      if (seeded) store.dispatch({ type: "cursor.set", anchor: seeded });
    },
    [findFileBlock, view, store],
  );

  // PRD #343 / ADR 0031 / issue #346: mouse-click handlers route
  // through paneFocus too. Sidebar row clicks set paneFocus = sidebar
  // (and the DOM focus is realised via the focus useEffect above);
  // diff row / comment card clicks set paneFocus = diff. The auto-flip
  // matrix from the PRD lives here for the click axis; keyboard
  // dispatch's auto-flip happens at the keymap action handler.
  const onSidebarRowClick = useCallback(
    (path: string, kind: "file" | "folder") => {
      setSidebarSelectedPath(path);
      store.dispatch({ type: "paneFocus.setSidebar" });
      if (kind === "file") {
        selectFile(path);
      } else {
        toggleFolder(path);
      }
    },
    [store, selectFile, toggleFolder],
  );

  // Tour-level (PR-equivalent) `+N -M` totals for the title-bar indicator
  // (issue #233 / PRD #212). Computed once per bundle by planning each
  // file's rows with stable args (split layout, empty expansion, no
  // comments, no classifier-collapse) so the count reflects the FULL
  // diff regardless of which files are currently collapsed in the UI or
  // classifier-flagged for collapse. Cursor moves, layout toggles,
  // expansion changes, and comment navigation do NOT re-walk.
  const filesByName =
    view.kind === "ok" ? view.bundle.filesByName : null;
  const tourStats = useMemo(() => {
    const files = parsedFiles.map((f) => {
      const bf = filesByName?.get(f.name);
      const rows = planRows(f, [], "split", {
        oldContent: bf?.oldContent,
        newContent: bf?.newContent,
        expansion: emptyExpansion(),
        classifierCollapsed: false,
      });
      return { rows };
    });
    return tourDiffStats(files);
  }, [parsedFiles, filesByName]);

  // Lazy materialization (ADR 0012). Dispatches `cursor.materialize` so
  // the reducer's strict no-op on a non-null cursor protects against
  // races; returns the seeded cursor so the caller can chain into
  // composer-open / move actions in one step.
  const materializeCursor = useCallback((): Cursor | null => {
    const c = store.getState().cursor;
    if (c) return c;
    if (view.kind !== "ok") return null;
    const seeded = initialCursor({
      topLevelComments: view.nav.topLevel,
      flatRows: view.rows.flatRowsList,
    });
    if (seeded) store.dispatch({ type: "cursor.materialize", anchor: seeded });
    return seeded;
  }, [store, view]);

  // Auto-recall (PRD #192 / ADR 0022). When `r` or `R` fires and the cursor's
  // card is not in the viewport, smooth-scroll it to centre BEFORE mounting
  // the composer / dispatching the agent. The pure logic lives in
  // `./auto-recall.ts` so it can be unit-tested without mounting <App />.
  const recallCardThen = useCallback(
    (commentId: string, then: () => void): void => {
      recallCardIntoView({
        cardElement: commentRefs.current.get(commentId) ?? null,
        viewportHeight:
          window.innerHeight || document.documentElement.clientHeight || 0,
        then,
      });
    },
    [],
  );

  // Gap-size lookups for the expansion dispatcher. Mirror of the TUI's
  // hunkSeparatorGapSize / boundaryTopGapSize / boundaryBottomGapSize
  // (src/tui/app.tsx) — sourced from each file's parsed hunks plus the
  // bundle's `newContent` for the trailing gap. The dispatcher needs gap
  // size to drive `expand`'s saturation logic and the symmetric vs
  // unilateral direction choice.
  const hunkSeparatorGapSize = useCallback(
    (file: string, hunkIndex: number): number => {
      const meta = filesByName?.get(file);
      if (!meta || hunkIndex <= 0 || hunkIndex >= meta.hunks.length) return 0;
      const prev = meta.hunks[hunkIndex - 1];
      const next = meta.hunks[hunkIndex];
      return Math.max(0, next.additionStart - (prev.additionStart + prev.additionCount));
    },
    [filesByName],
  );
  const boundaryTopGapSize = useCallback(
    (file: string): number => {
      const meta = filesByName?.get(file);
      if (!meta || meta.hunks.length === 0) return 0;
      return Math.max(0, meta.hunks[0].additionStart - 1);
    },
    [filesByName],
  );
  const boundaryBottomGapSize = useCallback(
    (file: string): number => {
      const meta = filesByName?.get(file);
      if (!meta || meta.hunks.length === 0) return 0;
      const last = meta.hunks[meta.hunks.length - 1];
      const lastEnd = last.additionStart + last.additionCount - 1;
      const content = meta.newContent;
      if (!content) return 0;
      const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
      const lineCount = trimmed === "" ? 0 : trimmed.split("\n").length;
      return Math.max(0, lineCount - lastEnd);
    },
    [filesByName],
  );

  // Translates the FileBlock-emitted ExpandAction into the matching
  // `expansion.*` action on the Tour-session store (PRD #229 slice 2,
  // issue #232). PRD #212 / #151: mid-file hunk-header is direction-
  // aware — large gaps (remaining > 2N = 40) expand the bottom (lines
  // appear above the @@); small gaps (≤ 40) expand symmetrically. gap-
  // mid-top expands the top (adjacent to the previous hunk). FileBlock
  // packages this as `{ kind, file, boundaryRef, direction, count }`;
  // the count is the modifier-aware step (shift → full gap, otherwise
  // EXPANSION_STEP=20). Map count → mode here: count ≥ remaining gap
  // → "all"; otherwise "symmetric-20".
  // PRD #270 / issue #274 (Slice 4): enumerate every addressable boundary
  // of a file with its current gap size, so the per-file Expand-all
  // dispatch saturates each gap in one reducer hop. File-top gap fires
  // iff additionStart > 1; mid-file gaps fire iff prev-end -> next-start
  // > 0; file-bottom fires iff lastEnd < lineCount.
  const fileBoundaryGaps = useCallback(
    (file: string): { ref: BoundaryRef; gapSize: number }[] => {
      const meta = filesByName?.get(file);
      if (!meta || meta.hunks.length === 0) return [];
      const out: { ref: BoundaryRef; gapSize: number }[] = [];
      const topGap = boundaryTopGapSize(file);
      if (topGap > 0) out.push({ ref: "top", gapSize: topGap });
      for (let i = 1; i < meta.hunks.length; i++) {
        const gap = hunkSeparatorGapSize(file, i);
        if (gap > 0) out.push({ ref: i, gapSize: gap });
      }
      const botGap = boundaryBottomGapSize(file);
      if (botGap > 0) out.push({ ref: "bottom", gapSize: botGap });
      return out;
    },
    [filesByName, boundaryTopGapSize, hunkSeparatorGapSize, boundaryBottomGapSize],
  );

  const dispatchExpand = useCallback(
    (action: ExpandAction) => {
      if (action.kind === "expand-file") {
        store.dispatch({ type: "expansion.expandFile", file: action.file });
        return;
      }
      if (action.kind === "expand-file-all") {
        store.dispatch({
          type: "expansion.expandFileAll",
          file: action.file,
          boundaries: fileBoundaryGaps(action.file),
        });
        return;
      }
      const { file, boundaryRef, direction, count } = action;
      const gapSize =
        boundaryRef === "top"
          ? boundaryTopGapSize(file)
          : boundaryRef === "bottom"
            ? boundaryBottomGapSize(file)
            : hunkSeparatorGapSize(file, boundaryRef);
      if (gapSize === 0) return;
      // Issue #381: producer-side translation from the click target's
      // user-facing direction (banner ↑ → "up", standalone ↓ → "down")
      // to the reducer's gap-edge direction. For mid-file (numeric ref):
      // user-facing "up" reveals lines just above the banner = bottom
      // edge of the gap = gap-edge "down"; user-facing "down" reveals
      // lines just below the standalone row = top edge of the gap =
      // gap-edge "up". File-top / file-bottom dispatches route through
      // `expandTop` / `expandBottom` and ignore `direction`, so they
      // skip the flip. `"both"` is symmetric and unaffected.
      let effectiveDirection: "up" | "down" | "both" = direction;
      if (typeof boundaryRef === "number") {
        if (direction === "up") effectiveDirection = "down";
        else if (direction === "down") effectiveDirection = "up";
      }
      // direction "both" needs gap-remaining > 2N to fall back to "down"
      // (matches the TUI's mid-file hunk-header rule). FileBlock passes
      // direction="both" for mid-file hunk-headers; refine here using
      // expansion state. The fallback target ("down" = bottom of gap =
      // immediately above the banner) is already in gap-edge vocabulary
      // and matches the user-facing `↕` intent (reveal near the banner),
      // so it runs after — not flipped by — the producer-side translation.
      if (direction === "both" && typeof boundaryRef === "number") {
        const cur = getBoundary(expansion, { file, ref: boundaryRef });
        const remaining = gapSize - cur.up - cur.down;
        if (remaining > GAP_TWO_ROW_THRESHOLD) effectiveDirection = "down";
      }
      const mode = count >= gapSize ? "all" : "symmetric-20";
      if (boundaryRef === "top") {
        store.dispatch({ type: "expansion.expandTop", file, mode, gapSize });
      } else if (boundaryRef === "bottom") {
        store.dispatch({ type: "expansion.expandBottom", file, mode, gapSize });
      } else {
        store.dispatch({
          type: "expansion.expand",
          file,
          ref: boundaryRef,
          direction: effectiveDirection,
          mode,
          gapSize,
        });
      }
    },
    [
      hunkSeparatorGapSize,
      boundaryTopGapSize,
      boundaryBottomGapSize,
      fileBoundaryGaps,
      expansion,
      store,
    ],
  );

  // Global keydown router (ADR 0012). Cursor motion (j/k/h/l/arrows),
  // side selection, comment-at-cursor (c), comment nav (n/p, with
  // β-coupling to the line cursor), layout toggle (Shift-L, rebound
  // from the previous lowercase l), and picker open (Shift-T) all flow
  // through the pure dispatchCursorKey classifier so the keymap
  // contract is testable independent of React state plumbing.
  // Effect is registered AFTER `flatRowsList` and `materializeCursor`
  // are declared so the deps array doesn't read a TDZ binding during
  // render (Issue #131). The handler closure refs would be safe on
  // their own — they only execute on a keystroke — but the deps array
  // is constructed every render, so source position matters here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const focusInEditable = !!(
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      );
      // Enter on a gap-row interactive cursor → dispatch the same
      // expansion action as clicking the row's chevron (PRD #212 user-
      // stories 7-8). collapsed-file routes to `expand-file`; the
      // hunk-header banner's `boundary-top` / `hunk-separator` cursor
      // routes through `hunkHeaderExpandPlan` (issue #280); standalone
      // `expand-down` uses EXPANSION_STEP. The Shift modifier carries
      // no special meaning (PRD #270 Slice 5 / issue #275).
      //
      // Issue #306: when the dispatch consumes the row's gap entirely
      // (banner with primaryExpand:"all", expand-down with addition >=
      // remaining for file-bottom or new-gap < 40 for mid-file, or any
      // collapsed-file press) the next render drops the row from
      // flatRows and `j`/`k` no-ops on the stranded anchor. Predict the
      // orphan, capture a landing target via `cursorAfterExpand` against
      // the pre-dispatch flatRows, then dispatch `cursor.set` alongside
      // the `expansion.*` action so state and view stay in lockstep.
      if (
        e.key === "Enter" &&
        !focusInEditable &&
        composerTarget === null &&
        !pickerOpen &&
        cursor?.kind === "row" &&
        cursor.interactive
      ) {
        const subKind = cursor.interactive.subKind;
        const boundaryRef = cursor.interactive.boundaryRef;
        const flatRowsBefore = view.kind === "ok" ? view.rows.flatRowsList : [];
        if (subKind === "collapsed-file") {
          e.preventDefault();
          const landing = cursorAfterExpand(cursor, flatRowsBefore, "collapsed-file");
          dispatchExpand({ kind: "expand-file", file: cursor.file });
          if (landing !== cursor) {
            store.dispatch({ type: "cursor.set", anchor: landing });
          }
          return;
        }
        let gapSize: number;
        if (subKind === "boundary-top") {
          gapSize = boundaryTopGapSize(cursor.file);
        } else if (boundaryRef === "bottom") {
          gapSize = boundaryBottomGapSize(cursor.file);
        } else if (typeof boundaryRef === "number") {
          gapSize = hunkSeparatorGapSize(cursor.file, boundaryRef);
        } else {
          gapSize = 0;
        }
        if (gapSize > 0) {
          e.preventDefault();
          // Issue #280: `boundary-top` / `hunk-separator` now address
          // the hunk-header banner's interactive left cell. Re-derive
          // its `primaryExpand` from the gap-size + edge position via
          // the same helper the planner uses; route Up → "up" /
          // EXPANSION_STEP, All → "both" / gapSize. Standalone
          // `expand-down` keeps its own per-direction path. Shift
          // carries no special meaning (PRD #270 Slice 5 / issue #275).
          let direction: "up" | "down" | "both";
          let count: number;
          let orphanKind: ExpandOrphanKind | null = null;
          if (subKind === "boundary-top" || subKind === "hunk-separator") {
            const plan = hunkHeaderExpandPlan(
              gapSize,
              subKind === "boundary-top",
            );
            if (plan.primaryExpand === null) return;
            if (plan.primaryExpand === "up") {
              direction = "up";
              count = EXPANSION_STEP;
            } else {
              direction = "both";
              count = gapSize;
              // "all" dispatch reveals the entire remaining gap → next
              // render sets primaryExpand=null and the banner drops out
              // of flatRows. Issue #306 orphan path.
              orphanKind = subKind === "boundary-top" ? "boundary-top" : "hunk-separator";
            }
          } else if (subKind === "expand-down") {
            direction = "down";
            count = EXPANSION_STEP;
            // Predict orphan from the post-dispatch remaining gap. The
            // surface's dispatch maps to mode="all" iff count >= gapSize
            // (whole gap fits in one press); otherwise symmetric-20
            // direction="down" adds min(EXPANSION_STEP, remaining). Bottom
            // row stops emitting when new gap == 0; mid-file row stops
            // emitting when new gap < GAP_TWO_ROW_THRESHOLD (planner's
            // `emitLeadingExpandDown` rule).
            const ref = boundaryRef === "bottom" ? "bottom" : (boundaryRef as number);
            const cur = getBoundary(expansion, { file: cursor.file, ref });
            const remaining = gapSize - cur.up - cur.down;
            const addition = Math.min(EXPANSION_STEP, remaining);
            const newRemaining = remaining - addition;
            if (boundaryRef === "bottom") {
              orphanKind = newRemaining <= 0 ? "expand-down-bottom" : null;
            } else {
              orphanKind = newRemaining < GAP_TWO_ROW_THRESHOLD ? "expand-down-mid" : null;
            }
          } else {
            return;
          }
          const landing =
            orphanKind === null
              ? null
              : cursorAfterExpand(cursor, flatRowsBefore, orphanKind);
          dispatchExpand({
            kind: "expand",
            file: cursor.file,
            boundaryRef,
            direction,
            count,
          });
          if (landing !== null && landing !== cursor) {
            store.dispatch({ type: "cursor.set", anchor: landing });
          }
          return;
        }
      }
      const cardAuthorKind =
        view.kind === "ok" ? view.cursor.cardComment?.author_kind ?? null : null;
      // PRD #343 / ADR 0031 / issue #346: sidebar keyboard navigation
      // routes through paneFocus + selectedRowKind. The keymap returns
      // sidebar-mode actions (move-file-up/down, select-file,
      // toggle-folder, expand-folder, collapse-folder, collapse-parent,
      // pane-focus-toggle, close-modal) when paneFocus = sidebar; the
      // App switch arm below dispatches the matching store actions.
      const visibleRows =
        view.kind === "ok" ? view.tree.visibleRows : [];
      const selectedRow =
        sidebarSelectedPath === null
          ? null
          : visibleRows.find((r) => r.path === sidebarSelectedPath) ?? null;
      const action = dispatchCursorKey(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
        },
        {
          composerOpen: composerTarget !== null,
          pickerOpen,
          focusInEditable,
          cursorOnCard: view.kind === "ok" ? view.cursor.onCard : false,
          cursorOnHumanCard: cardAuthorKind === "human",
          replyLockHeld: replyLock !== null,
          replyAgent: replyAgent ?? undefined,
          paneFocus,
          selectedRowKind: selectedRow?.kind ?? null,
        },
      );
      if (action.type === "noop") return;
      if (action.type === "status") {
        e.preventDefault();
        flashFooterStatus(action.message);
        return;
      }
      e.preventDefault();
      // Lazy materialization rule (ADR 0012): the first j/k/h/l just
      // SHOWS the cursor at the default target, no move past it. `a`
      // materializes AND opens the composer (handled inline below).
      // `cursor.materialize` dispatch fires scrollCursorTarget via the
      // reducer's setCursor helper, so no explicit scroll call here.
      const motion =
        action.type === "move-down" ||
        action.type === "move-up" ||
        action.type === "set-side-additions" ||
        action.type === "set-side-deletions";
      if (motion && !cursor) {
        materializeCursor();
        return;
      }
      switch (action.type) {
        case "open-picker":
          openPicker();
          return;
        case "pane-focus-toggle":
          // PRD #343 / ADR 0031 / issue #346: Esc toggles paneFocus
          // (modal-unwind already routed through close-modal above).
          store.dispatch({ type: "paneFocus.toggle" });
          return;
        case "close-modal":
          // Defense in depth: in production the inline composer
          // textarea's onKeyDown intercepts Esc when focus is inside
          // the textarea, and the picker owns its close binding. This
          // arm fires when Esc lands on the global handler with a
          // modal open but unfocused — e.g. a click-outside while
          // composer is open.
          if (composerTarget !== null) {
            store.dispatch({ type: "composer.close" });
          } else if (pickerOpen) {
            store.dispatch({ type: "picker.close" });
          }
          return;
        case "move-file-down":
        case "move-file-up": {
          if (view.kind !== "ok") return;
          const rows = view.tree.visibleRows;
          if (rows.length === 0) return;
          const down = action.type === "move-file-down";
          const idx =
            sidebarSelectedPath === null
              ? -1
              : rows.findIndex((r) => r.path === sidebarSelectedPath);
          let nextIdx: number;
          if (idx === -1) {
            nextIdx = down ? 0 : rows.length - 1;
          } else {
            nextIdx = Math.max(0, Math.min(rows.length - 1, idx + (down ? 1 : -1)));
          }
          if (nextIdx === idx) return;
          setSidebarSelectedPath(rows[nextIdx].path);
          return;
        }
        case "select-file": {
          // PRD #343 / ADR 0031 / issue #346: Enter on a file row in
          // sidebar mode selects the file AND flips paneFocus to diff
          // (auto-flip matrix). selectFile already updates
          // sidebarSelectedPath; the keymap's auto-flip happens here.
          if (selectedRow?.kind !== "file") return;
          selectFile(selectedRow.path);
          store.dispatch({ type: "paneFocus.setDiff" });
          return;
        }
        case "toggle-folder": {
          // PRD #343 / ADR 0031 / issue #346: Enter on a folder row in
          // sidebar mode toggles the fold; paneFocus stays on sidebar
          // (folder toggle is sidebar-internal per the auto-flip
          // matrix). Selection stays on the same folder row.
          if (selectedRow?.kind !== "folder") return;
          toggleFolder(selectedRow.path);
          return;
        }
        case "expand-folder": {
          // l / ArrowRight on a collapsed folder. No-op when already
          // open (matches the TUI's `if (!collapsedFolders.has(path))`
          // guard); the toggle dispatch would otherwise CLOSE the
          // folder, which contradicts the directional semantic.
          if (selectedRow?.kind !== "folder") return;
          if (!collapsedFolders.has(selectedRow.path)) return;
          toggleFolder(selectedRow.path);
          return;
        }
        case "collapse-folder": {
          // h / ArrowLeft on an open folder. Symmetric to expand-folder.
          if (selectedRow?.kind !== "folder") return;
          if (collapsedFolders.has(selectedRow.path)) return;
          toggleFolder(selectedRow.path);
          return;
        }
        case "collapse-parent": {
          // h / ArrowLeft on a file row: jump the sidebar cursor up to
          // the parent folder. Matches the TUI's collapse-parent
          // semantic but the webapp doesn't need to re-flatten the
          // tree — visibleRows already excludes hidden subtrees, so
          // the parent's row index is stable.
          if (selectedRow?.kind !== "file") return;
          if (view.kind !== "ok") return;
          const segments = selectedRow.path.split("/");
          if (segments.length < 2) return;
          // Walk up segments looking for a visible folder row whose
          // path matches; the file's nearest visible ancestor is the
          // target (path-compression in core/file-tree.ts may have
          // collapsed several segments into a single folder row, so
          // an exact path match isn't guaranteed at any one depth).
          const candidates: string[] = [];
          for (let i = segments.length - 1; i > 0; i--) {
            candidates.push(segments.slice(0, i).join("/"));
          }
          const parentRow = view.tree.visibleRows.find(
            (r) => r.kind === "folder" && candidates.includes(r.path),
          );
          if (!parentRow) return;
          setSidebarSelectedPath(parentRow.path);
          return;
        }
        case "toggle-layout": {
          // Issue #303: `setLayoutChoice` snapshots the cursor row's
          // pre-toggle viewport-y before dispatching; the layout-change
          // useLayoutEffect below pins the row at the same screen-y after
          // React commits the new layout. The header LayoutToggle button
          // routes through the same callback so both paths preserve.
          setLayoutChoice(store.getState().layout === "split" ? "unified" : "split");
          return;
        }
        case "nav-next-comment":
          // PRD #343 / ADR 0031 / issue #346: n/p auto-flip paneFocus
          // to diff (Comment jump targets the diff pane).
          store.dispatch({ type: "paneFocus.setDiff" });
          navigateBy(1);
          return;
        case "nav-prev-comment":
          store.dispatch({ type: "paneFocus.setDiff" });
          navigateBy(-1);
          return;
        case "move-down": {
          // Compute next pure via moveCursor against the latest
          // flat-rows; cursor.set dispatch fires scrollCursorTarget
          // which the intent listener realizes as scrollIntoView.
          if (view.kind !== "ok") return;
          const next = moveCursor(cursor, "down", view.rows.flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "move-up": {
          if (view.kind !== "ok") return;
          const next = moveCursor(cursor, "up", view.rows.flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "set-side-additions": {
          // Horizontal side toggle stays on the same row, so the cell is
          // already on screen — scrollCursorTarget's scrollIntoView call
          // is a no-op on a visible cell. cursor.setSide is the pure-
          // preference path for cards / interactive rows; row anchors
          // route through `setCursorSide` + cursor.set so the lineNumber
          // recomputes for paired rows.
          if (view.kind !== "ok") return;
          const next = setCursorSide(cursor, "additions", view.rows.flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "set-side-deletions": {
          if (view.kind !== "ok") return;
          const next = setCursorSide(cursor, "deletions", view.rows.flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "comment-at-cursor": {
          const c = cursor ?? materializeCursor();
          if (!c) return;
          // The keymap routes `a` to a noop when cursorOnCard is true,
          // so this only fires for row cursors (and null → seeded to a
          // row). Defensive guard keeps the type narrow consistent.
          if (c.kind !== "row") return;
          // Interactive rows (gap-row family, collapsed-file) are not
          // annotatable — `a` is a silent no-op (issue #154, PRD #107 US 14).
          if (c.interactive) return;
          store.dispatch({
            type: "composer.open",
            target: {
              kind: "top-level",
              file: c.file,
              side: c.side,
              line_start: c.lineNumber,
              line_end: c.lineNumber,
            },
          });
          return;
        }
        case "open-reply-on-card": {
          // PRD #192 / ADR 0022. `r` on a card opens the Reply composer
          // for the latest Comment in that thread (matches the in-card
          // Reply button's #191 semantics). When the cursor's card is off-
          // screen the renderer auto-recalls it before the composer mounts
          // (US 14 — the action reveals its target).
          if (view.kind !== "ok") return;
          const cardAnn = view.cursor.cardComment;
          const cardId = view.cursor.cardId;
          if (!cardAnn || !cardId) return;
          const latestId = latestCommentId(
            cardAnn,
            [...(view.nav.repliesByRoot.get(cardId) ?? [])],
          );
          recallCardThen(cardId, () => {
            store.dispatch({
              type: "composer.open",
              target: { kind: "reply", replies_to: latestId },
            });
          });
          return;
        }
        case "send-on-card": {
          // PRD #192 / ADR 0022. `R` (shift-r, post issue #390) on a card
          // dispatches the latest human leaf in that thread to the
          // configured reply-agent. The latest-human-leaf rule is consumed
          // from `view.nav.sendTarget` (PRD #242), shared with the TUI's
          // `R` dispatch. Hidden / disabled
          // cases (agent-card, already-replied, lock-held, no agent
          // configured) are silently skipped — the verdict gate is the
          // existing per-card `canSendToAgent` predicate.
          //
          // PRD #278 slice 7: the dispatch goes through the Tour-session
          // runtime via the `send-to-agent` reducer action, which emits the
          // auto-recall `scrollCursorTarget` + `requestReply` intent pair.
          if (view.kind !== "ok") return;
          if (!tourId || !replyAgent) return;
          const target = view.nav.sendTarget;
          if (!target) return;
          const verdict = canSendToAgent({
            replyAgentConfigured: true,
            lockHeld: replyLock !== null,
            authorKind: target.leaf.author_kind,
            hasReply: false,
          });
          if (!verdict.enabled) return;
          store.dispatch({
            type: "send-to-agent",
            tourId,
            commentId: target.leafId,
          });
          return;
        }
        case "yank-at-cursor": {
          // PRD #356 / issue #358: context-aware yank. Symmetric to
          // the TUI handler (#357 / src/tui/app.tsx). Resolver collapses
          // (paneFocus, cursor, sidebar selection, comments, bundle
          // files) into a YankTarget; this handler is the thin transport
          // + footer-flash wrapper. Diff-row cursor → line text; card /
          // interactive / sidebar-file → path; degenerate state →
          // labelled none. Clipboard rejection is silent (matches #319).
          const target = resolveYankTarget({
            paneFocus,
            cursor,
            sidebarSelectedRow: selectedRow ?? null,
            comments: view.kind === "ok" ? view.bundle.comments : [],
            bundleFiles:
              view.kind === "ok" ? view.bundle.filesByName : new Map(),
          });
          if (target.kind === "none") {
            flashFooterStatus(
              target.reason === "no-selection"
                ? "y: no selection"
                : "y: no cursor",
            );
            return;
          }
          const text = target.kind === "path" ? target.path : target.text;
          const message =
            target.kind === "path"
              ? `Copied ${target.path}`
              : `Copied "${truncateForPreview(target.text)}"`;
          const write = navigator.clipboard?.writeText?.(text);
          if (!write) return;
          write.then(
            () => flashFooterStatus(message),
            () => {},
          );
          return;
        }
        case "open-in-editor": {
          // PRD #349 / ADR 0032 / issue #353 (transport) + issue #354
          // (permissive resolution). Resolver collapses (paneFocus, cursor,
          // sidebar selection, comments) into an OpenTarget or null. Null
          // → footer hint, no roundtrip. Otherwise POST to
          // /api/tours/<id>/open-in-editor and pipe the response's
          // `message` field verbatim into the footer — the server is
          // the source of truth for user-facing strings (matches the
          // wording the TUI surfaces from core/editor-spawn).
          const target = resolveOpenTarget({
            paneFocus,
            cursor,
            sidebarSelectedRow: selectedRow ?? null,
            comments: view.kind === "ok" ? view.bundle.comments : [],
          });
          if (!target) {
            if (cursor && cursor.kind === "row" && cursor.interactive) {
              flashFooterStatus("o: not on a diff row — j/k to land on a line");
            } else {
              flashFooterStatus("o: no file under cursor");
            }
            return;
          }
          if (!tourId) return;
          void dispatchOpenInEditor(
            tourId,
            target.file,
            target.line,
            cursor && cursor.kind === "row" ? cursor.side : "additions",
            flashFooterStatus,
          );
          return;
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    navigateBy,
    pickerOpen,
    openPicker,
    cursor,
    composerTarget,
    view,
    materializeCursor,
    recallCardThen,
    tourId,
    replyAgent,
    replyLock,
    dispatchExpand,
    boundaryTopGapSize,
    boundaryBottomGapSize,
    hunkSeparatorGapSize,
    store,
    flashFooterStatus,
    paneFocus,
    sidebarSelectedPath,
    selectFile,
    toggleFolder,
    collapsedFolders,
  ]);

  const closeComposer = useCallback(() => {
    store.dispatch({ type: "composer.close" });
  }, [store]);

  // Row clicks seed the Line cursor only (issue #137 / PRD #136). The
  // composer is reached via the keyboard `a` shortcut.
  // PRD #343 / ADR 0031 / issue #346: also flip paneFocus to diff so
  // subsequent keystrokes target the diff pane (mouse + keyboard
  // converge on the same paneFocus state).
  const setCursorFromRowClick = useCallback(
    (file: string, side: "additions" | "deletions", line: number) => {
      store.dispatch({ type: "paneFocus.setDiff" });
      store.dispatch({
        type: "cursor.set",
        anchor: { kind: "row", file, lineNumber: line, side, preferredSide: side },
      });
    },
    [store],
  );

  // Issue #320: soft-modal `+` button. Closed → seed cursor + open at
  // `line_start == line_end` (parity with the keyboard `a` flow). Non-closed
  // → `composer.recall` so the in-flight Composer comes back to the user
  // instead of a second one opening (see the reducer's `composer.recall`
  // branch for the recall mechanics).
  const openComposerOnRow = useCallback(
    (anchor: { file: string; side: "additions" | "deletions"; lineNumber: number }) => {
      const c = store.getState().composer;
      if (c.kind === "closed") {
        store.dispatch({
          type: "cursor.set",
          anchor: {
            kind: "row",
            file: anchor.file,
            lineNumber: anchor.lineNumber,
            side: anchor.side,
            preferredSide: anchor.side,
          },
        });
        store.dispatch({
          type: "composer.open",
          target: {
            kind: "top-level",
            file: anchor.file,
            side: anchor.side,
            line_start: anchor.lineNumber,
            line_end: anchor.lineNumber,
          },
        });
        return;
      }
      store.dispatch({ type: "composer.recall" });
    },
    [store],
  );

  // Issue #320: `data-composer-open` on <html> is the single CSS hook every
  // `+` button reads to switch between normal-accent and ghost appearance.
  // Mirrors the validated `composer.kind !== "closed"` state.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (composer.kind === "closed") {
      root.removeAttribute("data-composer-open");
    } else {
      root.setAttribute("data-composer-open", "true");
    }
    return () => {
      root.removeAttribute("data-composer-open");
    };
  }, [composer.kind]);

  // Click anywhere on a Comment card → lands the cursor on that card
  // (PRD #192 / ADR 0022 slice 2). Mouse-driven path matches keyboard
  // n/p: both write a CardAnchor for the clicked / nav'd top-level
  // comment.
  // PRD #343 / ADR 0031 / issue #346: also flip paneFocus to diff —
  // comment cards live in the diff pane.
  const setCursorFromCardClick = useCallback(
    (commentId: string) => {
      if (view.kind !== "ok") return;
      const a = view.bundle.comments.find((x) => x.id === commentId);
      if (!a) return;
      store.dispatch({ type: "paneFocus.setDiff" });
      store.dispatch({
        type: "cursor.set",
        anchor: cursorFromComment(a, preferredSideOf(store.getState().cursor)),
      });
      setSelectedFile(a.file);
    },
    [view, store],
  );

  const openReplyComposer = useCallback(
    (replies_to: string) => {
      store.dispatch({
        type: "composer.open",
        target: { kind: "reply", replies_to },
      });
    },
    [store],
  );

  // Issue #383 / ADR 0035: mouse paths to open-in-editor. Two callers:
  // the annotation card filename link (cursor moves first, then dispatch
  // at line_end) and the file-header `↗` icon (no cursor move, dispatch
  // at line 1). Both reuse the keyboard `o` server contract via the
  // dispatchOpenInEditor helper. The callback is null when tourId is
  // unseeded so the click sites can render but the dispatch is a no-op.
  const openInEditor = useCallback(
    (file: string, line: number, side: "additions" | "deletions") => {
      if (!tourId) return;
      void dispatchOpenInEditor(tourId, file, line, side, flashFooterStatus);
    },
    [tourId, flashFooterStatus],
  );

  const onAnnotationFileClick = useCallback(
    (commentId: string, file: string, lineEnd: number) => {
      setCursorFromCardClick(commentId);
      openInEditor(file, lineEnd, "additions");
    },
    [setCursorFromCardClick, openInEditor],
  );

  // Explicit reply-agent dispatch (issue #184, ADR 0021; relabelled in
  // issue #390). Fired by the `Request reply` button below each human
  // Comment card. Dispatches the `send-to-agent` reducer action — the
  // action type stays for back-compat; only the user-facing label
  // moved. The Tour-session runtime + web
  // adapter chain emits the auto-recall `scrollCursorTarget` intent and
  // POSTs `/api/tours/:id/request-reply` (PRD #278 slice 7). Fire-and-
  // forget — the watcher's `reply-in-flight` SSE event surfaces the in-
  // flight pill; on completion, `comment-changed` brings in the
  // landed Reply.
  const sendToAgent = useCallback(
    (commentId: string) => {
      if (!tourId) return;
      store.dispatch({ type: "send-to-agent", tourId, commentId });
    },
    [tourId, store],
  );

  // Submit-or-retry dispatcher (PRD #234 slice 3, issue #238). Reads the
  // current composer kind and routes to `composer.submit` (open) or
  // `composer.retry` (errored); both transitions land on `submitting` and
  // emit the `submitComment` intent which the intent listener realises
  // as an HTTP POST. The body-trimming gate stays in the UI so we don't
  // round-trip whitespace-only drafts; the reducer doesn't validate body
  // shape.
  const submitComposer = useCallback(() => {
    const c = store.getState().composer;
    if (c.kind !== "open" && c.kind !== "errored") return;
    if (c.body.trim().length === 0) return;
    store.dispatch(
      c.kind === "open"
        ? { type: "composer.submit" }
        : { type: "composer.retry" },
    );
  }, [store]);

  const onComposerBodyChange = useCallback(
    (body: string) => {
      store.dispatch({ type: "composer.setBody", body });
    },
    [store],
  );

  // Issue #389 / ADR 0036 (Slice E): delete-confirm modal state. Trash
  // clicks open the modal targeting a comment id; confirm dispatches
  // the DELETE through the existing webapp-to-CLI bridge (the same
  // path that handles create/reply today) via `dispatchDeleteComment`.
  // Cancel / scrim / Esc all close without writing. SSE
  // `comment-changed` brings the cascade-projected state back to the
  // surface — no manual re-render needed.
  const [deleteModalTargetId, setDeleteModalTargetId] = useState<string | null>(
    null,
  );
  const openDeleteModal = useCallback((commentId: string) => {
    setDeleteModalTargetId(commentId);
  }, []);
  const closeDeleteModal = useCallback(() => {
    setDeleteModalTargetId(null);
  }, []);
  const confirmDeleteModal = useCallback(() => {
    if (!tourId || deleteModalTargetId === null) {
      setDeleteModalTargetId(null);
      return;
    }
    const target = deleteModalTargetId;
    setDeleteModalTargetId(null);
    void dispatchDeleteComment(tourId, target).then((res) => {
      if (!res.ok && res.message) flashFooterStatus(res.message);
    });
  }, [tourId, deleteModalTargetId, flashFooterStatus]);

  const setLayoutChoice = useCallback(
    (next: Layout) => {
      // Issue #303: capture the cursor row's pre-toggle viewport-y so the
      // layout-change useLayoutEffect can pin the row at the same screen-y
      // after React commits the new layout. Mirrors the keymap-driven
      // toggle path — the header LayoutToggle button reaches the same
      // dispatch.
      if (cursor && view.kind === "ok") {
        const el = findCursorRowEl(cursor, view.rows.flatRowsList);
        if (el) layoutToggleSnapshotRef.current = { top: el.getBoundingClientRect().top };
      }
      store.dispatch({ type: "layout.set", layout: next });
    },
    [store, cursor, view, findCursorRowEl],
  );

  if (!bundleLoaded && !tourList) {
    return <div className="empty">Loading…</div>;
  }

  if (tourList && tourList.length === 0) {
    return <div className="empty">No tours found. Create one with: tour create --head HEAD</div>;
  }

  if (bundleError) {
    return <div className="empty">Error: {bundleError}</div>;
  }

  if (!bundle || !tourMeta) {
    return <div className="empty">Loading…</div>;
  }

  const titleIsEmpty = !tourMeta.title;

  // Header chrome reads `view.nav.navTotal` directly (NavBase is universal
  // across branches — issue #246). `currentIdx` is ok-only, so the pill
  // index discriminates via a property check on the nav slice rather than
  // on `view.kind`. SequencePill keeps the legacy `-1 = off-card / 0-based
  // when on-card` contract; the view's `nav.currentIdx` is 1-based with 0
  // meaning off-card.
  const pillIdx =
    "currentIdx" in view.nav && view.nav.currentIdx > 0
      ? view.nav.currentIdx - 1
      : -1;

  return (
    <>
      <div className="tour-header">
        <div className="tour-header-left">
          <button
            ref={pickerButtonRef}
            type="button"
            className="picker-button"
            aria-label="Switch tour"
            title="Switch tour"
            onClick={openPicker}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M2 4 H12 M2 7 H12 M2 10 H12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <h1 className={titleIsEmpty ? "untitled" : undefined}>
            {tourMeta.title || "(untitled)"}
          </h1>
          <span className="tour-refs">{headerSourcePair(tourMeta)}</span>
        </div>
        <div className="tour-header-right">
          {replyAgent ? (
            <span
              className="reply-agent-chip"
              role="status"
              title={`Press Shift+R on a human comment card to ask ${replyAgent} to reply. Runs in a separate session — does not message your current chat.`}
            >
              Reply agent: <strong>{replyAgent}</strong> · separate session
            </span>
          ) : null}
          <TourStatsIndicator
            additions={tourStats.additions}
            deletions={tourStats.deletions}
          />
          <SequencePill
            idx={pillIdx}
            total={view.nav.navTotal}
            onPrev={() => navigateBy(-1)}
            onNext={() => navigateBy(1)}
          />
          <LayoutToggle layout={layout} onChange={setLayoutChoice} />
        </div>
      </div>
      <div className="app-body">
        {view.kind === "snapshot-lost" ? (
          <>
            <aside
              className={`app-sidebar${isResizing ? " is-resizing" : ""}`}
              style={{ width: sidebarWidth }}
              aria-label="Files"
              data-pane-focus={paneFocus === "sidebar" ? "sidebar" : undefined}
            >
              <div className="sidebar-scroll" />
              <SidebarResizeHandle
                width={sidebarWidth}
                onResize={handleSidebarResize}
                onResizeStart={handleSidebarResizeStart}
                onResizeEnd={handleSidebarResizeEnd}
              />
            </aside>
            <main className="app-main">
              <div className="banner">
                Snapshot lost — comments preserved but diff cannot be displayed
              </div>
              <CommentListSnapshotLost
                nav={view.nav}
                cursor={cursor}
                registerCommentRef={registerCommentRef}
                composerTarget={composerTarget}
                composerBody={composerBody}
                composerError={composerError}
                onComposerBodyChange={onComposerBodyChange}
                onOpenReply={openReplyComposer}
                onSubmit={submitComposer}
                onCancel={closeComposer}
                replyLock={replyLock}
                replyAgent={replyAgent}
                onSendToAgent={sendToAgent}
                onCardClick={setCursorFromCardClick}
                onAnnotationFileClick={onAnnotationFileClick}
                onDeleteClick={openDeleteModal}
              />
            </main>
          </>
        ) : (
          <>
            <aside
              className={`app-sidebar${isResizing ? " is-resizing" : ""}`}
              style={{ width: sidebarWidth }}
              aria-label="Files"
              // PRD #343 / ADR 0031 / issue #346: pane-focus accent
              // border on the sidebar container when keyboard input
              // targets the file tree. CSS owns the actual border
              // styling — this attribute is the read-side hook.
              data-pane-focus={paneFocus === "sidebar" ? "sidebar" : undefined}
            >
              <div className="sidebar-scroll" role="tree" aria-label="Files">
                {view.tree.visibleRows.map((row) =>
                  row.kind === "folder" ? (
                    <FolderRow
                      key={`d:${row.path}`}
                      row={row}
                      onToggle={toggleFolder}
                      onActivate={onSidebarRowClick}
                      registerRef={registerSidebarRef}
                      // PRD #343 / ADR 0031 / issue #346: roving
                      // tabindex — exactly one row has tabindex=0 at
                      // any time (the sidebar keyboard cursor), all
                      // others are tabindex=-1. Browser Tab walks the
                      // sidebar in a single stop.
                      isTabStop={sidebarSelectedPath === row.path}
                    />
                  ) : (
                    <FileRow
                      key={`f:${row.path}`}
                      row={row}
                      selected={selectedFile === row.path}
                      registerRef={registerSidebarRef}
                      onSelect={selectFile}
                      onActivate={onSidebarRowClick}
                      isTabStop={sidebarSelectedPath === row.path}
                    />
                  ),
                )}
              </div>
              <SidebarResizeHandle
                width={sidebarWidth}
                onResize={handleSidebarResize}
                onResizeStart={handleSidebarResizeStart}
                onResizeEnd={handleSidebarResizeEnd}
              />
            </aside>
            <main className="app-main">
              <style>{FILE_GRID_CSS}</style>
              {Array.from(view.rows.plannedRowsByFile, ([fileName, rows]) => {
                const bf = view.bundle.filesByName.get(fileName);
                if (!bf) return null;
                // Issue #298: the file-header chrome `↕` button shows
                // iff the file has ≥ 2 distinct expandable gaps. With
                // ≤ 1 gap the per-hunk banner button (or standalone
                // expand-down for file-bottom) is exactly sufficient.
                // Issue #304: ALSO gate on the file body NOT being
                // collapsed — when the body is hidden, the gaps live
                // inside it and pressing `↕` would have no visible
                // effect. Mirrors the TUI's pre-existing collapse gate
                // (see src/tui/app.tsx near `<FileHeader>` render site).
                const meta = parsedFilesByName.get(fileName);
                const hasMultipleHiddenGaps =
                  !isCollapsed(fileName) &&
                  meta !== undefined &&
                  fileExpandableGapCount(meta, expansion, bf.newContent) >= 2;
                const topLevelComposer =
                  composerTarget &&
                  composerTarget.kind === "top-level" &&
                  composerTarget.file === fileName
                    ? composerTarget
                    : null;
                const composerAnchor = topLevelComposer
                  ? { side: topLevelComposer.side, line_end: topLevelComposer.line_end }
                  : null;
                const composerSlot = topLevelComposer ? (
                  <Composer
                    placeholder="Leave a comment"
                    submitLabel="Comment"
                    body={composerBody}
                    error={composerError}
                    onBodyChange={onComposerBodyChange}
                    onSubmit={submitComposer}
                    onCancel={closeComposer}
                  />
                ) : null;
                const replyTargetId =
                  composerTarget?.kind === "reply" ? composerTarget.replies_to : null;
                return (
                  <FileBlock
                    key={fileName}
                    file={bf}
                    rows={rows}
                    layout={layout}
                    cursor={cursor}
                    onDispatchExpand={dispatchExpand}
                    onRowClick={({ file, side, lineNumber }) =>
                      setCursorFromRowClick(file, side, lineNumber)
                    }
                    onAnnotate={openComposerOnRow}
                    onCardClick={setCursorFromCardClick}
                    onAnnotationFileClick={onAnnotationFileClick}
                    onOpenInEditor={openInEditor}
                    onDeleteClick={openDeleteModal}
                    commentProps={{
                      registerRef: registerCommentRef,
                      composerBody,
                      composerError,
                      onComposerBodyChange,
                      replyTargetId,
                      onOpenReply: openReplyComposer,
                      onSubmitReply: submitComposer,
                      onCancelReply: closeComposer,
                      replyLock,
                      replyAgent,
                      onSendToAgent: sendToAgent,
                      navIndexById: view.nav.navIndexById,
                      navTotal: view.nav.navTotal,
                    }}
                    isCollapsed={isCollapsed(fileName)}
                    onToggleCollapse={() => toggleCollapsed(fileName)}
                    hasMultipleHiddenGaps={hasMultipleHiddenGaps}
                    composerAnchor={composerAnchor}
                    composerSlot={composerSlot}
                  />
                );
              })}
            </main>
          </>
        )}
      </div>
      <Footer
        status={footerStatus}
        legend={composeFooterHints({
          surface: "web",
          // `replyAgent` gating lives in the composer (issue #332) —
          // pass it through unconditionally and let `showSendHint`
          // carry only the cursor + lock predicate at this call site.
          replyAgent: replyAgent ?? undefined,
          showSendHint:
            view.kind === "ok" &&
            view.cursor.onCard &&
            view.cursor.cardComment?.author_kind === "human" &&
            replyLock === null,
          // PRD #343 / ADR 0031 / issue #346: pane-aware legend.
          // Sidebar mode shows the shorter sidebar-relevant keys;
          // diff mode appends `Esc: sidebar` to today's web legend.
          paneFocus,
        })}
      />
      {sessionState.picker.kind === "open" ? (
        <TourPicker
          rows={sessionState.picker.rows}
          cursor={sessionState.picker.cursor}
          currentTourId={tourId}
          onMove={onPickerMove}
          onCommit={onPickerCommit}
          onClose={closePicker}
        />
      ) : null}
      {deleteModalTargetId !== null && bundle ? (() => {
        const target = bundle.comments.find(
          (c) => c.id === deleteModalTargetId,
        );
        if (!target) return null;
        return (
          <DeleteConfirmModal
            target={target}
            comments={bundle.comments}
            onConfirm={confirmDeleteModal}
            onCancel={closeDeleteModal}
          />
        );
      })() : null}
    </>
  );
}

// Tour-level (PR-equivalent) `+N -M` diff-stats indicator for the title bar
// (issue #233 / PRD #212). Display-only — no click handler, no nav role.
// Sides are independently omitted when their count is zero, so pure-addition
// / pure-deletion tours render cleanly (`+12` only, not `+12 -0`). The
// indicator renders nothing when both counts are zero — a tour with no diff
// content is degenerate, and a 0/0 placeholder would be visual noise.
// Exported so unit tests can mount the slot in isolation.
export function TourStatsIndicator({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.JSX.Element | null {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="tour-stats" aria-label="Tour diff stats">
      {additions > 0 ? (
        <span className="tour-stats-count added">{`+${additions}`}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="tour-stats-count deleted">{`-${deletions}`}</span>
      ) : null}
    </span>
  );
}

interface LayoutToggleProps {
  layout: Layout;
  onChange: (next: Layout) => void;
}

function LayoutToggle({ layout, onChange }: LayoutToggleProps): React.JSX.Element {
  return (
    <div className="layout-toggle" role="group" aria-label="Diff layout">
      <button
        type="button"
        className={`layout-toggle-btn${layout === "split" ? " active" : ""}`}
        aria-pressed={layout === "split"}
        onClick={() => onChange("split")}
      >
        Split
      </button>
      <button
        type="button"
        className={`layout-toggle-btn${layout === "unified" ? " active" : ""}`}
        aria-pressed={layout === "unified"}
        onClick={() => onChange("unified")}
      >
        Unified
      </button>
    </div>
  );
}

interface FolderRowProps {
  row: Extract<VisibleRow<BundleFile>, { kind: "folder" }>;
  onToggle: (path: string) => void;
  // PRD #343 / ADR 0031 / issue #346: paneFocus dispatch on click.
  // Unlike onToggle (which only mutates the fold state), onActivate
  // also flips paneFocus to sidebar and moves the sidebar keyboard
  // cursor to this row.
  onActivate?: (path: string, kind: "folder") => void;
  // Issue #367: folder rows participate in the same App-level ref
  // registry as file rows so the paneFocus = sidebar focus-realisation
  // effect can call `.focus()` on whichever row carries the keyboard
  // cursor. Without registration the lookup returns undefined and the
  // `:focus-visible` outline never appears on folders.
  registerRef?: (path: string, el: HTMLButtonElement | null) => void;
  // PRD #343 / ADR 0031 / issue #346: roving tabindex flag. The row
  // with isTabStop=true carries `tabindex=0`; every other row carries
  // `tabindex=-1`. Exactly one row in the sidebar tree should hold
  // the tab stop at any moment.
  isTabStop?: boolean;
}

// React.memo so cursor / comment-nav state changes in App don't re-render
// every sidebar row. Without this, the plain function rendered ~800 times per
// comment click despite none of its props meaningfully changing.
// Exported so unit tests can mount the row in isolation.
export const FolderRow = React.memo(function FolderRow({
  row,
  onToggle,
  onActivate,
  registerRef,
  isTabStop,
}: FolderRowProps): React.JSX.Element {
  const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
  const handleClick = useCallback(() => {
    if (onActivate) onActivate(row.path, "folder");
    else onToggle(row.path);
  }, [onActivate, onToggle, row.path]);
  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => registerRef?.(row.path, el),
    [registerRef, row.path],
  );
  return (
    <button
      ref={handleRef}
      type="button"
      className="folder-entry"
      style={{ paddingLeft: 16 + row.depth * 16 }}
      title={row.path}
      onClick={handleClick}
      role="treeitem"
      aria-expanded={!row.collapsed}
      aria-label={row.displayName}
      tabIndex={isTabStop ? 0 : -1}
    >
      <Chevron className="tree-icon" />
      <FileDirectoryFillIcon className="tree-icon" />
      <span className="folder-name">{row.displayName}</span>
    </button>
  );
});

interface FileRowProps {
  row: Extract<VisibleRow<BundleFile>, { kind: "file" }>;
  selected: boolean;
  // Path-keyed callbacks so a single stable function reference can serve every
  // row; the path is closed over here in a `useCallback` instead of via fresh
  // arrows at the App-render site, which lets `React.memo` actually short-circuit.
  onSelect: (name: string) => void;
  registerRef: (path: string, el: HTMLButtonElement | null) => void;
  // PRD #343 / ADR 0031 / issue #346: paneFocus dispatch on click.
  // When onActivate is provided, clicks route through it (mouse path
  // converges with the keyboard path on the same paneFocus.setSidebar
  // + select-file outcome). Without onActivate the click falls back
  // to plain onSelect for backwards-compat with the snapshot-lost
  // branch's older signature.
  onActivate?: (path: string, kind: "file") => void;
  isTabStop?: boolean;
}

export const FileRow = React.memo(function FileRow({
  row,
  selected,
  onSelect,
  registerRef,
  onActivate,
  isTabStop,
}: FileRowProps): React.JSX.Element {
  const { Icon, statusClass } = fileIcon(row.file.type);
  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => registerRef(row.path, el),
    [registerRef, row.path],
  );
  const handleClick = useCallback(() => {
    if (onActivate) onActivate(row.path, "file");
    else onSelect(row.path);
  }, [onActivate, onSelect, row.path]);
  return (
    <button
      ref={handleRef}
      type="button"
      className={`file-entry${selected ? " selected" : ""}`}
      style={{ paddingLeft: 16 + row.depth * 16 }}
      title={row.path}
      onClick={handleClick}
      role="treeitem"
      aria-selected={selected}
      aria-label={row.displayName}
      tabIndex={isTabStop ? 0 : -1}
    >
      <Icon className={`status-icon ${statusClass}`} />
      <span className="file-name">{row.displayName}</span>
      {row.commentCount > 0 ? <span className="badge">{row.commentCount}</span> : null}
    </button>
  );
});

interface CommentCardProps {
  comment: Comment;
  replies?: Comment[];
  isCurrent: boolean;
  // 1-based position in the top-level nav order. null when the comment
  // isn't in topLevel (defensive — shouldn't happen since CommentCard
  // only ever renders top-level comments). Header omits the counter
  // when null or when navTotal is 0.
  navIndex: number | null;
  navTotal: number;
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  composerBody?: string;
  composerError?: string | null;
  onComposerBodyChange?: (body: string) => void;
  // The comment id (top-level or inline Reply) currently targeted by
  // the reply composer; null/undefined → composer not open in this card.
  // When set, the composer renders below the matching comment's
  // action row — top-level beneath the replies list, inline Reply
  // beneath the Reply itself.
  replyTargetId?: string | null;
  // Callbacks now take the comment id so inline-Reply rows can address
  // themselves (issue #189, PRD #181 story 11). Top-level callers pass
  // the function directly; the action row computes the right id at
  // click time.
  onOpenReply?: (commentId: string) => void;
  onSubmitReply?: () => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  // Reply-agent name from `--reply-agent <name>` (issue #184, PRD #181;
  // relabelled in issue #390 — the button now reads "Request reply",
  // tooltip names the agent and clarifies the separate-session fact).
  // Null/undefined → the "Request reply" affordance is hidden.
  replyAgent?: string | null;
  onSendToAgent?: (commentId: string) => void;
  // Cursor-landing callback (PRD #192 / ADR 0022 slice 2). Fires when the
  // user clicks anywhere on the card so the cursor follows the click — a
  // subsequent keyboard `r` / `R` then targets the same card. Receives the
  // top-level comment id (the cursor stop), not any clicked Reply id.
  onCardClick?: (commentId: string) => void;
  // Issue #383 / ADR 0035: clicking the filename in the header is a
  // distinct affordance — moves the cursor onto the card AND opens the
  // file at line_end in the configured editor. Receives the top-level
  // comment id (so the click can seed the cursor) plus the file + line
  // so App can dispatch open-in-editor without recovering them. Optional
  // — when unset the filename renders as inert text (legacy behaviour).
  onFileClick?: (commentId: string, file: string, lineEnd: number) => void;
  // Issue #389 / ADR 0036 (Slice E): trash icon callback. Fired when
  // the user clicks the per-node 🗑 button on either the parent
  // header or any inline Reply. Receives the targeted comment id —
  // never the top-level's id when the click was on a Reply. The host
  // (App.tsx) opens the delete-confirm modal in response. Optional
  // so call sites that haven't wired the modal (snapshot-lost branch,
  // unit-test mounts) keep their existing behaviour.
  onDeleteClick?: (commentId: string) => void;
}

// Owns its own 1Hz tick so the wall-clock advances only here. The previous
// design lifted `now` to App and threaded it through every FileBlock /
// CommentCard, which meant the whole tree re-rendered each second whenever
// a reply was in-flight. With the tick local, only the pill itself re-renders.
function ReplyPill({ lock }: { lock: ReplyLock }): React.JSX.Element {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);
  const seconds = Math.floor(ageMs(lock, now) / 1000);
  // Issue #390 / ADR 0021 addendum: pill copy names the worker role
  // ("Reply agent (<name>) is replying…") so the visible cue matches
  // the header chip's framing — the user can tell at a glance that the
  // in-flight worker is the separate-session peer, not their current
  // Claude session.
  if (isStale(lock, now)) {
    return (
      <div className="reply-pill stale" role="status">
        <span className="reply-pill-icon" aria-hidden="true">⚠️</span>
        <span>
          Reply agent (<strong>{lock.agent}</strong>) is taking unusually long…
        </span>
      </div>
    );
  }
  return (
    <div className="reply-pill" role="status">
      <span className="reply-pill-icon" aria-hidden="true">✏️</span>
      <span>
        Reply agent (<strong>{lock.agent}</strong>) is replying… ({seconds}s)
      </span>
    </div>
  );
}

function pillTargetsThisCard(
  commentId: string,
  replies: Comment[] | undefined,
  lock: ReplyLock,
): boolean {
  if (lock.responding_to === commentId) return true;
  if (!replies) return false;
  return replies.some((r) => r.id === lock.responding_to);
}

export function CommentCard({
  comment,
  replies,
  isCurrent,
  navIndex,
  navTotal,
  registerRef,
  composerBody = "",
  composerError,
  onComposerBodyChange,
  replyTargetId,
  onOpenReply,
  onSubmitReply,
  onCancelReply,
  replyLock,
  replyAgent,
  onSendToAgent,
  onCardClick,
  onFileClick,
  onDeleteClick,
}: CommentCardProps): React.JSX.Element {
  const isDeletedStub = !!comment.deleted;
  const range =
    comment.line_start === comment.line_end
      ? `${comment.line_start}`
      : `${comment.line_start}-${comment.line_end}`;
  const showPill =
    !!replyLock && pillTargetsThisCard(comment.id, replies, replyLock);
  const lockHeld = replyLock != null;
  // Issue #390 / ADR 0021 addendum: the lock-held tooltip names the
  // worker role ("Reply agent (<name>) is replying — wait") so the
  // visible copy matches the header chip's framing.
  const lockedTooltip = replyLock
    ? `Reply agent (${replyLock.agent}) is replying — wait`
    : undefined;
  // A Thread carries exactly one action row at the bottom (issue #191).
  // The Reply button targets the latest Comment in the Thread so a
  // new Reply continues from where the conversation is, not from where
  // it started. The Send button targets the latest human leaf per the
  // unchanged rule from #190 — null when the latest turn is agent
  // (the user must write a human Reply first).
  const descendants = replies ?? [];
  const replyTargetForOpen = latestCommentId(comment, descendants);
  const sendLeafId = latestHumanLeafId(comment, descendants);
  // The latest leaf is by construction a leaf (hasReply: false); when
  // sendLeafId is non-null it's also human. So the per-Comment
  // predicate inputs collapse to a fixed shape that depends only on
  // the agent-configured + lock-held axes.
  const sendVerdict: CanSendToAgentResult =
    sendLeafId !== null
      ? canSendToAgent({
          replyAgentConfigured: !!replyAgent,
          lockHeld,
          authorKind: "human",
          hasReply: false,
        })
      : { visible: false, enabled: false };
  // Issue #390 / ADR 0021 addendum: the button label is "Request reply"
  // (no agent name); the tooltip carries the per-state context — agent
  // name + "separate session" clarifier in the enabled case, or the
  // lock-held wait message when a reply is in flight.
  const sendTooltip =
    sendVerdict.reason === "lock-held"
      ? lockedTooltip
      : replyAgent
        ? `Request a reply from ${replyAgent} — runs in a separate session, does not message your current chat`
        : undefined;
  const composerOpen = replyTargetId != null;
  const showReplyButton = !!onOpenReply;
  const showSendButton = sendVerdict.visible && !!onSendToAgent && !!sendLeafId;
  const blockClass = [
    "comment-block",
    isCurrent ? "current" : "",
    isDeletedStub ? "deleted-stub" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={blockClass}
      ref={(el) => registerRef?.(comment.id, el)}
      data-comment-id={comment.id}
      onClick={() => onCardClick?.(comment.id)}
    >
      <div className="ann-header">
        {isCurrent ? (
          <span className="selection-marker" aria-hidden="true">●{" "}</span>
        ) : null}
        {navIndex !== null && navTotal > 0 ? (
          <span className="nav-index">{navIndex} / {navTotal}{" "}</span>
        ) : null}
        <span className={`author-kind ${comment.author_kind}`}>
          [{comment.author_kind}]
        </span>{" "}
        {comment.author !== comment.author_kind ? (
          <>{comment.author} · </>
        ) : null}
        {onFileClick ? (
          // Issue #383 / ADR 0035: location-stamp linkification. Hover-
          // underlined button (no link-blue) so the affordance stays
          // visually restrained but the click contract is announced via
          // role=button + aria-label. stopPropagation prevents the
          // surrounding `.comment-block onClick` (cursor-on-card) from
          // double-firing — onFileClick already moves the cursor first
          // before dispatching the open.
          <button
            type="button"
            className="ann-filename-link"
            aria-label={`Open ${comment.file}:${range} in editor`}
            onClick={(event) => {
              event.stopPropagation();
              onFileClick(comment.id, comment.file, comment.line_end);
            }}
          >
            {comment.file}:{range}
          </button>
        ) : (
          <>{comment.file}:{range}</>
        )}
        {onDeleteClick && !isDeletedStub ? (
          <button
            type="button"
            className="ann-trash-button"
            aria-label="Delete comment"
            title="Delete comment"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteClick(comment.id);
            }}
          >
            🗑
          </button>
        ) : null}
      </div>
      <div className="ann-body">
        {isDeletedStub ? (
          <span aria-label="Deleted comment placeholder">[deleted]</span>
        ) : (
          <CommentMarkdown body={comment.body} />
        )}
      </div>
      {replies && replies.length > 0 ? (
        <div className="ann-replies">
          {replies.map((r) => (
            <div
              className="ann-reply"
              key={r.id}
              ref={(el) => registerRef?.(r.id, el)}
              id={`comment-${r.id}`}
            >
              <div className="ann-header">
                <span className={`author-kind ${r.author_kind}`}>
                  [{r.author_kind}]
                </span>
                {r.author !== r.author_kind ? <> {r.author}</> : null}
                {r.author_kind === "agent" && r.replies_to ? (
                  <span
                    className="reply-agent-byline"
                    title="This reply was produced by the configured reply-agent in a separate session."
                  >
                    {" "}· reply-agent
                  </span>
                ) : null}
                {onDeleteClick ? (
                  <button
                    type="button"
                    className="ann-trash-button"
                    aria-label="Delete reply"
                    title="Delete reply"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteClick(r.id);
                    }}
                  >
                    🗑
                  </button>
                ) : null}
              </div>
              <div className="ann-body">
                <CommentMarkdown body={r.body} />
              </div>
              {replyTargetId === r.id ? (
                <div className="ann-reply-composer">
                  <Composer
                    placeholder="Reply…"
                    submitLabel="Reply"
                    body={composerBody}
                    error={composerError ?? null}
                    onBodyChange={(b) => onComposerBodyChange?.(b)}
                    onSubmit={() => onSubmitReply?.()}
                    onCancel={() => onCancelReply?.()}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {showPill && replyLock ? <ReplyPill lock={replyLock} /> : null}
      {replyTargetId === comment.id ? (
        <div className="ann-reply-composer">
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            body={composerBody}
            error={composerError ?? null}
            onBodyChange={(b) => onComposerBodyChange?.(b)}
            onSubmit={() => onSubmitReply?.()}
            onCancel={() => onCancelReply?.()}
          />
        </div>
      ) : !composerOpen && (showReplyButton || showSendButton) ? (
        <div className="ann-actions">
          {showReplyButton && onOpenReply ? (
            <button
              type="button"
              className="reply-button"
              onClick={(e) => {
                e.stopPropagation();
                // Land the cursor on this card so a follow-up keyboard `r`
                // / `R` targets it (PRD #192 / ADR 0022 slice 2).
                onCardClick?.(comment.id);
                onOpenReply(replyTargetForOpen);
              }}
            >
              Reply
            </button>
          ) : null}
          {showSendButton && onSendToAgent && sendLeafId ? (
            <button
              type="button"
              className="send-to-agent-button"
              disabled={!sendVerdict.enabled}
              title={sendTooltip}
              onClick={(e) => {
                e.stopPropagation();
                onCardClick?.(comment.id);
                if (sendVerdict.enabled) onSendToAgent(sendLeafId);
              }}
            >
              Request reply
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  body: string;
  error: string | null;
  onBodyChange: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Controlled textarea reading `body` from the Tour-session store's
// composer slice (PRD #234 slice 3, issue #238). The local
// `useState<string>("")` is gone: every keystroke dispatches
// `composer.setBody` so the watcher-reload-doesn't-eat-the-draft
// invariant is a property of the reducer, not a React-reconciliation
// accident.
function Composer({
  placeholder,
  submitLabel,
  body,
  error,
  onBodyChange,
  onSubmit,
  onCancel,
}: ComposerProps): React.JSX.Element {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="composer"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={taRef}
        className="composer-textarea"
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={3}
      />
      {error ? <div className="composer-error">{error}</div> : null}
      <div className="composer-actions">
        <button
          type="button"
          className="composer-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="composer-submit"
          disabled={!canSubmit}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface CommentListSnapshotLostProps {
  nav: NavBase;
  cursor: Cursor | null;
  registerCommentRef: (id: string, el: HTMLDivElement | null) => void;
  composerTarget: ComposerTarget | null;
  composerBody: string;
  composerError: string | null;
  onComposerBodyChange: (body: string) => void;
  onOpenReply: (replies_to: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  replyLock: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent: (commentId: string) => void;
  onCardClick: (commentId: string) => void;
  // Issue #383 / ADR 0035: clicking the annotation filename moves the
  // cursor onto the card AND dispatches the file-open at line_end.
  onAnnotationFileClick?: (
    commentId: string,
    file: string,
    lineEnd: number,
  ) => void;
  // Issue #389 / ADR 0036 (Slice E): per-card 🗑 click. Targets the
  // clicked node id (parent or Reply) — used to open the confirm modal.
  onDeleteClick?: (commentId: string) => void;
}

// Renders comments when the bundle is `snapshot-lost`. Reads `view.nav`
// directly (issue #246 lifts NavBase to both branches), so the inline
// `topLevelComments` / `buildThreads` re-derivation is gone.
function CommentListSnapshotLost({
  nav,
  cursor,
  registerCommentRef,
  composerTarget,
  composerBody,
  composerError,
  onComposerBodyChange,
  onOpenReply,
  onSubmit,
  onCancel,
  replyLock,
  replyAgent,
  onSendToAgent,
  onCardClick,
  onAnnotationFileClick,
  onDeleteClick,
}: CommentListSnapshotLostProps): React.JSX.Element {
  const { topLevel, repliesByRoot, navIndexById, navTotal } = nav;
  if (topLevel.length === 0) return <div className="empty">No comments</div>;
  const cursorCardId =
    cursor && cursor.kind === "card" ? cursor.commentId : null;
  return (
    <>
      {topLevel.map((a) => {
        const replies = [...(repliesByRoot.get(a.id) ?? [])];
        const replyTargetId =
          composerTarget?.kind === "reply" &&
          (composerTarget.replies_to === a.id ||
            replies.some((r) => r.id === composerTarget.replies_to))
            ? composerTarget.replies_to
            : null;
        return (
          <CommentCard
            key={a.id}
            comment={a}
            replies={replies}
            isCurrent={a.id === cursorCardId}
            navIndex={navIndexById.get(a.id) ?? null}
            navTotal={navTotal}
            registerRef={registerCommentRef}
            replyTargetId={replyTargetId}
            composerBody={replyTargetId !== null ? composerBody : ""}
            composerError={replyTargetId !== null ? composerError : null}
            onComposerBodyChange={onComposerBodyChange}
            onOpenReply={onOpenReply}
            onSubmitReply={onSubmit}
            onCancelReply={onCancel}
            replyLock={replyLock}
            replyAgent={replyAgent}
            onSendToAgent={onSendToAgent}
            onCardClick={onCardClick}
            onFileClick={onAnnotationFileClick}
            onDeleteClick={onDeleteClick}
          />
        );
      })}
    </>
  );
}

interface SequencePillProps {
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function SequencePill({ idx, total, onPrev, onNext }: SequencePillProps): React.JSX.Element | null {
  if (total === 0) return null;
  // idx === -1 ⇔ cursor is on a row (or null) — both chevrons stay live so
  // a single keystroke from a row cursor advances onto the first/last card
  // (PRD #192 / ADR 0022 mirroring the TUI's `—/M` treatment).
  const offCard = idx === -1;
  const prevDisabled = !offCard && idx <= 0;
  const nextDisabled = !offCard && idx >= total - 1;
  return (
    <div className="sequence-pill" role="navigation" aria-label="Comment navigation">
      <button
        type="button"
        className="pill-chevron"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label="Previous comment"
      >
        ‹
      </button>
      <span className="pill-position">
        {offCard ? "—" : idx + 1} / {total}
      </span>
      <button
        type="button"
        className="pill-chevron"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label="Next comment"
      >
        ›
      </button>
    </div>
  );
}

