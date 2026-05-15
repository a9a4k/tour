// See src/tui/otui-worker-shim.ts — pre-bundles opentui's parser.worker.js
// (with its `web-tree-sitter` dep) and points opentui's startWorker at the
// embedded copy in the compiled binary. Without this the released binary
// can't boot the syntax-highlighter worker and TS/TSX/JS/MD diffs render
// unstyled.
import "./otui-worker-shim.js";

import { useEffect, useMemo, useRef, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Tour, Annotation } from "../core/types.js";
import type { FileDiffMetadata } from "../core/diff-model.js";
import { parseFileDiffMetadata } from "../core/diff-model.js";
import type { PlannedRow } from "../core/diff-rows.js";
import {
  planRows,
  hunkHeaderExpandPlan,
  fileExpandableGapCount,
  GAP_TWO_ROW_THRESHOLD,
} from "../core/diff-rows.js";
import { tourDiffStats, type DiffStats } from "../core/diff-stats.js";
import {
  emptyExpansion,
  getBoundary,
  seedFromOrphans,
  type OrphanWindow,
} from "../core/expansion-state.js";
import type { TourBundle, BundleFile } from "../core/tour-bundle.js";
import type { FileClassification } from "../core/file-classifier.js";
import { DiffRows } from "./DiffRows.js";
import { CURSOR_FG, CURSOR_GLYPH } from "./DiffLine.js";
import { FileHeader } from "./FileHeader.js";
import { collectFileCardOffsets, deriveActiveFile } from "./active-file.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  revealAndLocate,
  sortFilesForStream,
} from "../core/file-tree.js";
import { buildPickerRows, type PickerRow } from "../core/tour-list.js";
import {
  TourSessionStore,
  useTourSession,
  pickerHighlighted,
  isBundleResolved,
  initialTourSessionState,
  type TourSummary,
} from "../core/tour-session.js";
import {
  type StartTuiProps,
  type WriteAnnotationInput,
} from "../core/write-annotation-input.js";
import { theme } from "../core/theme.js";
import { dispatchKey } from "./keymap.js";
import { dispatchPickerKey } from "./picker-keymap.js";
import { TourPicker } from "./TourPicker.js";
import { TopHeaderTui } from "./TopHeader.js";
import { Composer } from "./Composer.js";
import {
  buildReplyComposer,
  buildTopLevelComposer,
} from "./composer-state.js";
import { useTourSessionView } from "../core/tour-session-view.js";
import {
  fileCardPlaceholder,
  fileClassification,
  fileEntryLabel,
} from "./file-entry-label.js";
import {
  folderRowLabel,
  fileRowSegments,
  folderRowFixedCost,
  fileRowFixedCost,
} from "./sidebar-row-label.js";
import {
  SIDEBAR_BORDER,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_RESIZE_STEP,
  clampSidebarWidthManual,
  computeAutoFitWidth,
} from "./sidebar-width.js";
import { sidebarCursorPaint } from "./sidebar-cursor-paint.js";
import { countDiffStats } from "../core/diff-stats.js";
import { TourSessionRuntime } from "../core/tour-session-runtime.js";
import { createTuiTourSessionAdapter } from "./tour-session-adapter.js";
import type { ReplyLock } from "../core/reply-lock.js";
import { canSendToAgent } from "../core/can-send-to-agent.js";
import type { FlatRow } from "../core/flat-rows.js";
import {
  cursorAfterExpand,
  initialCursor,
  moveCursor,
  nextCard,
  prevCard,
  preferredSideOf,
  setCursorSide,
  cursorFromAnnotation,
  cursorAtFirstFileRow,
  cursorOnInteractive,
  type Cursor,
  type ExpandOrphanKind,
} from "../core/cursor-state.js";
import {
  step as stepDiffPane,
  pageMove as pageMoveDiffPane,
  jump as jumpDiffPane,
} from "../core/diff-pane-motion.js";
import type { BoundaryRef, InteractiveSubKind } from "../core/diff-rows.js";
import {
  applyPreserveScreenY,
  captureScreenYSnapshot,
  computeCardViewportPosition,
  scrollChildIntoView,
  type ScreenYSnapshot,
} from "./scroll-into-view.js";
import {
  animatedScrollChildIntoView,
  animatedScrollTo,
} from "./smooth-scroll.js";
import { buildRowYResolver, cursorRowDomId } from "./row-y-resolver.js";
import { resizeReanchorTargetId } from "./resize-reanchor-target.js";
import { composeFooterHints, composeFooterPreview } from "./footer-hints.js";
import { yankToClipboard } from "./clipboard.js";

function initialPickerCursor(rows: PickerRow[], currentId: string): number {
  if (rows.length === 0) return 0;
  const idx = rows.findIndex((r) => r.id !== currentId);
  return idx === -1 ? 0 : idx;
}

// Stable empty defaults for the snapshot-lost branch — render branches gate
// the diff pane off in that case, so these are inert at the surface. Lifted
// to module scope so the surface's snapshot-lost projection doesn't churn
// the identity of these fallback values across renders.
const EMPTY_VISIBLE_ROWS = [] as const;
const EMPTY_FLAT_ROWS: ReadonlyArray<FlatRow> = [];
const EMPTY_PLANNED_ROWS: ReadonlyMap<string, ReadonlyArray<PlannedRow>> = new Map();
const EMPTY_ANNOTATION_COUNTS: Readonly<Record<string, number>> = {};
const EMPTY_CLASSIFICATIONS: Readonly<Record<string, FileClassification>> = {};
const EMPTY_TREE = compress(buildTree<BundleFile>([]));

// `WriteAnnotationInput` lives in `core/write-annotation-input.ts` — single
// source of truth shared with `src/cli/tui.ts` (the writer side). Pre-fix it
// was declared twice; the App's copy was missing `bundle` and the CLI's
// writer crashed when `input.bundle === undefined`. Issue #254.
export type { WriteAnnotationInput };

// AppProps is a permissive view onto `StartTuiProps`: the CLI hands every
// field, but tests / degraded callers may omit the optional ones. The
// non-optional `bundle` matches the CLI's contract.
type AppProps = Partial<StartTuiProps> & { bundle: TourBundle };

// Stitch BundleFile.orphanWindows (file-grouped, no `file` field) into the
// flat OrphanWindow[] shape `seedFromOrphans` consumes.
function flattenOrphanWindows(files: ReadonlyArray<BundleFile>): OrphanWindow[] {
  const out: OrphanWindow[] = [];
  for (const f of files) {
    for (const w of f.orphanWindows) {
      out.push({ file: f.name, ref: w.ref, fromStart: w.fromStart, fromEnd: w.fromEnd });
    }
  }
  return out;
}

function fileCardBody(
  fileName: string,
  collapsed: boolean,
  hasHunks: boolean,
  reason: string | undefined,
  rows: ReadonlyArray<PlannedRow>,
  layout: "split" | "unified",
  cursorCardId: string | null,
  cursor: Cursor | null,
  onCursorClick: (
    file: string,
    side: "additions" | "deletions",
    lineNumber: number,
  ) => void,
  onInteractiveClick: (
    file: string,
    subKind: InteractiveSubKind,
    boundaryRef: BoundaryRef,
  ) => void,
  onCardClick: (annotationId: string) => void,
  repliesCollapsed: boolean,
  replyLock: ReplyLock | null,
  now: number,
  navIndexById: ReadonlyMap<string, number>,
  navTotal: number,
  paneFocused: boolean,
) {
  const placeholder = fileCardPlaceholder(collapsed, hasHunks, reason);
  if (placeholder !== null) return <text fg={theme.fg.muted}>{placeholder}</text>;
  return (
    <DiffRows
      fileName={fileName}
      rows={rows}
      layout={layout}
      cursorCardId={cursorCardId}
      cursor={cursor}
      onCursorClick={onCursorClick}
      onInteractiveClick={onInteractiveClick}
      onCardClick={onCardClick}
      repliesCollapsed={repliesCollapsed}
      replyLock={replyLock}
      now={now}
      navIndexById={navIndexById}
      navTotal={navTotal}
      paneFocused={paneFocused}
    />
  );
}

// Sidebar width is now per-tour state (issue #312; cap formula
// retuned in issue #315). On every tour switch the auto-fit helper
// picks the minimum width that lets every visible row render without
// middle-truncation, clamped to `[SIDEBAR_MIN_WIDTH, max(MIN,
// terminalWidth - DIFF_PANE_MIN_WIDTH)]` (auto-fit reserves a
// defensible diff-pane minimum). `[`/`]` adjust the width by
// `SIDEBAR_RESIZE_STEP` against the wider manual range
// `[SIDEBAR_MIN_WIDTH, max(MIN, terminalWidth - SIDEBAR_MIN_WIDTH)]`,
// so the user can push past the auto-fit cap when the diff floor
// binds. The adjustment is session-local and resets on the next
// tour switch (auto-fit is the source of truth per-tour). Row labels
// still middle-truncate to whatever `sidebarWidth - SIDEBAR_BORDER`
// is at render time so long names never wrap (issue #156).

