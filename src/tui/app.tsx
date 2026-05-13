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
import { GAP_TWO_ROW_THRESHOLD } from "../core/diff-rows.js";
import {
  emptyExpansion,
  getBoundary,
  seedFromOrphans,
  type OrphanWindow,
} from "../core/expansion-state.js";
import type { TourBundle, BundleFile } from "../core/tour-bundle.js";
import type { FileClassification } from "../core/file-classifier.js";
import { DiffRows } from "./DiffRows.js";
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
  buildWriteAnnotationInput,
  type StartTuiProps,
  type WriteAnnotationInput,
} from "../core/write-annotation-input.js";
import { theme } from "../core/theme.js";
import { dispatchKey } from "./keymap.js";
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
  fileRowLabel,
  folderRowFixedCost,
  fileRowFixedCost,
} from "./sidebar-row-label.js";
import { TourWatcher } from "../core/watcher.js";
import { requestReply } from "../core/reply-runner.js";
import type { ReplyLock } from "../core/reply-lock.js";
import { canSendToAgent } from "../core/can-send-to-agent.js";
import type { FlatRow } from "../core/flat-rows.js";
import {
  initialCursor,
  moveCursor,
  nextCard,
  prevCard,
  preferredSideOf,
  setCursorSide,
  validateCursor,
  cursorFromAnnotation,
  cursorAtFirstFileRow,
  cursorOnInteractive,
  type Cursor,
} from "../core/cursor-state.js";
import {
  step as stepDiffPane,
  pageMove as pageMoveDiffPane,
  jump as jumpDiffPane,
} from "../core/diff-pane-motion.js";
import type { BoundaryRef, InteractiveSubKind } from "../core/diff-rows.js";
import { scrollChildIntoView, centerChildInView } from "./scroll-into-view.js";
import { buildRowYResolver } from "./row-y-resolver.js";
import { composeFooterHints, composeFooterPreview } from "./footer-hints.js";

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
    />
  );
}

// Sidebar box is 30 cols wide with a 1-cell border on each side; usable
// inner width is 28. Row labels are middle-truncated to this width so
// long names never wrap (issue #156).
const SIDEBAR_WIDTH = 30;
const SIDEBAR_BORDER = 2;
const SIDEBAR_CONTENT_WIDTH = SIDEBAR_WIDTH - SIDEBAR_BORDER;