function App(props: AppProps) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  // Issue #302: true while an in-flight card scroll animation hasn't yet
  // settled. Suppresses the footer-hint off-screen suffix during the
  // window — the pixel probe reads `sb.scrollTop` and the imperative
  // tween that mutates it doesn't trigger a React re-render, so a probe
  // run mid-animation sees stale state and reports a visible card as
  // off-screen. The adapter flips it back to `false` after
  // `SMOOTH_SCROLL_DEFAULT_DURATION_MS + 50ms`; that state change forces
  // a re-render where the probe sees the settled scrollTop.
  const [scrollPending, setScrollPending] = useState(false);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [repliesCollapsed, setRepliesCollapsed] = useState(false);
  // Tour-session store (PRD #207 slice 1, issue #209; bundle / replyLock
  // moved to the store in issue #211). The store is the single source of
  // truth for bundle + replyLock + picker + tourList; the TUI dispatches
  // actions and realizes emitted intents in its own substrate. The store
  // is per-TUI-process — instantiated once on first render and stable
  // across re-renders.
  const [store] = useState<TourSessionStore>(
    () =>
      new TourSessionStore({
        ...initialTourSessionState(),
        currentTourId: props.bundle.tour.id,
        bundle: { kind: "ok", value: props.bundle },
        replyLock: { kind: "ok", value: props.replyLock ?? null },
        expansion: seedFromOrphans(
          emptyExpansion(),
          props.bundle.kind === "ok" ? flattenOrphanWindows(props.bundle.files) : [],
        ),
      }),
  );
  const sessionState = useTourSession(store);
  // Bundle / replyLock read from the store. During the in-flight window
  // of a tour switch (picker.commit → bundle.loading → tour.switched), the
  // store's bundle slice transiently goes to `loading`; we keep showing
  // the previous resolved bundle via a tiny render-time cache so the diff
  // pane doesn't flash blank between commit and load. `tour.switched`
  // overwrites the cache on the next render. Not a React state — just a
  // memo of the last `ok` value the store has yielded.
  const lastBundleRef = useRef<TourBundle>(props.bundle);
  const resolvedBundle = isBundleResolved(sessionState);
  if (resolvedBundle !== null) lastBundleRef.current = resolvedBundle;
  const bundle = lastBundleRef.current;
  const replyLock =
    sessionState.replyLock.kind === "ok" ? sessionState.replyLock.value : null;
  // Cursor + expansion + composer + folds + layout are authoritative in the
  // Tour-session store (issue #231 / PRD #229; issue #237 / PRD #234 added
  // composer + folds + layout). Reads route through `sessionState`; mutations
  // go via `store.dispatch(...)`. The CONTEXT-pinned Tour-switch reset cascade
  // is driven entirely by the reducer's `tour.switched` branch (cursor → null,
  // expansion → empty, composer → closed, folds → empty).
  const cursor = sessionState.cursor;
  const expansion = sessionState.expansion;
  const composer = sessionState.composer;
  const collapsedFolders = sessionState.collapsedFolders;
  const collapsedOverrides = sessionState.collapsedOverrides;
  const layout = sessionState.layout;
  // Tour-session view (PRD #242 / issue #244) — single source for the
  // rendered shape. Eight previously-duplicated `useMemo` derivations +
  // seven previously-inline cursor/nav predicates all flow from these
  // five namespaces. The `live*` projection prefix is gone.
  //
  // Issue #280: the TUI's hunk-header banner is a two-cell layout —
  // left cell hosts the primary expand affordance (`↑` / `↕` / inert
  // `…`), right cell hosts the `@@` text. The cursor walks the row
  // whenever `primaryExpand !== null`. `hunkHeaderCursorStop: false`
  // is vestigial but still threaded for caller-side clarity.
  //
  // Issue #297: per-file Expand-all moved out of the planner row stream
  // into the file-header chrome (see `FileHeader` below). No planner
  // option needed.
  const view = useTourSessionView(store, bundle, {
    hunkHeaderCursorStop: false,
  });
  // NavBase lives on both branches (issue #246); ok-only slices keep
  // their nullable destructure so hooks below preserve optional-chaining
  // fallbacks. Cursor / nav predicates ride on the view (PRD #242).
  const nav = view.nav;
  const bundleSlice = view.kind === "ok" ? view.bundle : null;
  const rowsSlice = view.kind === "ok" ? view.rows : null;
  const treeSlice = view.kind === "ok" ? view.tree : null;
  const cursorSlice = view.kind === "ok" ? view.cursor : null;
  const cursorCardId = cursorSlice?.cardId ?? null;
  const cursorCardAnnotation = cursorSlice?.cardAnnotation ?? null;
  const sendTargetVal = "sendTarget" in nav ? nav.sendTarget : null;
  // Maps a `Cursor | null` onto the store's `cursor.set` / `cursor.clear`
  // shape — the action union has no combined "set-or-clear" variant.
  // Callers that need a same-ref short-circuit (motion helpers, intent
  // listener) layer it on top.
  const dispatchAnchorOrClear = (next: Cursor | null) => {
    if (next === null) store.dispatch({ type: "cursor.clear" });
    else store.dispatch({ type: "cursor.set", anchor: next });
  };
  // Reveal a file's collapsed ancestors then return its post-reveal row
  // index. Per-path toggles are idempotent so a racing dispatch can only
  // fold-then-unfold, never lose a user-requested reveal.
  const revealAndLocateFile = (
    file: string,
    tree: Parameters<typeof revealAncestors>[0],
    snapshot: ReadonlySet<string>,
    counts: Readonly<Record<string, number>>,
  ): number | null => {
    const ancestors = revealAncestors(tree, file);
    for (const path of ancestors) {
      if (snapshot.has(path)) {
        store.dispatch({ type: "folds.toggleFolder", path });
      }
    }
    const located = revealAndLocate(tree, snapshot, counts, file);
    return located ? located.rowIdx : null;
  };
  // Footer status line that flashes after an `s` no-op so the user knows
  // why the keystroke didn't dispatch. Cleared by any subsequent key.
  const [footerStatus, setFooterStatus] = useState<string | null>(null);
  // Issue #326: tracks the pending `Copied <path>` footer-flash timer so
  // a fresh `y` press cancels the prior pending clear and the unmount
  // effect can stop it. Restoration is via a functional setter at the
  // case site so a newer status (set after our flash) survives.
  const yankFooterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => (): void => {
      if (yankFooterTimerRef.current !== null) {
        clearTimeout(yankFooterTimerRef.current);
      }
    },
    [],
  );
  const renderer = useRenderer();
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sidebarScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const pickerScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // First-paint-per-tour guard for the tour-open side effects: reveal the
  // first annotation's file in the sidebar tree, drop sidebar focus so
  // j/k routes to the diff pane (issue #132 revision), and materialise
  // the cursor on the first top-level annotation (issue #256 — reverts
  // ADR 0011's lazy-materialization rule for non-empty tours, restoring
  // surface parity with the webapp's ADR 0022 URL-anchored mount). The
  // ref is keyed on `bundle.tour.id` so `bundle.refreshed` does NOT
  // re-seed — user motion taken before a watcher reload survives.
  const seededTourIdRef = useRef<string | null>(null);

  // Sidebar width (issue #312). Per-tour auto-fit + `[`/`]` resize.
  // `lastFittedTourIdRef` mirrors `seededTourIdRef`'s once-per-tour
  // guard: auto-fit runs on every tour switch but NOT on
  // `bundle.refreshed` of the same tour (a mid-session refit would be
  // jarring). The fit effect lives below the row-derivation pipeline
  // so `visibleRows` is in scope.
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_WIDTH);
  const lastFittedTourIdRef = useRef<string | null>(null);

  // Issue #303 preserve-cursor-on-layout-toggle: pre-toggle snapshot of the
  // cursor row's position. Populated synchronously inside the toggle-layout
  // case below, BEFORE `layout.set` dispatches; consumed by the layout-
  // change useEffect after OpenTUI has laid out the new layout. The id is
  // the layout-invariant FlatRow id (so a paired-context cursor on either
  // side resolves to the same node in both split and unified).
  const layoutToggleSnapshotRef = useRef<{
    rowId: string;
    snap: ScreenYSnapshot;
  } | null>(null);

  // Issue #318 (upgraded): pre-resize snapshot of the re-anchor target's
  // on-screen y. Stashed synchronously in the `[`/`]` keypress handler
  // BEFORE `setSidebarWidth` so the capture reads the old layout; consumed
  // by the resize-apply useEffect after OpenTUI has laid out the new pane
  // width. Same pattern as `layoutToggleSnapshotRef` (#303) — the only
  // difference is the trigger (sidebar width, not layout mode).
  const resizeSnapshotRef = useRef<{
    rowId: string;
    snap: ScreenYSnapshot;
  } | null>(null);

  // `bundle.tour` / `bundle.annotations` are present in both bundle
  // kinds; the view's ok-branch namespaces gate the rest.
  const annotations: ReadonlyArray<Annotation> = bundle.annotations;

  // Wall clock used by the in-flight pill to render "(Ns)". Ticks once per
  // second only when a lock is present so we don't burn renders on the idle
  // path.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!replyLock) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [replyLock]);

  // Tour-session runtime (PRD #278 slices 2-6). Subscribes to the watcher
  // via the adapter and dispatches `bundle.refreshed` / `replyLock.loaded`
  // on tour events; realises every intent the reducer emits (loadTour,
  // submitAnnotation, scroll / mirror / reveal). The runtime re-subscribes
  // itself when `currentTourId` changes (tour-switch), so this effect
  // runs once at mount and tears down at unmount.
  useEffect(() => {
    if (!props.cwd || !props.loadTour || !props.loadReplyLock || !props.writeAnnotation) {
      return;
    }
    const adapter = createTuiTourSessionAdapter({
      cwd: props.cwd,
      store,
      loadTour: props.loadTour,
      loadReplyLock: props.loadReplyLock,
      writeAnnotation: props.writeAnnotation,
      diffScrollBoxRef: diffScrollRef,
      pickerScrollBoxRef: pickerScrollRef,
      setSelectedRowIdx,
      setScrollPending,
      replyAgent: props.replyAgent,
    });
    // `viewOptions` matches the TUI's `useTourSessionView` call so the
    // runtime's `revalidateCursor` handler (PRD #278 slice 5) validates
    // the cursor against the same flat-rows the surface renders.
    const runtime = new TourSessionRuntime(store, adapter, {
      hunkHeaderCursorStop: false,
    });
    return runtime.start();
  }, [store, props.cwd, props.loadTour, props.loadReplyLock, props.writeAnnotation, props.replyAgent]);

  // Sorted file list for diff-pane render order. `view.rows.plannedRowsByFile`
  // is keyed by name; we still need the ordered file list for the JSX.
  const files = useMemo(
    () => sortFilesForStream(bundleSlice?.files ?? ([] as ReadonlyArray<BundleFile>)),
    [bundleSlice],
  );

  // Issue #307: the active-file header above the diff scrollbox names the
  // file the viewport is currently inside, derived from scroll position
  // (NOT cursor / NOT sidebar selection). OpenTUI has no `position:
  // sticky` primitive so we synthesise it: poll `sb.scrollTop` + the per-
  // file-card content-y offsets, run them through the pure
  // `deriveActiveFile`, and re-render when the answer changes.
  //
  // 50ms poll covers the cases that don't already re-render React on
  // their own: free mouse-wheel scroll and in-flight smooth-scroll
  // tweens (smooth-scroll mutates `sb.scrollTop` per OpenTUI frame
  // without dispatching). Keyboard-driven motion (j/k, d/u, n/p, layout
  // toggle) already triggers a React render, but the same effect tick
  // covers that too — `setActiveFile` short-circuits when the derived
  // name is unchanged so the interval is cheap.
  const fileNames = useMemo(() => files.map((f) => f.name), [files]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  useEffect(() => {
    if (fileNames.length === 0) {
      setActiveFile(null);
      return;
    }
    const tick = () => {
      const sb = diffScrollRef.current;
      if (!sb) return;
      const offsets = collectFileCardOffsets(sb, fileNames);
      const next = deriveActiveFile(sb.scrollTop, offsets);
      setActiveFile((cur) => (cur === next ? cur : next));
    };
    tick();
    const handle = setInterval(tick, 50);
    return (): void => clearInterval(handle);
  }, [fileNames]);

  const tree = treeSlice?.root ?? EMPTY_TREE;
  const annotationCounts = treeSlice?.annotationCounts ?? EMPTY_ANNOTATION_COUNTS;
  const visibleRows = treeSlice?.visibleRows ?? EMPTY_VISIBLE_ROWS;
  const safeRowIdx = visibleRows.length === 0
    ? 0
    : Math.min(Math.max(0, selectedRowIdx), visibleRows.length - 1);
  const selectedRow = visibleRows[safeRowIdx];

  // Hunk-header metadata for the expansion gap calculations — not exposed
  // by the view; parsed locally so the expansion handlers stay self-contained.
  const fileMetadata = useMemo(() => {
    const out = new Map<string, FileDiffMetadata>();
    if (bundle.kind === "ok") {
      for (const meta of parseFileDiffMetadata(bundle.diff)) out.set(meta.name, meta);
    }
    return out;
  }, [bundle]);

  // Tour-level diff stats (issue #266 / webapp parity #233). Walk every
  // file in the bundle through `planRows` with empty annotations / empty
  // expansion / classifierCollapsed=false so the count reflects the FULL
  // diff regardless of the current layout, expansion, classifier-collapse
  // state, or annotation set. Layout pinned to "split" so paired changes
  // count as one `change` row each (countDiffStats yields the same totals
  // either way, but the canonical pin matches the webapp).
  // Memoized on `bundle` — cursor moves, layout toggles, expansion changes,
  // and annotation navigation do NOT re-walk.
  const tourStats = useMemo<DiffStats>(() => {
    if (bundle.kind !== "ok") return { additions: 0, deletions: 0 };
    const bfByName = new Map<string, BundleFile>();
    for (const bf of bundle.files) bfByName.set(bf.name, bf);
    const filesForStats: { rows: PlannedRow[] }[] = [];
    for (const meta of fileMetadata.values()) {
      const bf = bfByName.get(meta.name);
      filesForStats.push({
        rows: planRows(meta, [], "split", {
          oldContent: bf?.oldContent,
          newContent: bf?.newContent,
          expansion: emptyExpansion(),
          classifierCollapsed: false,
        }),
      });
    }
    return tourDiffStats(filesForStats);
  }, [bundle, fileMetadata]);

  const flatRowsList = rowsSlice?.flatRowsList ?? EMPTY_FLAT_ROWS;
  const plannedRowsByFile = rowsSlice?.plannedRowsByFile ?? EMPTY_PLANNED_ROWS;
  const classifications = bundleSlice?.classifications ?? EMPTY_CLASSIFICATIONS;

  // Body-level visibility. Binary files are collapsed by default; the
  // per-file override slot lets the annotation-jump path force a file
  // open. The view's planner uses the same rule internally for its
  // classifierCollapsed flag; this surface-side mirror gates body
  // render of binary files and honours per-file overrides.
  const isFileCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides[fileName];
    if (override !== undefined) return override;
    const cls = fileClassification(classifications, fileName);
    return cls.reason === "binary";
  };

  // Tour-open per-tour side effects (PRD #192 / ADR 0022; cursor seed
  // restored by issue #256): on a non-empty tour drop sidebar focus
  // (issue #132 revision), reveal the first annotation's file in the
  // tree, and materialise the cursor on `topLevel[0]` as a CardAnchor so
  // the user lands on the first annotation card with the same surface
  // contract the webapp gets from ADR 0022's URL-anchored mount. The
  // cursor-follow useEffect handles the viewport scroll once the cursor
  // slice changes — no parallel scroll plumbing.
  //
  // Empty tours keep the lazy-materialization rule (no annotation to
  // seed on; cursor stays null and the sidebar tree is the home anchor).
  // Snapshot-lost bundles fall through `initialCursor`'s null branch
  // (empty flatRowsList), so the cursor also stays null on the no-rows
  // path. Same-tour `bundle.refreshed` is suppressed by `seededTourIdRef`
  // so a watcher reload doesn't re-seed over user motion; the reducer's
  // `cursor.materialize` is a strict no-op on a non-null cursor as a
  // belt-and-suspenders fallback.
  const topLevel = nav.topLevel;
  useEffect(() => {
    if (seededTourIdRef.current !== bundle.tour.id) {
      seededTourIdRef.current = bundle.tour.id;
      if (topLevel.length === 0) return;
      const first = topLevel[0];
      setSidebarFocused(false);
      const seed = initialCursor({
        topLevelAnnotations: topLevel,
        flatRows: flatRowsList,
      });
      if (seed) store.dispatch({ type: "cursor.materialize", anchor: seed });
      const rowIdx = revealAndLocateFile(first.file, tree, collapsedFolders, annotationCounts);
      if (rowIdx === null) return;
      setSelectedRowIdx(rowIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevel, bundle.tour.id]);

  // Reconcile the raw cursor with the view's validated anchor. The view
  // prunes a CardAnchor whose annotation was deleted and snaps a RowAnchor
  // whose specific row vanished (issue #231 / PRD #229 + #232 rules).
  useEffect(() => {
    if (cursor === null) return;
    if (cursorSlice && cursorSlice.anchor !== cursor) {
      dispatchAnchorOrClear(cursorSlice.anchor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorSlice]);

  // Layout-toggle re-scroll. Issue #296 migrated cursor-driven scrolling
  // to the reducer's `scrollCursorTarget` intent path (anchor-kind-
  // agnostic: `placement` discriminates `nearest` vs `center`), so the
  // surface no longer owns a `[cursor, layout]` effect. `layout.set`
  // doesn't emit `scrollCursorTarget` (out of scope per the issue), so
  // this layout-only effect re-fires the same scroll helpers the
  // adapter would call on a `nearest` intent — preserves the
  // "Shift-L re-scrolls cursor into view" rule (CONTEXT.md TUI Cursor).
  //
  // Issue #250: defer the scroll call to the next macrotask via
  // `setTimeout(0)`. React's commit runs synchronously, but OpenTUI's
  // Yoga relayout for the newly-rendered rows runs on a later render
  // tick. Reading positions inside this effect synchronously sees a
  // stale layout (most visible when Shift-L flips layout while the
  // cursor is on a card: position math against the previous layout's
  // content frame parks the viewport on a strip where only annotation
  // cards live, hiding every diff row). `setTimeout(0)` is what
  // reliably lands the callback after OpenTUI's render tick — verified
  // empirically. `requestAnimationFrame` does NOT work here: in
  // bun/node it shims to `setImmediate` (or similar) and fires BEFORE
  // OpenTUI's render tick, which keeps the bug. Do not "improve" this
  // back to rAF.
  useEffect(() => {
    if (!diffScrollRef.current || !cursor) return;
    const sb = diffScrollRef.current;
    // Issue #303: when the user toggled layout via `shift+L`, the keymap
    // handler stashed a pre-toggle snapshot. Apply it once OpenTUI has
    // laid out the new layout (setTimeout(0) defers past the render
    // tick) so the cursor row lands at the same on-screen y. Falls back
    // to the historic `scrollChildIntoView` when no snapshot is present
    // (initial mount, programmatic layout change, no cursor at toggle
    // time) — both paths are culling-safe via `refreshLayoutChain`.
    const pending = layoutToggleSnapshotRef.current;
    layoutToggleSnapshotRef.current = null;
    const handle = setTimeout(() => {
      if (pending) {
        const applied = applyPreserveScreenY(sb, pending.rowId, pending.snap);
        if (applied) return;
        // Row not found in the new layout — fall through to the default
        // scroll-into-view fallback so the cursor at least lands visible.
      }
      // `scrollChildIntoView` is culling-safe under `viewportCulling=true`;
      // it refreshes the layout chain before reading positions, so a
      // cross-file scroll lands on the right file instead of a stale one.
      const targetId =
        cursor.kind === "card"
          ? `annotation-${cursor.annotationId}`
          : `diff-row-${cursor.file}-${cursor.side}-${cursor.lineNumber}`;
      animatedScrollChildIntoView(sb, targetId);
    }, 0);
    return (): void => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Issue #318 (upgraded): after `[`/`]` resize, OpenTUI re-flows
  // annotation cards to the new pane width. The keypress handler
  // captured the target row's on-screen y before triggering the
  // re-render; this effect applies it via `preserveScreenY` once Yoga
  // has measured the new card heights. `setTimeout(0)` defers past the
  // render tick for the same reason as the layout-toggle effect above
  // (rAF on bun fires before OpenTUI's render tick). Falls through to
  // `scrollChildIntoView` when the target id isn't resolvable in the
  // post-resize tree (degenerate; shouldn't happen for resize since
  // row identity is layout-invariant — kept as defensive parity with
  // the layout-toggle path).
  useEffect(() => {
    const sb = diffScrollRef.current;
    if (!sb) return;
    const pending = resizeSnapshotRef.current;
    resizeSnapshotRef.current = null;
    if (!pending) return;
    const handle = setTimeout(() => {
      const applied = applyPreserveScreenY(sb, pending.rowId, pending.snap);
      if (!applied) scrollChildIntoView(sb, pending.rowId);
    }, 0);
    return (): void => clearTimeout(handle);
  }, [sidebarWidth]);

  // Sidebar follows the cursor's file. RowAnchor → cursor.file directly;
  // CardAnchor → view.cursor.cardAnnotation.file. Deps key off the
  // resolved file so in-file j/k motion leaves the sidebar untouched.
  const cursorFile: string | null =
    cursor === null ? null
    : cursor.kind === "row" ? cursor.file
    : cursorCardAnnotation?.file ?? null;
  useEffect(() => {
    if (!cursorFile) return;
    const rowIdx = revealAndLocateFile(cursorFile, tree, collapsedFolders, annotationCounts);
    if (rowIdx !== null && rowIdx !== safeRowIdx) {
      setSelectedRowIdx(rowIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorFile]);

  // Keep the selected sidebar row visible: whenever the row index or the row
  // list changes, ask the scrollbox to scroll the row into view (block:nearest
  // semantics — already-visible rows don't move).
  useEffect(() => {
    const row = visibleRows[safeRowIdx];
    if (!row || !sidebarScrollRef.current) return;
    sidebarScrollRef.current.scrollChildIntoView(`row-${row.path}`);
  }, [safeRowIdx, visibleRows]);

  // Sidebar auto-fit (issue #312). On every tour-id change (NOT on
  // `bundle.refreshed` of the same tour), recompute the minimum width
  // that fits the deepest visible row. Gated on `visibleRows.length`
  // so the first paint — where the row pipeline is still empty —
  // doesn't lock in the default width; the next render with
  // populated rows triggers the fit. The manual `[`/`]` override is
  // session-local: the next tour switch re-runs auto-fit and the
  // override doesn't carry over.
  useEffect(() => {
    if (lastFittedTourIdRef.current === bundle.tour.id) return;
    if (visibleRows.length === 0) return;
    lastFittedTourIdRef.current = bundle.tour.id;
    const fitted = computeAutoFitWidth(
      visibleRows,
      (path) => countDiffStats(plannedRowsByFile.get(path) ?? []),
      renderer.terminalWidth,
    );
    setSidebarWidth(fitted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.tour.id, visibleRows]);

  const sidebarContentWidth = sidebarWidth - SIDEBAR_BORDER;

  const sendHintVerdict =
    sendTargetVal !== null
      ? canSendToAgent({
          replyAgentConfigured: !!props.replyAgent,
          lockHeld: replyLock !== null,
          authorKind: "human",
          hasReply: false,
        })
      : { visible: false, enabled: false };
  const footerHints = composeFooterHints({
    replyAgent: props.replyAgent,
    showSendHint: sendHintVerdict.visible,
  });
  // Action-target preview line (PRD #192 / ADR 0022). Renders the
  // cursor's `r` target so the user knows what `r` will do before
  // pressing it. The off-screen suffix is driven by a pixel-position
  // probe (issue #302) — ask the diff scrollbox for the rendered
  // card's box and intersect it with the viewport rect.
  //
  // While `scrollPending` is true, an in-flight scroll-into-view
  // animation hasn't yet settled and `sb.scrollTop` is mid-flight —
  // probing here would read pre-scroll state and mis-report the card
  // as off-screen. Omit the suffix during the window; the adapter
  // flips `scrollPending` back to `false` after the smooth-scroll
  // duration + buffer, forcing a re-render where the probe sees the
  // settled scrollTop. Free-scrolling (page motion, mouse wheel)
  // doesn't go through the auto-scroll path, so `scrollPending` stays
  // `false` and the probe accurately reports above / below.
  const cardViewportPosition: "in" | "above" | "below" | undefined = (() => {
    if (!cursor || cursor.kind !== "card") return undefined;
    if (scrollPending) return undefined;
    const sb = diffScrollRef.current;
    if (!sb) return undefined;
    const probed = computeCardViewportPosition(sb, `annotation-${cursor.annotationId}`);
    return probed ?? undefined;
  })();
  const footerPreview = composeFooterPreview({
    cursor,
    annotations,
    cardViewportPosition,
  });
  const baseFooter = `${footerPreview}  ·  ${footerHints}`;
  // When a transient status is set, lead with it so it's visible even
  // on narrow terminals (TUICommander panes etc). Prior order appended
  // the status after the long persistent hints, which pushed it past
  // the visible width on anything narrower than ~200 cols.
  const footer = footerStatus ? `${footerStatus}  ·  ${baseFooter}` : baseFooter;

  // Open the Tour picker (PRD #207 / issue #209). Routes through the
  // Tour-session store: `tourList.loading` → fetch → `tourList.loaded`
  // (or `tourList.failed`) → `picker.open` with the built rows.
  // The initial picker cursor lands on the first non-current tour
  // (mirrors the prior UX); we walk there via `picker.move(+1)` since
  // the reducer's `picker.open` always opens at cursor 0.
  const openPicker = async () => {
    if (store.getState().picker.kind === "open") return;
    if (!props.loadTours) {
      store.dispatch({ type: "picker.open", rows: [] });
      return;
    }
    store.dispatch({ type: "tourList.loading" });
    try {
      const { tours, annotationCounts: counts } = await props.loadTours();
      const summaries: TourSummary[] = tours.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        created_at: t.created_at,
      }));
      store.dispatch({ type: "tourList.loaded", tours: summaries });
      const rows = buildPickerRows({ tours, annotationCounts: counts, now: Date.now() });
      store.dispatch({ type: "picker.open", rows });
      const initialIdx = initialPickerCursor(rows, bundle.tour.id);
      for (let i = 0; i < initialIdx; i++) {
        store.dispatch({ type: "picker.move", delta: 1 });
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      store.dispatch({ type: "tourList.failed", error });
      store.dispatch({ type: "picker.open", rows: [] });
    }
  };


  // Tour-switch reset for sidebar row index. The reducer's `tour.switched`
  // branch owns every CONTEXT-pinned reset (picker / replyLock / cursor /
  // expansion / composer / folds); sidebar selection is surface-specific
  // (out of scope for the store per PRD #234) so the reset rides on a
  // currentTourId-keyed useEffect — mirrors the web's `setSelectedFile`
  // reset pattern. PRD #278 slice 3.
  const currentTourId = sessionState.currentTourId;
  useEffect(() => {
    if (currentTourId === null) return;
    setSelectedRowIdx(0);
  }, [currentTourId]);

  const jumpToAnnotation = (ann: Annotation) => {
    // Issue #132: explicit annotation jumps (n/p) drop sidebar focus so
    // subsequent j/k move the diff cursor, not the file row.
    setSidebarFocused(false);
    const rowIdx = revealAndLocateFile(ann.file, tree, collapsedFolders, annotationCounts);
    if (rowIdx !== null && rowIdx !== safeRowIdx) {
      setSelectedRowIdx(rowIdx);
    }
    store.dispatch({ type: "folds.setOverride", file: ann.file, value: false });
    // PRD #192 / ADR 0022: n/p moves the unified cursor onto the
    // annotation's card directly — no synthesized row anchor. Thread
    // preferredSide so an `h`/`l` choice survives the jump (issue #200).
    store.dispatch({
      type: "cursor.set",
      anchor: cursorFromAnnotation(ann, preferredSideOf(cursor)),
    });
  };

  // gotoPrev/NextAnnotation walk via `nextCard` / `prevCard` (PRD #192).
  // n/p is the jump gesture: walks top-level Annotation order — the
  // same order the `[N/M]` pill counter reads — so `n` from `K/M` lands
  // on `K+1/M` (issue #197). From a RowAnchor or null cursor the walk
  // enters the track at the topLevel edge (cursor position not
  // consulted; issue #206 revert of #203).
  const gotoPrevAnnotation = () => {
    const target = prevCard(cursor, topLevel);
    if (target) {
      const ann = annotations.find((a) => a.id === target.annotationId);
      if (ann) jumpToAnnotation(ann);
    }
  };

  const gotoNextAnnotation = () => {
    const target = nextCard(cursor, topLevel);
    if (target) {
      const ann = annotations.find((a) => a.id === target.annotationId);
      if (ann) jumpToAnnotation(ann);
    }
  };

  // Mouse click on a diff row → set cursor + side per the click site (issue
  // #104). Side derivation lives in DiffRows.tsx (it's UI-coordinate-
  // dependent). Sets preferredSide to the clicked side so subsequent
  // keyboard motion preserves the user's mouse-expressed preference.
  // Also focuses the diff pane and syncs the sidebar selection so cross-
  // file consistency matches keyboard motion.
  const onCursorClick = (
    file: string,
    side: "additions" | "deletions",
    lineNumber: number,
  ) => {
    setSidebarFocused(false);
    store.dispatch({
      type: "cursor.set",
      anchor: { kind: "row", file, lineNumber, side, preferredSide: side },
    });
    // Sidebar selection flows through the reducer's `selectSidebarFile`
    // intent (emitted on cross-file `cursor.set` for RowAnchors). The
    // intent updates the sidebar selection only — issue #310 split off
    // the implicit auto-unfold so a cursor click on a row in a
    // classifier-collapsed file's diff body (which is already expanded)
    // doesn't accidentally toggle other folds.
  };

  // Mouse click on an interactive row (PRD #107 US 16): set cursor with
  // `interactive` populated, no `side`. preferredSide carries forward
  // from the existing cursor so a subsequent move back onto a paired diff
  // row honours the user's last h/l preference.
  const onInteractiveClick = (
    file: string,
    subKind: InteractiveSubKind,
    boundaryRef: BoundaryRef,
  ) => {
    setSidebarFocused(false);
    store.dispatch({
      type: "cursor.set",
      anchor: cursorOnInteractive({
        file,
        subKind,
        boundaryRef,
        preferredSide: preferredSideOf(cursor),
      }),
    });
    // Sidebar selection flows through the reducer's `selectSidebarFile`
    // intent (emitted on cross-file `cursor.set` for RowAnchors). The
    // intent updates the sidebar selection only — issue #310 split off
    // the implicit auto-unfold so a cursor click on a row in a
    // classifier-collapsed file's diff body (which is already expanded)
    // doesn't accidentally toggle other folds.
  };

  // Mouse click on an annotation card (issue #261). ADR 0022 unified the
  // cursor — CardAnchor is first-class — so the click writes a card
  // anchor for the clicked top-level annotation, mirroring the keyboard
  // n/p path (`jumpToAnnotation`) and the webapp's
  // `setCursorFromCardClick`. preferredSide is threaded from the
  // existing cursor so a subsequent h/l honours the user's choice.
  const onCardClick = (annotationId: string) => {
    const ann = annotations.find((a) => a.id === annotationId);
    if (!ann) return;
    setSidebarFocused(false);
    store.dispatch({
      type: "cursor.set",
      anchor: cursorFromAnnotation(ann, preferredSideOf(cursor)),
    });
    // Cursor-follow useEffect handles the scroll-into-view via the
    // reducer's `scrollCursorTarget` intent — no parallel scroll call
    // here (would race the centred scroller).
  };

  // Hunk-separator gap size = lines between previous hunk's additions end
  // and this hunk's additions start, on the additions side (gap is symmetric
  // across both sides for context). Returns 0 when the cursor isn't on a
  // resolvable separator.
  const hunkSeparatorGapSize = (file: string, hunkIndex: number): number => {
    const meta = fileMetadata.get(file);
    if (!meta || hunkIndex <= 0 || hunkIndex >= meta.hunks.length) return 0;
    const prev = meta.hunks[hunkIndex - 1];
    const next = meta.hunks[hunkIndex];
    return Math.max(0, next.additionStart - (prev.additionStart + prev.additionCount));
  };
  const boundaryTopGapSize = (file: string): number => {
    const meta = fileMetadata.get(file);
    if (!meta || meta.hunks.length === 0) return 0;
    return Math.max(0, meta.hunks[0].additionStart - 1);
  };
  const boundaryBottomGapSize = (file: string): number => {
    const meta = fileMetadata.get(file);
    if (!meta || meta.hunks.length === 0) return 0;
    const last = meta.hunks[meta.hunks.length - 1];
    const lastEnd = last.additionStart + last.additionCount - 1;
    const contents = bundleSlice?.fileContents.get(file);
    if (!contents?.newContent) return 0;
    const trimmed = contents.newContent.endsWith("\n")
      ? contents.newContent.slice(0, -1)
      : contents.newContent;
    const lineCount = trimmed === "" ? 0 : trimmed.split("\n").length;
    return Math.max(0, lineCount - lastEnd);
  };

  // Real expansion handlers (PRD #108). Dispatch through the Tour-session
  // store (issue #231 / PRD #229) — the reducer's `expansion.*` actions
  // delegate to the same pure helpers in `core/expansion-state.ts` the
  // surface used to call directly.
  //
  // Issue #280: the hunk-header banner's left cell is interactive
  // when `primaryExpand !== null` — its Enter dispatch is routed by
  // `dispatchPrimaryAction` (`boundary-top` / `hunk-separator` cases).
  // The standalone `expand-down` row uses the symmetric-20 ladder; the
  // banner's "all" path reveals the entire remaining gap in one Enter.
  const expandDirectional = (
    file: string,
    boundaryRef: BoundaryRef,
    direction: "up" | "down" | "both",
    mode: "all" | "symmetric-20",
  ) => {
    if (boundaryRef === "top") {
      const gapSize = boundaryTopGapSize(file);
      if (gapSize === 0) return;
      store.dispatch({ type: "expansion.expandTop", file, mode, gapSize });
      return;
    }
    if (boundaryRef === "bottom") {
      const gapSize = boundaryBottomGapSize(file);
      if (gapSize === 0) return;
      store.dispatch({ type: "expansion.expandBottom", file, mode, gapSize });
      return;
    }
    const gapSize = hunkSeparatorGapSize(file, boundaryRef);
    if (gapSize === 0) return;
    store.dispatch({
      type: "expansion.expand",
      file,
      ref: boundaryRef,
      direction,
      mode,
      gapSize,
    });
  };
  // Enter on a synthetic CollapsedFileRow flips fileExpanded → planner
  // emits the file's normal diff body next render (PRD #108 issue #113).
  // One-way; re-collapse goes through the parallel `c` toggle.
  const expandCollapsedFile = (file: string) => {
    store.dispatch({ type: "expansion.expandFile", file });
  };

  // PRD #270 / issue #274 (Slice 4); migrated to the file-header chrome
  // by issue #297. Walk every boundary in the file (file-top, mid-file
  // separators, file-bottom), compute each gap size, and saturate them
  // all in one reducer hop. After dispatch every gap is zero-sized; the
  // planner stops emitting the directional family AND the chrome's
  // `↕` affordance disappears (gapCount drops below 2 per issue #298).
  const expandAllInFile = (file: string) => {
    const meta = fileMetadata.get(file);
    if (!meta || meta.hunks.length === 0) return;
    const boundaries: { ref: BoundaryRef; gapSize: number }[] = [];
    const topGap = boundaryTopGapSize(file);
    if (topGap > 0) boundaries.push({ ref: "top", gapSize: topGap });
    for (let i = 1; i < meta.hunks.length; i++) {
      const gap = hunkSeparatorGapSize(file, i);
      if (gap > 0) boundaries.push({ ref: i, gapSize: gap });
    }
    const botGap = boundaryBottomGapSize(file);
    if (botGap > 0) boundaries.push({ ref: "bottom", gapSize: botGap });
    if (boundaries.length === 0) return;
    store.dispatch({ type: "expansion.expandFileAll", file, boundaries });
  };

  // Routes a primary-action keystroke to the row-kind-specific handler.
  // Pure dispatch table — the actual expansion behaviour lives in the
  // stubs above. The Shift modifier is no longer special (PRD #270
  // Slice 5 / issue #275); the per-file Expand-all row is the whole-
  // file escape hatch.
  //
  // Issue #306: when the dispatch consumes the row's gap entirely the
  // next render drops the row from flatRows and `j`/`k` no-ops on the
  // stranded anchor. Predict the orphan, capture a landing target via
  // `cursorAfterExpand` against the pre-dispatch flatRows, then dispatch
  // `cursor.set` alongside the `expansion.*` action so state and view
  // stay in lockstep. Mirrors the webapp's Enter handler.
  const dispatchPrimaryAction = () => {
    if (!cursor || cursor.kind !== "row" || !cursor.interactive) return;
    const { subKind, boundaryRef } = cursor.interactive;
    const flatRowsBefore = flatRowsList;
    let orphanKind: ExpandOrphanKind | null = null;
    switch (subKind) {
      case "expand-down": {
        const gapSize =
          boundaryRef === "bottom"
            ? boundaryBottomGapSize(cursor.file)
            : typeof boundaryRef === "number"
              ? hunkSeparatorGapSize(cursor.file, boundaryRef)
              : 0;
        if (gapSize === 0) return;
        // Mode is always symmetric-20 + direction "down" → addDown =
        // min(SYMMETRIC_STEP*2, remaining) = min(20, remaining). Bottom
        // row stops emitting at new gap == 0; mid-file row stops emitting
        // at new gap < GAP_TWO_ROW_THRESHOLD (planner's
        // `emitLeadingExpandDown` rule).
        const ref = boundaryRef === "bottom" ? "bottom" : (boundaryRef as number);
        const cur = getBoundary(expansion, { file: cursor.file, ref });
        const remaining = gapSize - cur.up - cur.down;
        const addition = Math.min(20, remaining);
        const newRemaining = remaining - addition;
        if (boundaryRef === "bottom") {
          orphanKind = newRemaining <= 0 ? "expand-down-bottom" : null;
        } else {
          orphanKind = newRemaining < GAP_TWO_ROW_THRESHOLD ? "expand-down-mid" : null;
        }
        const landing =
          orphanKind === null
            ? null
            : cursorAfterExpand(cursor, flatRowsBefore, orphanKind);
        expandDirectional(cursor.file, boundaryRef, "down", "symmetric-20");
        if (landing !== null && landing !== cursor) {
          store.dispatch({ type: "cursor.set", anchor: landing });
        }
        return;
      }
      case "boundary-top":
      case "hunk-separator": {
        // Issue #280: hunk-header banner's left cell. Re-derive the
        // primary expand subkind from gap size + edge position (same
        // helper the planner uses for `primaryExpand`); route Up →
        // EXPANSION_STEP, All → full-gap reveal.
        const gapSize =
          boundaryRef === "top"
            ? boundaryTopGapSize(cursor.file)
            : typeof boundaryRef === "number"
              ? hunkSeparatorGapSize(cursor.file, boundaryRef)
              : 0;
        if (gapSize === 0) return;
        const plan = hunkHeaderExpandPlan(gapSize, subKind === "boundary-top");
        if (plan.primaryExpand === null) return;
        if (plan.primaryExpand === "up") {
          expandDirectional(cursor.file, boundaryRef, "up", "symmetric-20");
        } else {
          // "all" dispatch reveals the entire remaining gap → next render
          // sets primaryExpand=null and the banner drops out of flatRows.
          // Issue #306 orphan path.
          orphanKind = subKind === "boundary-top" ? "boundary-top" : "hunk-separator";
          const landing = cursorAfterExpand(cursor, flatRowsBefore, orphanKind);
          expandDirectional(cursor.file, boundaryRef, "both", "all");
          if (landing !== cursor) {
            store.dispatch({ type: "cursor.set", anchor: landing });
          }
        }
        return;
      }
      case "collapsed-file": {
        const landing = cursorAfterExpand(cursor, flatRowsBefore, "collapsed-file");
        expandCollapsedFile(cursor.file);
        if (landing !== cursor) {
          store.dispatch({ type: "cursor.set", anchor: landing });
        }
        return;
      }
    }
  };

  // Bridge for surface-side cursor mutations: the pure motion helpers in
  // `core/cursor-state.ts` return `Cursor | null`. Same-ref short-circuit
  // avoids a no-op dispatch (the reducer's `setCursor` would still emit
  // `scrollCursorTarget`, which we don't want on a noop motion).
  const dispatchCursor = (next: Cursor | null) => {
    if (next === cursor) return;
    dispatchAnchorOrClear(next);
  };

  // Shared file-row select handler for the sidebar — invoked by both the
  // keyboard `select-file` action and the mouse `onMouseDown` on a file
  // row. Drops sidebar focus (file rows transfer focus to the diff pane,
  // matching "show me from the top"), scrolls the diff stream to the file
  // card, and lands the cursor on the file's first annotatable row. Kept
  // out-of-switch so the two entry points can't drift.
  const selectSidebarFile = (filePath: string, opts: { animate?: boolean } = {}) => {
    setSidebarFocused(false);
    if (diffScrollRef.current) {
      // Issue #294 Slice 1: the keyboard `select-file` path passes
      // `animate: true`; the mouse-click path on a file row passes nothing
      // (default false). Per the brief, sidebar mouse-click on a file is a
      // random-access jump that would slog under animation; keyboard select-
      // file is the in-flight cursor gesture that benefits from smooth motion.
      const targetId = `file-card-${filePath}`;
      if (opts.animate === true) animatedScrollChildIntoView(diffScrollRef.current, targetId);
      else scrollChildIntoView(diffScrollRef.current, targetId);
    }
    // Sidebar select is a navigation gesture, not an explicit reveal —
    // issue #313. The cursor lands on the file's first walkable row
    // (synthetic `collapsed-file` banner when classifier-collapsed; first
    // diff row otherwise); Enter on the banner is the explicit-reveal
    // escape hatch. Annotation jumps (`jumpToAnnotation`) still force-
    // unfold — they remain the only "explicit reveal" callsites here.
    dispatchCursor(cursorAtFirstFileRow(filePath, flatRowsList));
  };

  // Lazy materialization (ADR 0011 Revisions). Returns the seeded
  // cursor (or the existing one if already materialized) so the caller
  // can chain into composer-open / motion in one step. The dispatch is
  // queued, so the returned value is what the caller should act on this
  // tick. Surface parity with src/web/client/App.tsx.
  const materializeCursor = (): Cursor | null => {
    if (cursor) return cursor;
    const seeded = initialCursor({
      topLevelAnnotations: topLevel,
      flatRows: flatRowsList,
    });
    if (seeded) store.dispatch({ type: "cursor.materialize", anchor: seeded });
    return seeded;
  };

  const openTopLevelComposer = () => {
    const activeCursor = materializeCursor();
    // `a` is row-only (PRD #192 / ADR 0022). The keymap already gates a
    // card cursor to a footer-hint no-op; the App-shell composer call
    // here defends in depth so the user can't reach a mis-anchored
    // composer through state churn.
    if (activeCursor && activeCursor.kind === "card") return;
    const target = buildTopLevelComposer({
      cursor: activeCursor,
      currentAnnotation: cursorCardAnnotation,
    });
    if (!target) return;
    store.dispatch({ type: "composer.open", target });
  };

  const openReplyComposer = () => {
    // `r` is card-only (PRD #192 / ADR 0022). When the cursor's card is
    // off-screen (wheel-scrolled away), pull it into view BEFORE the
    // composer mounts — the user sees the card on-screen when the next
    // render lands (auto-recall, PRD #192 user story 14).
    if (!cursorCardAnnotation) return;
    const sb = diffScrollRef.current;
    if (sb) scrollChildIntoView(sb, `annotation-${cursorCardAnnotation.id}`);
    const target = buildReplyComposer({ currentAnnotation: cursorCardAnnotation });
    if (!target) return;
    store.dispatch({ type: "composer.open", target });
  };

  // Send the latest human leaf in the focused Thread to the configured
  // reply-agent (issue #196, PRD #181). The cursor walks top-levels
  // only — once the conversation has started, the cursor-focused
  // top-level is `already-replied` and would dead-end the keystroke
  // under the per-Annotation rule. Targeting the leaf mirrors the
  // webapp's #190/#191 collapse so `s` keeps working as soon as there
  // are Replies in the Thread.
  //
  // `s` is a no-op with a footer hint when:
  //  - no annotation is focused (null cursor / row cursor),
  //  - the latest turn in the focused Thread is agent-authored,
  //  - `--reply-agent` is unset,
  //  - the lock is held by another in-flight dispatch on this tour.
  // The dispatch chain (Tour-session runtime → adapter → reply-runner) is
  // fire-and-forget — the watcher's lock + bundle events drive the in-
  // flight pill and the landed Reply into view. PRD #278 slice 7.
  const sendCurrentToAgent = () => {
    if (!props.replyAgent) return;
    // `s` is card-only (PRD #192 / ADR 0022). The keymap gates the
    // row case to a footer-hint no-op; this defends in depth.
    if (!cursorCardAnnotation) {
      setFooterStatus("no comment under cursor — n/p to navigate");
      return;
    }
    if (!sendHintVerdict.enabled) {
      if (sendHintVerdict.reason === "lock-held") {
        setFooterStatus(`${replyLock?.agent ?? props.replyAgent} is replying — wait`);
      }
      // sendTarget === null (latest turn is agent) falls out of the
      // visible set (footer hint hidden), so pressing `s` is a silent
      // no-op.
      return;
    }
    if (!sendTargetVal) return;
    setFooterStatus(null);
    store.dispatch({
      type: "send-to-agent",
      tourId: bundle.tour.id,
      annotationId: sendTargetVal.leafId,
    });
  };

  useKeyboard((key) => {
    // Ctrl+D — opentui's built-in debug overlay. Shows FPS, frame time,
    // memory. Handle before composer/picker so it works even mid-edit.
    if (key.ctrl && key.name === "d") {
      renderer.toggleDebugOverlay();
      return;
    }
    if (composer.kind === "open") {
      // Esc cancels; Return / typing flows through to the focused <input>.
      if (key.name === "escape") {
        store.dispatch({ type: "composer.close" });
      }
      return;
    }
    if (composer.kind === "submitting") {
      // Esc abandons the in-flight write (the writer's promise resolves
      // into a closed slice — the reducer's `composer.submitted` /
      // `composer.failed` branches no-op on non-submitting). All other
      // keys are swallowed so the user can't fire actions on stale state.
      if (key.name === "escape") {
        store.dispatch({ type: "composer.close" });
      }
      return;
    }
    if (composer.kind === "errored") {
      // Enter retries the write (reducer transitions errored → submitting
      // and re-emits `submitAnnotation`). Esc drops back to `open` so the
      // user can edit the draft and re-submit. Issue #254.
      if (key.name === "escape") {
        store.dispatch({ type: "composer.dismissError" });
        return;
      }
      if (key.name === "return") {
        store.dispatch({ type: "composer.retry" });
        return;
      }
      return;
    }
    if (sessionState.picker.kind === "open") {
      // Issue #340 / ADR 0030: close on Escape or Shift+T (mirrors the
      // open binding); bare `t` is a plain noop here, same as in the
      // main dispatcher after the #337 cutover.
      const action = dispatchPickerKey(key);
      if (action.type === "close") {
        store.dispatch({ type: "picker.close" });
        return;
      }
      if (action.type === "move") {
        store.dispatch({ type: "picker.move", delta: action.delta });
        return;
      }
      if (action.type === "commit") {
        const highlighted = pickerHighlighted(sessionState);
        if (!highlighted) return;
        if (highlighted.id === bundle.tour.id) {
          store.dispatch({ type: "picker.close" });
          return;
        }
        store.dispatch({ type: "picker.commit" });
        return;
      }
      return;
    }

    // Issue #312 (cap retuned in #315): `[`/`]` resize the sidebar
    // within `[SIDEBAR_MIN_WIDTH, max(MIN, termW - SIDEBAR_MIN_WIDTH)]`.
    // The manual cap is strictly wider than the auto-fit cap so the
    // user can push past the diff-pane-minimum reservation when the
    // sidebar needs to render very long paths (the auto-fit cap's
    // escape valve). Handled here so the composer / picker early-
    // returns above swallow brackets while typing or navigating the
    // tour picker. The adjustment is session-local — the next tour
    // switch re-runs auto-fit and the override doesn't carry over.
    //
    // Issue #318 (upgraded to preserveScreenY per follow-up review):
    // a width change reflows annotation cards, drifting the diff
    // viewport's visual position. `scrollChildIntoView(block:nearest)`
    // alone wasn't enough — it no-ops when the row is still in viewport
    // (so card-height deltas above the cursor walked it within the
    // viewport) and snaps to the nearer edge when the row falls out
    // (so held-down `]` drifted the cursor toward an edge). Mirror
    // the layout-toggle pattern (#303): capture the target's on-screen
    // y BEFORE `setSidebarWidth` schedules the re-render, then apply
    // it in the resize-apply useEffect once Yoga has re-measured.
    // No-op when the clamp pinned the width (no reflow).
    if (!key.ctrl && !key.shift && (key.name === "[" || key.name === "]")) {
      const delta = key.name === "[" ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP;
      const next = clampSidebarWidthManual(
        sidebarWidth + delta,
        renderer.terminalWidth,
      );
      setFooterStatus(`sidebar: ${next} cols`);
      if (next !== sidebarWidth) {
        const sb = diffScrollRef.current;
        const targetId = resizeReanchorTargetId({
          cursor,
          flatRows: flatRowsList,
          activeFile,
        });
        if (sb && targetId !== null) {
          const snap = captureScreenYSnapshot(sb, targetId);
          if (snap) resizeSnapshotRef.current = { rowId: targetId, snap };
        }
      }
      setSidebarWidth(next);
      return;
    }

    const action = dispatchKey(
      { name: key.name, ctrl: key.ctrl, shift: key.shift },
      {
        sidebarFocused,
        rowCount: rowsSlice?.rowCount ?? 0,
        selectedRowKind: selectedRow?.kind ?? null,
        cursorOnInteractive: cursorSlice?.onInteractive ?? false,
        cursorOnCard: cursorSlice?.onCard ?? false,
      },
    );

    // Lazy materialization (ADR 0011 Revisions): the first j/k/h/l/arrow
    // interaction with a null cursor SHOWS the cursor at the default
    // target without moving past it. `a` materializes AND opens the
    // composer in one step; n/p materialize via β-coupling inside
    // jumpToAnnotation. Degraded states (no rows) yield null and the
    // motion is a silent no-op.
    const isMotion =
      action.type === "cursor-down" ||
      action.type === "cursor-up" ||
      action.type === "cursor-side-left" ||
      action.type === "cursor-side-right";
    if (isMotion && cursor === null) {
      materializeCursor();
      return;
    }

    switch (action.type) {
      case "quit":
        renderer.destroy();
        return;
      case "toggle-pane":
        setSidebarFocused((v) => !v);
        return;
      case "focus-sidebar":
        setSidebarFocused(true);
        return;
      case "move-file-down":
        setSelectedRowIdx((i) => Math.min(i + 1, (treeSlice?.visibleRows.length ?? 0) - 1));
        return;
      case "move-file-up":
        setSelectedRowIdx((i) => Math.max(i - 1, 0));
        return;
      case "select-file": {
        if (selectedRow?.kind !== "file") return;
        // PRD US 20: explicit sidebar-driven file selection moves the
        // cursor to that file's first annotatable row. Folded files
        // contribute no rows so cursor clears. currentAnnotationId is
        // unchanged — annotation focus is independent of code-reading
        // position. Shared with the mouse path via `selectSidebarFile`.
        // Issue #294 Slice 1: the keyboard path animates; mouse-click
        // stays instant (passed through the default at the mouse site).
        selectSidebarFile(selectedRow.path, { animate: true });
        return;
      }
      case "expand-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        if (!collapsedFolders.has(path)) return;
        store.dispatch({ type: "folds.toggleFolder", path });
        return;
      }
      case "collapse-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        if (collapsedFolders.has(path)) return;
        store.dispatch({ type: "folds.toggleFolder", path });
        return;
      }
      case "collapse-parent": {
        if (selectedRow?.kind !== "file") return;
        const ancestors = revealAncestors(tree, selectedRow.path);
        if (ancestors.length === 0) return;
        const parentPath = ancestors[ancestors.length - 1];
        if (!collapsedFolders.has(parentPath)) {
          store.dispatch({ type: "folds.toggleFolder", path: parentPath });
        }
        // Selected row index follows the parent into its new position after
        // collapse — derive against the post-collapse flatten so the cursor
        // doesn't strand inside the now-hidden subtree.
        const nextCollapsed = new Set(collapsedFolders);
        nextCollapsed.add(parentPath);
        const nextRows = flatten(tree, nextCollapsed, annotationCounts);
        const newIdx = nextRows.findIndex((r) => r.path === parentPath);
        if (newIdx >= 0) setSelectedRowIdx(newIdx);
        return;
      }
      case "next-annotation":
        gotoNextAnnotation();
        return;
      case "prev-annotation":
        gotoPrevAnnotation();
        return;
      case "toggle-replies-collapse":
        setRepliesCollapsed((v) => !v);
        return;
      case "toggle-layout": {
        // Issue #303: capture the cursor row's pre-toggle position so the
        // layout-change useEffect below can pin it at the same on-screen
        // y after the diff re-flows. The capture must happen BEFORE the
        // dispatch — the snapshot reads `sb.scrollTop` and the row's
        // content-y on the pre-toggle layout. No cursor → no snapshot →
        // the toggle behaves as before (no preserve).
        const sb = diffScrollRef.current;
        if (sb && cursor && rowsSlice) {
          const rowId = cursorRowDomId(cursor, rowsSlice.flatRowsList);
          if (rowId) {
            const snap = captureScreenYSnapshot(sb, rowId);
            if (snap) layoutToggleSnapshotRef.current = { rowId, snap };
          }
        }
        store.dispatch({
          type: "layout.set",
          layout: layout === "split" ? "unified" : "split",
        });
        return;
      }
      case "open-picker":
        void openPicker();
        return;
      case "open-top-level-composer":
        openTopLevelComposer();
        return;
      case "open-reply-composer":
        openReplyComposer();
        return;
      case "send-to-agent":
        sendCurrentToAgent();
        return;
      case "page-diff-down":
      case "page-diff-up":
      case "half-page-diff-down":
      case "half-page-diff-up": {
        const dir =
          action.type === "page-diff-down" || action.type === "half-page-diff-down"
            ? "down"
            : "up";
        const step: "half" | "full" =
          action.type === "page-diff-down" || action.type === "page-diff-up"
            ? "full"
            : "half";
        const sb = diffScrollRef.current;
        if (!sb) return;
        // Page motion (PRD #126, issue #129; PRD #138, issue #139): pane
        // scrolls one step (full for hardware PageUp/PageDown, half for
        // Space / `b` / Shift+Space) AND cursor moves with it so its
        // screen-relative offset is preserved. Bumping a document bound
        // snaps the cursor to the last/first eligible row instead of
        // stranding it mid-pane.
        const result = pageMoveDiffPane(
          {
            cursor,
            flatRows: flatRowsList,
            scrollTop: sb.scrollTop,
            viewportHeight: sb.viewport.height,
            contentHeight: sb.scrollHeight,
            rowY: buildRowYResolver(sb, flatRowsList),
          },
          dir,
          step,
        );
        dispatchCursor(result.cursor);
        if (result.scrollTop !== sb.scrollTop) {
          sb.scrollTo(result.scrollTop);
        }
        return;
      }
      case "cursor-home":
      case "cursor-end": {
        const target = action.type === "cursor-home" ? "home" : "end";
        const sb = diffScrollRef.current;
        if (!sb) return;
        // Home / End jump (PRD #126, issue #130): cursor snaps to the
        // first / last cursor-eligible row; pane scrolls so the cursor
        // lands at the 3-row top / bottom margin (matching step()'s
        // scrolloff invariant). Folded files are auto-skipped — flatRows
        // already excludes their entries.
        const result = jumpDiffPane(
          {
            cursor,
            flatRows: flatRowsList,
            scrollTop: sb.scrollTop,
            viewportHeight: sb.viewport.height,
            contentHeight: sb.scrollHeight,
            rowY: buildRowYResolver(sb, flatRowsList),
          },
          target,
        );
        dispatchCursor(result.cursor);
        if (result.scrollTop !== sb.scrollTop) {
          sb.scrollTo(result.scrollTop);
        }
        return;
      }
      case "cursor-down":
      case "cursor-up": {
        const dir = action.type === "cursor-down" ? "down" : "up";
        const sb = diffScrollRef.current;
        if (!sb) {
          dispatchCursor(moveCursor(cursor, dir, flatRowsList));
          return;
        }
        // Diff-pane motion contract (ADR 0011 — Diff-pane motion contract).
        // Cursor floats; pane scrolls one row only when crossing the 3-row
        // edge margin. The cursor-scroll useEffect on `[cursor, layout]`
        // runs after the dispatch-driven re-render and applies block:
        // nearest, which dominates for off-viewport cursors (post-wheel-
        // scroll) and is a no-op when the cursor is already visible.
        const result = stepDiffPane(
          {
            cursor,
            flatRows: flatRowsList,
            scrollTop: sb.scrollTop,
            viewportHeight: sb.viewport.height,
            contentHeight: sb.scrollHeight,
            rowY: buildRowYResolver(sb, flatRowsList),
          },
          dir,
          3,
        );
        dispatchCursor(result.cursor);
        if (result.scrollTop !== sb.scrollTop) {
          // Issue #294 Slice 1 / #299: j/k crossing the edge margin tweens
          // the one-row shift. The cursor-follow useEffect's block:nearest
          // scroll is a no-op for j/k (the new row sits at the edge,
          // already in viewport), so this direct scroll is the only
          // animation hook for the gesture.
          animatedScrollTo(sb, result.scrollTop);
        }
        return;
      }
      case "cursor-side-left":
        dispatchCursor(setCursorSide(cursor, "deletions", flatRowsList));
        return;
      case "cursor-side-right":
        dispatchCursor(setCursorSide(cursor, "additions", flatRowsList));
        return;
      case "primary-action":
        dispatchPrimaryAction();
        return;
      case "expand-file-all": {
        // Issue #297: per-file Expand-all via keyboard. Pick the file
        // from the cursor (diff-pane RowAnchor / CardAnchor both carry
        // `file` directly or via the cursored annotation), falling back
        // to the sidebar's currently-selected file row. No-op when no
        // file is in scope (null cursor + sidebar parked on a folder).
        let targetFile: string | null = null;
        if (cursor) {
          if (cursor.kind === "row") targetFile = cursor.file;
          else {
            const ann = annotations.find((a) => a.id === cursor.annotationId);
            targetFile = ann?.file ?? null;
          }
        }
        if (targetFile === null && selectedRow?.kind === "file") {
          targetFile = selectedRow.path;
        }
        if (targetFile === null) {
          setFooterStatus("e: no file under cursor");
          return;
        }
        expandAllInFile(targetFile);
        return;
      }
      case "yank-file-path": {
        // Issue #326: resolve the focused file with the same permissive
        // policy as expand-file-all (#297) — cursor first, sidebar's
        // selected file as fallback. The original strict pane-gate
        // (sidebarFocused → selection; else → cursor) silently no-op'd
        // whenever the user was focused in one pane but the file was
        // in the other, which gave zero feedback. On null resolution
        // surface a footer hint so `y` is never invisibly inert.
        let targetFile: string | null = null;
        if (cursor) {
          if (cursor.kind === "row") targetFile = cursor.file;
          else {
            const ann = annotations.find((a) => a.id === cursor.annotationId);
            targetFile = ann?.file ?? null;
          }
        }
        if (targetFile === null && selectedRow?.kind === "file") {
          targetFile = selectedRow.path;
        }
        if (targetFile === null) {
          setFooterStatus("y: no file under cursor");
          return;
        }
        yankToClipboard(targetFile, renderer);
        const message = `Copied ${targetFile}`;
        setFooterStatus(message);
        if (yankFooterTimerRef.current !== null) {
          clearTimeout(yankFooterTimerRef.current);
        }
        yankFooterTimerRef.current = setTimeout(() => {
          yankFooterTimerRef.current = null;
          setFooterStatus((cur) => (cur === message ? null : cur));
        }, 1200);
        return;
      }
      case "noop-reply-on-row":
        setFooterStatus("r: no comment under cursor — n/p to navigate");
        return;
      case "noop-send-on-row":
        setFooterStatus("s: no comment under cursor — n/p to navigate");
        return;
      case "noop-comment-on-card":
        setFooterStatus("c: on a card — j/k to land on a row first");
        return;
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      <TopHeaderTui
        tour={bundle.tour}
        layout={layout}
        // SequencePill expects 0-based / -1 sentinel; `nav.currentIdx` is
        // 1-based / 0 sentinel (ok-only). Property check narrows on
        // snapshot-lost to the -1 sentinel.
        currentAnnotationIdx={("currentIdx" in nav ? nav.currentIdx : 0) - 1}
        topLevelTotal={topLevel.length}
        tourStats={tourStats}
        onOpenPicker={() => void openPicker()}
        onPrevAnnotation={gotoPrevAnnotation}
        onNextAnnotation={gotoNextAnnotation}
        onSplit={() => store.dispatch({ type: "layout.set", layout: "split" })}
        onUnified={() => store.dispatch({ type: "layout.set", layout: "unified" })}
      />

      {view.kind === "snapshot-lost" && (
        <box height={2} width="100%" paddingX={1}>
          <text fg={theme.fg.attention} bold>
            ⚠ Snapshot lost — annotations preserved but diff cannot be displayed
          </text>
        </box>
      )}

      {/* Main layout */}
      <box flexGrow={1} width="100%" flexDirection="row">
        {/* Sidebar */}
        <box
          width={sidebarWidth}
          borderStyle="single"
          borderColor={sidebarFocused ? theme.border.accent : theme.border.default}
          flexDirection="column"
          onMouseDown={() => setSidebarFocused(true)}
        >
          <scrollbox ref={sidebarScrollRef} height="100%">
            {visibleRows.map((row, idx) => {
              const isSelected = idx === safeRowIdx;
              // Issue #305: focus-aware cursor on the sidebar selection.
              // When the sidebar holds focus, the selected row paints the
              // bright `cursorRow.tui` plate + overlays a `❯` glyph in
              // `theme.fg.cursor` in the leading column. When the sidebar
              // is parked (diff pane holds focus), the row dims to the
              // softer `accentCursor.tui` plate and the glyph is hidden;
              // row width and label position do not shift across focus
              // because the glyph overwrites the leading space that the
              // row-label module already budgets for. Bold is dropped on
              // both states — the bg-intensity + glyph cues carry focus
              // and selection without a second weight cue. Composition
              // lives in `sidebar-cursor-paint.ts` so the four cases are
              // unit-testable in isolation.
              const { bg, showGlyph } = sidebarCursorPaint({ isSelected, sidebarFocused });
              const onRowMouseDown = (event: { stopPropagation: () => void }) => {
                // OpenTUI mouse events bubble (Renderable.processMouseEvent
                // calls parent unless `propagationStopped`). Without this
                // stop, the sidebar container's `onMouseDown` would fire
                // afterwards and force `sidebarFocused = true`, overriding
                // the file-row's focus transfer to the diff pane.
                event.stopPropagation();
                setSelectedRowIdx(idx);
                if (row.kind === "file") {
                  // Routes through the shared helper so mouse + keyboard
                  // can't drift on what "select a file" means.
                  selectSidebarFile(row.path);
                } else {
                  // Folder click is tree-internal navigation, not a "go to
                  // this file" gesture — keep focus on the sidebar.
                  setSidebarFocused(true);
                }
              };
              if (row.kind === "folder") {
                // Folder row is now a flex-row box (was a single <text>) so
                // the cursor glyph can overlay the leading-space slot in
                // `theme.fg.cursor` while the rest of the row keeps its
                // muted folder colour. `height={1}` on inner texts mirrors
                // the file-row treatment so the row stays at 1 grid row.
                const label = folderRowLabel(row, sidebarContentWidth - folderRowFixedCost(row));
                const labelText = showGlyph ? label.slice(1) : label;
                return (
                  <box
                    key={`d:${row.path}`}
                    id={`row-${row.path}`}
                    flexDirection="row"
                    backgroundColor={bg}
                    onMouseDown={onRowMouseDown}
                  >
                    {showGlyph && (
                      <text height={1} fg={CURSOR_FG} selectable={false}>{CURSOR_GLYPH}</text>
                    )}
                    <text height={1} fg={theme.fg.muted} selectable={false}>
                      {labelText}
                    </text>
                  </box>
                );
              }
              // Per-file diff stats (#265): `+N` in fg.success and `-M`
              // in fg.danger between filename and annotation badge. The
              // stats need their own foreground colors, so the row is a
              // flex-row box of sibling <text>s instead of one <text>.
              // countDiffStats handles the change-row shape: new files
              // count `+1`, deleted files count `-1`, paired-change rows
              // count `+1 -1`. Pure-rename rows (no content change)
              // return 0/0 and render no stats segments.
              const stats = countDiffStats(plannedRowsByFile.get(row.path) ?? []);
              const segs = fileRowSegments(
                row,
                stats,
                sidebarContentWidth - fileRowFixedCost(row, stats),
              );
              // Issue #305: when the sidebar is focused on this row, the
              // ❯ glyph rides in front of the leading segment. The row-
              // label module already budgets `LEADING = 1` (a single
              // leading space) inside `segs.leading`; the glyph overwrites
              // that one char so the middle-truncation budget for the
              // name is not affected and the row's total width stays at
              // `sidebarContentWidth`.
              const leadingText = showGlyph ? segs.leading.slice(1) : segs.leading;
              return (
                // `height={1}` on each inner `<text>` pins the file row
                // to 1 grid row. Without the pin every sidebar file row
                // silently rendered at 2 grid rows tall, leaving a
                // blank row below each entry (folder rows, rendered as
                // a single `<text bg={bg}>` directly, never tripped
                // it). The exact OpenTUI mechanism wasn't fully isolated
                // — the file row's text segments are short and don't
                // wrap, so this isn't the same wrap-induced sibling
                // stretch documented for the hunk-header banner in
                // DiffRows.tsx. Possibly a measure-path issue specific
                // to `<text>` as a direct flex child under a
                // `backgroundColor`-painted parent. `height={1}` works
                // empirically; leave it in place.
                <box
                  key={`f:${row.path}`}
                  id={`row-${row.path}`}
                  flexDirection="row"
                  backgroundColor={bg}
                  onMouseDown={onRowMouseDown}
                >
                  {showGlyph && (
                    <text height={1} fg={CURSOR_FG} selectable={false}>{CURSOR_GLYPH}</text>
                  )}
                  <text height={1} fg={theme.fg.default} selectable={false}>
                    {leadingText}
                  </text>
                  {segs.additions.length > 0 && (
                    <text height={1} fg={theme.fg.success} selectable={false}>
                      {segs.additions}
                    </text>
                  )}
                  {segs.deletions.length > 0 && (
                    <text height={1} fg={theme.fg.danger} selectable={false}>
                      {segs.deletions}
                    </text>
                  )}
                  {segs.badge.length > 0 && (
                    <text height={1} fg={theme.fg.default} selectable={false}>
                      {segs.badge}
                    </text>
                  )}
                  <text height={1} fg={theme.fg.default} selectable={false}>
                    {segs.trailing}
                  </text>
                </box>
              );
            })}
          </scrollbox>
        </box>

        {/* Diff pane */}
        <box
          flexGrow={1}
          borderStyle="single"
          borderColor={!sidebarFocused ? theme.border.accent : theme.border.default}
          title=" Diff "
          flexDirection="column"
          onMouseDown={() => setSidebarFocused(false)}
        >
          {view.kind === "ok" && bundle.kind === "ok" && bundle.diff && (() => {
            // Issue #307: synthesise GitHub-style sticky file-header in
            // OpenTUI. The pane-top header names the file the viewport is
            // currently inside (`activeFile` polled from scrollTop +
            // card offsets — see effect above), carries the same chrome
            // the in-card header used to carry (file label + per-file
            // Expand-all `↕` gated on ≥2 hidden gaps), and retargets its
            // dispatch to whatever file is currently active.
            //
            // Filename also lives inline in each card's top border via
            // the box `title` prop — so the upcoming file's name
            // previews as its labeled border scrolls into view. The
            // in-card `<FileHeader>` is gone; the active-file header at
            // the pane top is the only visible filename slot once the
            // user is inside a card.
            const activeFileObj = activeFile
              ? files.find((f) => f.name === activeFile)
              : undefined;
            const activeFileMeta = activeFile ? fileMetadata.get(activeFile) : undefined;
            const activeCollapsed = activeFile ? isFileCollapsed(activeFile) : false;
            const activeHasMultipleHiddenGaps =
              activeFileObj !== undefined &&
              !activeCollapsed &&
              activeFileMeta !== undefined &&
              fileExpandableGapCount(
                activeFileMeta,
                expansion,
                bundleSlice?.fileContents.get(activeFileObj.name)?.newContent,
              ) >= 2;
            return (
              <>
                {activeFileObj && (
                  <FileHeader
                    fileName={activeFileObj.name}
                    label={fileEntryLabel(activeFileObj, classifications, annotations)}
                    hasMultipleHiddenGaps={activeHasMultipleHiddenGaps}
                    onExpandAll={expandAllInFile}
                  />
                )}
                <scrollbox
                  ref={diffScrollRef}
                  height="100%"
                  // viewportCulling=true skips render work for off-screen file
                  // cards. Previously off-limits because off-screen children
                  // carry stale `_y` under culling (commit 0f2d59d), which
                  // broke `scrollChildIntoView` for cross-file `n`/`p`
                  // autoscroll. The diff-pane scroll-into-view path now goes
                  // through `./scroll-into-view.ts`, which force-refreshes
                  // layout from Yoga before reading position; and
                  // `buildRowYResolver` does the same on every visited node.
                  // Both are per-frame guarded so already-fresh nodes are a
                  // no-op.
                  viewportCulling={true}
                >
                  {files.map((file) => {
                    const collapsed = isFileCollapsed(file.name);
                    const rows = plannedRowsByFile.get(file.name) ?? [];
                    const reason = fileClassification(classifications, file.name).reason;
                    return (
                      <box
                        key={file.name}
                        id={`file-card-${file.name}`}
                        borderStyle="single"
                        borderColor={theme.border.default}
                        title={fileEntryLabel(file, classifications, annotations)}
                        flexDirection="column"
                        marginBottom={1}
                      >
                        {fileCardBody(
                          file.name,
                          collapsed,
                          file.hunks.length > 0,
                          reason,
                          rows,
                          layout,
                          cursorCardId,
                          cursor,
                          onCursorClick,
                          onInteractiveClick,
                          onCardClick,
                          repliesCollapsed,
                          replyLock,
                          now,
                          nav.navIndexById,
                          nav.navTotal,
                          !sidebarFocused,
                        )}
                      </box>
                    );
                  })}
                </scrollbox>
              </>
            );
          })()}
        </box>
      </box>

      {/* Footer */}
      <box height={1} width="100%" paddingX={1}>
        <text fg={theme.fg.muted}>{footer}</text>
      </box>

      {sessionState.picker.kind === "open" && (
        <TourPicker
          rows={sessionState.picker.rows}
          currentTourId={bundle.tour.id}
          cursor={sessionState.picker.cursor}
          scrollRef={pickerScrollRef}
          onSelect={(idx) => {
            // Mirror the Enter branch above: align cursor first (so the
            // reducer's `picker.commit` resolves to the clicked id),
            // then close-or-commit by whether the clicked row is the
            // currently loaded tour. Issue #321.
            if (sessionState.picker.kind !== "open") return;
            const row = sessionState.picker.rows[idx];
            if (!row) return;
            if (idx !== sessionState.picker.cursor) {
              store.dispatch({
                type: "picker.move",
                delta: idx - sessionState.picker.cursor,
              });
            }
            if (row.id === bundle.tour.id) {
              store.dispatch({ type: "picker.close" });
              return;
            }
            store.dispatch({ type: "picker.commit" });
          }}
        />
      )}

      {composer.kind !== "closed" && (
        <Composer
          state={composer}
          parent={
            composer.target.kind === "reply"
              ? annotations.find((a) => a.id === composer.target.replies_to) ?? null
              : null
          }
          onInput={(body) => store.dispatch({ type: "composer.setBody", body })}
          onSubmit={() => store.dispatch({ type: "composer.submit" })}
        />
      )}
    </box>
  );
}

export async function startTui(props: AppProps): Promise<void> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    useMouse: true,
    // React state owns which pane is focused; the renderer's auto-focus on
    // mouse-down would otherwise focus the underlying scrollbox out-of-band
    // and route j/k to its built-in viewport scroll, conflicting with our
    // keymap row navigation.
    autoFocus: false,
    exitOnCtrlC: true,
  });
  const root = createRoot(renderer);
  root.render(<App {...props} />);
  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve());
  });
}