function App(props: AppProps) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
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
  const view = useTourSessionView(store, bundle);
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
  // The post-submit scroll-the-new-card-into-view flow is driven by the
  // reducer's `scrollToAnnotation` intent (emitted by `composer.submitted`,
  // PRD #234 / issue #237). The TUI's prior `pendingScrollAnnotationId`
  // useState is gone; the intent listener stashes the id in this ref and a
  // useEffect on `plannedRowsByFile` consumes it once the bundle-refresh
  // re-render mounts the new card. The retry useEffect mirrors the prior
  // flow's correctness without requiring assumptions about React commit
  // timing relative to the `composer.submitted` dispatch.
  const pendingScrollIdRef = useRef<string | null>(null);
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

  // Per-tour file watcher: drives the bundle reload (so newly-written
  // Annotations show up) and the reply-lock state (so the in-flight pill
  // appears and disappears). The watcher's role is state observation only;
  // reply-agent dispatch is now explicit — pressing `s` calls
  // `requestReply` in-process (ADR 0021, issue #184). Inert when no
  // loadTour is wired.
  useEffect(() => {
    if (!props.cwd || !props.loadTour) return;
    const watcher = new TourWatcher(props.cwd, bundle.tour.id);

    let cancelled = false;
    const reload = async () => {
      if (!props.loadTour || cancelled) return;
      try {
        const next = await props.loadTour(bundle.tour.id);
        if (cancelled) return;
        // Same-tour refresh (issue #211): dispatch `bundle.refreshed`
        // (NOT `tour.switched`) so the watcher reload doesn't trigger
        // the CONTEXT-pinned Tour-switch reset cascade (picker close +
        // replyLock idle).
        // Re-seed orphan windows on watcher reload (annotations may have
        // changed; orphan windows recompute). seedFromOrphans unions per-side
        // by max so manually expanded user state is preserved (issue #114).
        // Dispatch BEFORE `bundle.refreshed` so the reducer's `revalidateCursor`
        // intent fires against the freshly-seeded expansion slice.
        if (next.kind === "ok") {
          store.dispatch({
            type: "expansion.seedFromOrphans",
            windows: flattenOrphanWindows(next.files),
          });
        }
        store.dispatch({ type: "bundle.refreshed", bundle: next });
      } catch {
        // transient — keep current bundle
      }
    };
    const reloadLock = async () => {
      if (!props.loadReplyLock || cancelled) return;
      try {
        const next = await props.loadReplyLock(bundle.tour.id);
        if (cancelled) return;
        store.dispatch({ type: "replyLock.loaded", replyLock: next });
      } catch {
        // transient — keep current pill state
      }
    };

    watcher.on((event) => {
      if (event.type === "annotation-changed") {
        void reload();
        void reloadLock();
      } else if (event.type === "reply-in-flight" || event.type === "reply-cleared") {
        // Lock is OUT of the bundle (PRD #135) — fetched separately so a
        // lock change doesn't trigger a full hydrate of diff + per-file
        // contents. The whole-bundle reload on these events that this
        // refactor exposes is left as a follow-up perf fix.
        void reloadLock();
      }
    });
    watcher.start();

    return () => {
      cancelled = true;
      watcher.stop();
    };
  }, [bundle.tour.id, props.cwd, props.loadTour]);

  // Sorted file list for diff-pane render order. `view.rows.plannedRowsByFile`
  // is keyed by name; we still need the ordered file list for the JSX.
  const files = useMemo(
    () => sortFilesForStream(bundleSlice?.files ?? ([] as ReadonlyArray<BundleFile>)),
    [bundleSlice],
  );

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

  const flatRowsList = rowsSlice?.flatRowsList ?? EMPTY_FLAT_ROWS;
  const plannedRowsByFile = rowsSlice?.plannedRowsByFile ?? EMPTY_PLANNED_ROWS;
  const classifications = bundleSlice?.classifications ?? EMPTY_CLASSIFICATIONS;

  // Body-level visibility (binary placeholder + user-driven `c` collapse).
  // The view's planner uses the same rule internally for its
  // classifierCollapsed flag; this surface-side mirror gates body render
  // of binary files and honours the `c` override.
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

  // Keep the cursor's row visible. A RowAnchor scrolls its diff/interactive
  // row with `block:nearest`; a CardAnchor centres its card in the viewport
  // (matches the prior `currentAnnotationId` UX from PRD #126, issue #128
  // — cards always get context above and below). `layout` is in deps so a
  // Shift-L flip — which preserves the anchor but moves the visual
  // position — re-fires the scroll.
  //
  // Issue #250: defer the scroll call to the next macrotask via
  // `setTimeout(0)`. React's commit runs synchronously, but OpenTUI's
  // Yoga relayout for the newly-rendered rows runs on a later render tick.
  // Reading positions inside this effect synchronously sees a stale layout
  // (most visible when Shift-L flips layout while the cursor is on a card:
  // `centerChildInView` computed against the previous layout's content
  // frame parks the viewport on a strip where only annotation cards live,
  // hiding every diff row). `setTimeout(0)` is what reliably lands the
  // callback after OpenTUI's render tick — verified empirically.
  // `requestAnimationFrame` does NOT work here: in bun/node it shims to
  // `setImmediate` (or similar) and fires BEFORE OpenTUI's render tick,
  // which keeps the bug. Do not "improve" this back to rAF.
  useEffect(() => {
    if (!diffScrollRef.current || !cursor) return;
    const sb = diffScrollRef.current;
    // RowAnchor uses the culling-safe `scrollChildIntoView`: under
    // `viewportCulling={true}` opentui leaves stale positions inside
    // off-screen file subtrees, and a cross-file `n`/`p` jump lands on the
    // previous file otherwise. CardAnchor uses `centerChildInView` so
    // cards get context above and below.
    const targetId =
      cursor.kind === "card"
        ? `annotation-${cursor.annotationId}`
        : `diff-row-${cursor.file}-${cursor.side}-${cursor.lineNumber}`;
    const scroll = cursor.kind === "card" ? centerChildInView : scrollChildIntoView;
    const handle = setTimeout(() => scroll(sb, targetId), 0);
    return (): void => clearTimeout(handle);
  }, [cursor, layout]);

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

  // Consume a pending post-submit scroll once the bundle-refresh re-render
  // mounts the new annotation card (PRD #234 / issue #237). The ref is set
  // by the `scrollToAnnotation` intent handler; this effect retries each
  // time `plannedRowsByFile` re-derives until the card appears in the DOM.
  // The cursor is intentionally NOT advanced onto the new card (PRD UX 26
  // r-after-a foot-gun protection); this is viewport-only.
  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (id === null) return;
    const sb = diffScrollRef.current;
    if (!sb) return;
    const targetId = `annotation-${id}`;
    if (!sb.content.findDescendantById(targetId)) return;
    scrollChildIntoView(sb, targetId);
    pendingScrollIdRef.current = null;
  }, [annotations, plannedRowsByFile]);

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
  // pressing it. Off-screen suffix uses the diff-pane scrollbox viewport
  // mapped onto the flat-row index space — the line-height isn't fixed
  // so we approximate by comparing the cursor's row index to the rough
  // visible range. When the scrollbox isn't ready, the suffix is
  // omitted.
  const viewportRange = ((): { start: number; end: number } | undefined => {
    const sb = diffScrollRef.current;
    if (!sb || flatRowsList.length === 0) return undefined;
    // Approximate: contentHeight / flatRows ≈ avg row height. The
    // approximation is fine for off-screen detection — direction is
    // what matters, not the precise boundary.
    const total = flatRowsList.length;
    const avg = sb.scrollHeight > 0 ? sb.scrollHeight / total : 1;
    if (avg === 0) return undefined;
    const start = Math.max(0, Math.floor(sb.scrollTop / avg));
    const end = Math.min(total, Math.ceil((sb.scrollTop + sb.viewport.height) / avg));
    return { start, end };
  })();
  const footerPreview = composeFooterPreview({
    cursor,
    annotations,
    viewportRange,
    cursorRowIdx: cursorSlice?.rowIdx ?? -1,
  });
  const baseFooter = `${footerPreview}  ·  ${footerHints}`;
  const footer = footerStatus ? `${baseFooter}  ·  ${footerStatus}` : baseFooter;

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

  // Refs used by the intent listener to read the latest substrate-derived
  // state without re-registering the listener on every render. Updated
  // inline below as each value is computed.
  const cursorRef = useRef<Cursor | null>(cursor);
  cursorRef.current = cursor;
  const flatRowsRef = useRef<ReadonlyArray<FlatRow>>(flatRowsList);
  flatRowsRef.current = flatRowsList;
  const filesRef = useRef<ReadonlyArray<BundleFile>>(files);
  filesRef.current = files;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const collapsedFoldersRef = useRef<Set<string>>(collapsedFolders);
  collapsedFoldersRef.current = collapsedFolders;
  const annotationCountsRef = useRef<Readonly<Record<string, number>>>(annotationCounts);
  annotationCountsRef.current = annotationCounts;
  const safeRowIdxRef = useRef<number>(safeRowIdx);
  safeRowIdxRef.current = safeRowIdx;

  // Intent listener — realizes the reducer's emitted intents in the TUI
  // substrate (PRD #207 slice 1 + slice 2 contract). `loadTour` performs
  // the in-process bundle reload then dispatches `tour.switched` (which
  // drives the reducer's bundle/picker/replyLock/cursor/expansion reset
  // cascade — cursor + expansion landed in the reducer with slice 2,
  // issue #230). `scrollPickerRow` scrolls the picker modal scrollbox.
  // `revalidateCursor` runs `validateCursor` against the substrate-derived
  // flat-rows and dispatches `cursor.set` / `cursor.clear`.
  // `scrollCursorTarget` scrolls the diff pane via `scrollChildIntoView` /
  // `centerChildInView`. `revealSidebarFile` reveals the file's ancestors
  // and selects its row in the sidebar tree. `mirrorUrl` and `mirrorAnnUrl`
  // are ignored — the TUI has no URL.
  useEffect(() => {
    let unmounted = false;
    const unsubscribe = store.onIntent((intent) => {
      if (intent.type === "loadTour") {
        const tourId = intent.tourId;
        if (!props.loadTour) return;
        if (tourId === bundle.tour.id) {
          // Same-tour Enter: keymap short-circuited to picker.close, so
          // this branch is defensive against direct loadTour intents from
          // future call sites.
          return;
        }
        (async () => {
          try {
            const next = await props.loadTour!(tourId);
            if (unmounted) return;
            // Sidebar row index is the only CONTEXT-pinned Tour-switch
            // reset still hand-rolled — sidebar selection is surface-
            // specific (derivable from cursor) and out of scope for the
            // store per PRD #234. Every other reset (cursor, expansion,
            // composer, folds + overrides, replyLock, picker, bundle)
            // lands in the reducer's `tour.switched` branch.
            setSelectedRowIdx(0);
            // Drive the reducer's `tour.switched` cascade — bundle is
            // replaced; picker closes (defensively; commit already closed
            // it); replyLock resets to idle; cursor resets to null;
            // expansion resets to empty; composer → closed; folds →
            // empty.
            store.dispatch({ type: "tour.switched", tourId, bundle: next });
            // Re-seed orphan windows from the new tour's files post-switch
            // so Annotations whose anchor lives in Hidden context render
            // inline on first paint of the new tour.
            if (next.kind === "ok") {
              store.dispatch({
                type: "expansion.seedFromOrphans",
                windows: flattenOrphanWindows(next.files),
              });
            }
            // Reply-lock fetch for the new tour. Must dispatch AFTER
            // `tour.switched` (which resets replyLock to idle) so the
            // freshly-loaded lock isn't clobbered.
            if (props.loadReplyLock) {
              try {
                const lock = await props.loadReplyLock(tourId);
                if (!unmounted) {
                  store.dispatch({ type: "replyLock.loaded", replyLock: lock });
                }
              } catch {
                if (!unmounted) {
                  store.dispatch({ type: "replyLock.loaded", replyLock: null });
                }
              }
            } else {
              store.dispatch({ type: "replyLock.loaded", replyLock: null });
            }
          } catch (e) {
            if (unmounted) return;
            const error = e instanceof Error ? e.message : String(e);
            store.dispatch({ type: "bundle.failed", tourId, error });
          }
        })();
        return;
      }
      if (intent.type === "scrollPickerRow") {
        const sb = pickerScrollRef.current;
        if (!sb) return;
        scrollChildIntoView(sb, `picker-row-${intent.idx}`);
        return;
      }
      if (intent.type === "revalidateCursor") {
        const c = cursorRef.current;
        if (c === null) return;
        const validated = validateCursor(c, flatRowsRef.current, filesRef.current);
        if (validated !== c) dispatchAnchorOrClear(validated);
        return;
      }
      if (intent.type === "scrollCursorTarget") {
        const sb = diffScrollRef.current;
        if (!sb) return;
        if (intent.target.kind === "card") {
          centerChildInView(sb, `annotation-${intent.target.annotationId}`);
        } else {
          const { file, side, lineNumber } = intent.target;
          scrollChildIntoView(sb, `diff-row-${file}-${side}-${lineNumber}`);
        }
        return;
      }
      if (intent.type === "revealSidebarFile") {
        const rowIdx = revealAndLocateFile(
          intent.file,
          treeRef.current,
          collapsedFoldersRef.current,
          annotationCountsRef.current,
        );
        if (rowIdx !== null && rowIdx !== safeRowIdxRef.current) {
          setSelectedRowIdx(rowIdx);
        }
        return;
      }
      if (intent.type === "submitAnnotation") {
        if (!props.writeAnnotation) return;
        const { tourId, target, body } = intent;
        // Empty bodies (or whitespace-only) are treated as cancel — same as
        // the prior surface-side trim check. The reducer transitioned us to
        // `submitting` already; flip back to `closed` rather than burning a
        // disk write. PRD #234 issue #237.
        if (body.trim().length === 0) {
          store.dispatch({ type: "composer.close" });
          return;
        }
        // Resolve the reply parent + attach the live bundle from the store,
        // not from a React closure, so a mid-composition watcher reload is
        // reflected. The shared `buildWriteAnnotationInput` enforces the
        // bundle field on the top-level payload at compile time — pre-fix
        // this construction silently dropped `bundle`, the writer crashed
        // on `undefined.kind` in `validateAnchor`, and the user saw the
        // composer vanish with no error. Issue #254.
        const live = store.getState();
        const liveBundle = isBundleResolved(live);
        if (!liveBundle) {
          // Bundle slice is idle / loading / failed — the composer must
          // have opened against a resolved tour, so this is a watcher race
          // with a `bundle.failed` between open and submit. Surface as a
          // failure rather than calling the writer with no bundle.
          store.dispatch({
            type: "composer.failed",
            error: "Tour bundle is no longer loaded",
          });
          return;
        }
        const built = buildWriteAnnotationInput({
          target,
          body,
          bundle: liveBundle,
        });
        if (built.kind === "parent-missing") {
          // Parent vanished mid-composition (rare — watcher reload deleted
          // the annotation between open and submit). Surface as a failure
          // and bail out before calling the writer.
          store.dispatch({
            type: "composer.failed",
            error: "Parent annotation no longer exists",
          });
          return;
        }
        const input = built.input;
        (async () => {
          try {
            const created = await props.writeAnnotation!(tourId, input);
            if (unmounted) return;
            store.dispatch({ type: "composer.submitted", annotation: created });
            // The CLI's `tour annotate` would let the watcher re-render. The
            // TUI path skips the watcher loop and reloads the bundle directly
            // so the new entry shows up immediately on submit. Same-tour
            // refresh — dispatch `bundle.refreshed` (issue #211), NOT
            // `tour.switched`, so the picker / replyLock survive a composer
            // submit. Re-seed orphan windows BEFORE `bundle.refreshed` so the
            // reducer's `revalidateCursor` intent fires against the freshly-
            // seeded expansion slice.
            if (!props.loadTour) return;
            try {
              const refreshed = await props.loadTour(tourId);
              if (unmounted) return;
              if (refreshed.kind === "ok") {
                store.dispatch({
                  type: "expansion.seedFromOrphans",
                  windows: flattenOrphanWindows(refreshed.files),
                });
              }
              store.dispatch({ type: "bundle.refreshed", bundle: refreshed });
            } catch {
              // transient — keep current bundle
            }
          } catch (e) {
            if (unmounted) return;
            const error = e instanceof Error ? e.message : String(e);
            store.dispatch({ type: "composer.failed", error });
          }
        })();
        return;
      }
      if (intent.type === "scrollToAnnotation") {
        // Post-submit scroll: the intent fires synchronously inside the
        // `composer.submitted` dispatch, which precedes the
        // `bundle.refreshed` dispatch in this listener's submitAnnotation
        // flow — so the freshly-created card may not be in the DOM yet.
        // Stash the id; the retry useEffect on plannedRowsByFile picks it
        // up once the bundle-refresh re-render lands the card.
        pendingScrollIdRef.current = intent.annotationId;
        return;
      }
      // mirrorUrl + mirrorAnnUrl: TUI has no URL — ignored.
    });
    return () => {
      unmounted = true;
      unsubscribe();
    };
    // store / props.loadTour / props.loadReplyLock are stable for the
    // TUI's CLI invocation; bundle.tour.id is read inside the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, props.loadTour, props.loadReplyLock, bundle.tour.id]);

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
    // Sidebar reveal flows through the reducer's `revealSidebarFile`
    // intent (emitted on cross-file `cursor.set` for RowAnchors).
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
    // Sidebar reveal flows through the reducer's `revealSidebarFile`
    // intent (emitted on cross-file `cursor.set` for RowAnchors).
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
  // PRD #151: mid-file hunk-header Enter is direction-aware — large gaps
  // (remaining > 2N = 40) expand the bottom of the gap (lines appear
  // above the @@); small gaps (≤ 40) expand symmetrically. gap-mid-top
  // expands the top of the gap (lines appear adjacent to the previous
  // hunk's content). Same `ref: hunkIndex` boundary key as the existing
  // hunk-separator; direction control via the `direction` param.
  const expandHunkBoundary = (file: string, boundaryRef: BoundaryRef, all: boolean) => {
    if (typeof boundaryRef !== "number") return;
    const gapSize = hunkSeparatorGapSize(file, boundaryRef);
    if (gapSize === 0) return;
    const cur = getBoundary(expansion, { file, ref: boundaryRef });
    const remaining = gapSize - cur.up - cur.down;
    if (remaining <= 0) return;
    const direction = remaining > GAP_TWO_ROW_THRESHOLD ? "down" : "both";
    store.dispatch({
      type: "expansion.expand",
      file,
      ref: boundaryRef,
      direction,
      mode: all ? "all" : "symmetric-20",
      gapSize,
    });
  };
  const expandGapMidTop = (file: string, boundaryRef: BoundaryRef, all: boolean) => {
    if (typeof boundaryRef !== "number") return;
    const gapSize = hunkSeparatorGapSize(file, boundaryRef);
    if (gapSize === 0) return;
    store.dispatch({
      type: "expansion.expand",
      file,
      ref: boundaryRef,
      direction: "up",
      mode: all ? "all" : "symmetric-20",
      gapSize,
    });
  };
  const expandTopBoundary = (file: string, all: boolean) => {
    const gapSize = boundaryTopGapSize(file);
    if (gapSize === 0) return;
    store.dispatch({
      type: "expansion.expandTop",
      file,
      mode: all ? "all" : "symmetric-20",
      gapSize,
    });
  };
  const expandBottomBoundary = (file: string, all: boolean) => {
    const gapSize = boundaryBottomGapSize(file);
    if (gapSize === 0) return;
    store.dispatch({
      type: "expansion.expandBottom",
      file,
      mode: all ? "all" : "symmetric-20",
      gapSize,
    });
  };
  // Enter on a synthetic CollapsedFileRow flips fileExpanded → planner
  // emits the file's normal diff body next render (PRD #108 issue #113).
  // One-way; re-collapse goes through the parallel `c` toggle.
  const expandCollapsedFile = (file: string) => {
    store.dispatch({ type: "expansion.expandFile", file });
  };

  // Routes a primary-action / primary-action-all keystroke to the row-kind-
  // specific handler. Pure dispatch table — the actual expansion behaviour
  // lives in the stubs above.
  const dispatchPrimaryAction = (all: boolean) => {
    if (!cursor || cursor.kind !== "row" || !cursor.interactive) return;
    const { subKind, boundaryRef } = cursor.interactive;
    switch (subKind) {
      case "hunk-separator":
        expandHunkBoundary(cursor.file, boundaryRef, all);
        return;
      case "gap-mid-top":
        expandGapMidTop(cursor.file, boundaryRef, all);
        return;
      case "boundary-top":
        expandTopBoundary(cursor.file, all);
        return;
      case "boundary-bottom":
        expandBottomBoundary(cursor.file, all);
        return;
      case "collapsed-file":
        expandCollapsedFile(cursor.file);
        return;
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
  // The dispatch itself is fire-and-forget — the watcher's lock + bundle
  // events drive the in-flight pill and the landed Reply into view.
  const sendCurrentToAgent = () => {
    if (!props.cwd || !props.replyAgent) return;
    // `s` is card-only (PRD #192 / ADR 0022). The keymap gates the
    // row case to a footer-hint no-op; this defends in depth.
    if (!cursorCardAnnotation) {
      setFooterStatus("no annotation under cursor — n/p to navigate");
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
    // Auto-recall (PRD #192 user story 14): pull the focused card into
    // view before dispatching so the user sees the card the agent is
    // about to act on when the next render lands. The card the cursor
    // is on (top-level) is the anchor — the leaf is rendered inline
    // inside the same card's Thread.
    const sb = diffScrollRef.current;
    if (sb) scrollChildIntoView(sb, `annotation-${cursorCardAnnotation.id}`);
    void requestReply({
      cwd: props.cwd,
      tourId: bundle.tour.id,
      annotationId: sendTargetVal.leafId,
      agent: props.replyAgent,
    }).catch(() => {
      // transient — the watcher's reload will surface any state change
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
      if (key.ctrl || key.shift) return;
      if (key.name === "escape" || key.name === "t") {
        store.dispatch({ type: "picker.close" });
        return;
      }
      if (key.name === "j" || key.name === "down") {
        store.dispatch({ type: "picker.move", delta: 1 });
        return;
      }
      if (key.name === "k" || key.name === "up") {
        store.dispatch({ type: "picker.move", delta: -1 });
        return;
      }
      if (key.name === "return") {
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
        setSidebarFocused(false);
        if (diffScrollRef.current) {
          scrollChildIntoView(diffScrollRef.current, `file-card-${selectedRow.path}`);
        }
        // PRD US 20: explicit sidebar-driven file selection moves the
        // cursor to that file's first annotatable row. Folded files
        // contribute no rows so cursor clears. currentAnnotationId is
        // unchanged — annotation focus is independent of code-reading
        // position.
        dispatchCursor(cursorAtFirstFileRow(selectedRow.path, flatRowsList));
        return;
      }
      case "toggle-collapse": {
        if (selectedRow?.kind !== "file") return;
        const f = selectedRow.file;
        const cls = fileClassification(classifications, f.name);
        if (cls.reason === "binary") return;
        store.dispatch({
          type: "folds.setOverride",
          file: f.name,
          value: !isFileCollapsed(f.name),
        });
        return;
      }
      case "toggle-folder": {
        if (selectedRow?.kind !== "folder") return;
        store.dispatch({ type: "folds.toggleFolder", path: selectedRow.path });
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
      case "toggle-layout":
        store.dispatch({
          type: "layout.set",
          layout: layout === "split" ? "unified" : "split",
        });
        return;
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
          sb.scrollTo(result.scrollTop);
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
        dispatchPrimaryAction(false);
        return;
      case "primary-action-all":
        dispatchPrimaryAction(true);
        return;
      case "noop-reply-on-row":
        setFooterStatus("r: no annotation under cursor — n/p to navigate");
        return;
      case "noop-send-on-row":
        setFooterStatus("s: no annotation under cursor — n/p to navigate");
        return;
      case "noop-comment-on-card":
        setFooterStatus("a: on a card — j/k to land on a row first");
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
        selectedPath={selectedRow?.path}
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
          width={SIDEBAR_WIDTH}
          borderStyle="single"
          borderColor={sidebarFocused ? theme.border.accent : theme.border.default}
          title=" Files "
          flexDirection="column"
          onMouseDown={() => setSidebarFocused(true)}
        >
          <scrollbox ref={sidebarScrollRef} height="100%">
            {visibleRows.map((row, idx) => {
              const isSelected = idx === safeRowIdx;
              const bg = isSelected ? theme.bg.accentCursor.tui : undefined;
              const onRowMouseDown = () => {
                setSidebarFocused(true);
                setSelectedRowIdx(idx);
                if (row.kind === "file") {
                  if (diffScrollRef.current) {
                    scrollChildIntoView(diffScrollRef.current, `file-card-${row.path}`);
                  }
                  // Same semantics as the select-file action above (PRD
                  // US 20): clicking a file in the sidebar expresses "show
                  // me from the top." A folded click yields null since
                  // the file contributes no flat rows.
                  dispatchCursor(cursorAtFirstFileRow(row.path, flatRowsList));
                }
              };
              if (row.kind === "folder") {
                return (
                  <text
                    key={`d:${row.path}`}
                    id={`row-${row.path}`}
                    fg={theme.fg.muted}
                    bg={bg}
                    bold={isSelected}
                    selectable={false}
                    onMouseDown={onRowMouseDown}
                  >
                    {folderRowLabel(row, SIDEBAR_CONTENT_WIDTH - folderRowFixedCost(row))}
                  </text>
                );
              }
              return (
                <text
                  key={`f:${row.path}`}
                  id={`row-${row.path}`}
                  fg={theme.fg.default}
                  bg={bg}
                  bold={isSelected}
                  selectable={false}
                  onMouseDown={onRowMouseDown}
                >
                  {fileRowLabel(row, SIDEBAR_CONTENT_WIDTH - fileRowFixedCost(row))}
                </text>
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
          {view.kind === "ok" && bundle.kind === "ok" && bundle.diff && (
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
                    flexDirection="column"
                    marginBottom={1}
                  >
                    <text>{fileEntryLabel(file, classifications, annotations)}</text>
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
                    )}
                  </box>
                );
              })}
            </scrollbox>
          )}
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
