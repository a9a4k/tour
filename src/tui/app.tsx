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
import type { DiffFile, FileDiffMetadata } from "../core/diff-model.js";
import { parseFileDiffMetadata } from "../core/diff-model.js";
import type { PlannedRow } from "../core/diff-rows.js";
import { planRows, GAP_TWO_ROW_THRESHOLD } from "../core/diff-rows.js";
import {
  emptyExpansion,
  expand,
  expandTop,
  expandBottom,
  expandFile,
  getBoundary,
  seedFromOrphans,
  type ExpansionState,
  type OrphanWindow,
} from "../core/expansion-state.js";
import type { FileContentPair } from "../core/file-content-provider.js";
import type { TourBundle, BundleFile } from "../core/tour-bundle.js";
import { DiffRows } from "./DiffRows.js";
import type { FileClassification } from "../core/file-classifier.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  revealAndLocate,
  sortFilesForStream,
  type VisibleRow,
} from "../core/file-tree.js";
import { buildPickerRows, type PickerRow } from "../core/tour-list.js";
import { theme } from "../core/theme.js";
import { dispatchKey } from "./keymap.js";
import { TourPicker } from "./TourPicker.js";
import { TopHeaderTui } from "./TopHeader.js";
import { Composer } from "./Composer.js";
import {
  buildReplyComposer,
  buildTopLevelComposer,
  type ComposerState,
} from "./composer-state.js";
import { createComposerSubmitter } from "./composer-submit.js";
import { topLevelAnnotations } from "../core/threads.js";
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
import { flatRows, type FlatRow } from "../core/flat-rows.js";
import {
  initialCursor,
  moveCursor,
  nextCard,
  prevCard,
  setCursorSide,
  validateCursor,
  cursorFromAnnotation,
  cursorAtFirstFileRow,
  cursorOnInteractive,
  resolveCursorRowIdx,
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

export type WriteAnnotationInput =
  | {
      kind: "top-level";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
      body: string;
    }
  | { kind: "reply"; parent: Annotation; body: string };

interface AppProps {
  bundle: TourBundle;
  replyLock?: ReplyLock | null;
  loadTour?: (id: string) => Promise<TourBundle>;
  loadReplyLock?: (id: string) => Promise<ReplyLock | null>;
  loadTours?: () => Promise<{ tours: Tour[]; annotationCounts: Record<string, number> }>;
  writeAnnotation?: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
  cwd?: string;
  replyAgent?: string;
}

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
  rows: PlannedRow[],
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
  repliesCollapsed: boolean,
  replyLock: ReplyLock | null,
  now: number,
  navIndexById: Map<string, number>,
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
  const [bundle, setBundle] = useState<TourBundle>(props.bundle);
  const [replyLock, setReplyLock] = useState<ReplyLock | null>(props.replyLock ?? null);
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const [repliesCollapsed, setRepliesCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCursor, setPickerCursor] = useState(0);
  const [pickerTours, setPickerTours] = useState<Tour[]>([]);
  const [pickerCounts, setPickerCounts] = useState<Record<string, number>>({});
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  // Footer status line that flashes after an `s` no-op so the user knows
  // why the keystroke didn't dispatch. Cleared by any subsequent key.
  const [footerStatus, setFooterStatus] = useState<string | null>(null);
  // After a top-level annotate-submit, holds the id of the freshly-created
  // Annotation until the post-submit effect scrolls its card into view.
  // The cursor is intentionally NOT advanced onto the new card (PRD UX 26
  // r-after-a foot-gun protection); this is viewport-only.
  const [pendingScrollAnnotationId, setPendingScrollAnnotationId] =
    useState<string | null>(null);
  // Hidden-context expansion state (PRD #108, ADR 0013). Per-tour, in-memory
  // only. Reset on tour switch (sibling to collapsedOverrides), preserved on
  // watcher reload (the diff is SHA-pinned; gaps are unchanged).
  // Seeded at planner-init with orphan-annotation auto-windows (issue #114) so
  // Annotations whose anchor lives in Hidden context render inline with `±10`
  // lines of surrounding context the moment a tour opens.
  const [expansion, setExpansion] = useState<ExpansionState>(() =>
    seedFromOrphans(
      emptyExpansion(),
      props.bundle.kind === "ok" ? flattenOrphanWindows(props.bundle.files) : [],
    ),
  );
  const renderer = useRenderer();
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sidebarScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // First-paint-per-tour guard for the side effects that ride alongside the
  // cursor: revealAndLocate the first annotation's file in the sidebar tree
  // and drop sidebar focus so j/k routes to the diff pane (issue #132
  // revision). The cursor itself stays null until the user's first
  // interaction (PRD #192 US 25 — no visible cursor on tour load).
  const seededTourIdRef = useRef<string | null>(null);

  const liveTour = bundle.tour;
  const liveAnnotations = bundle.annotations;
  const liveDiff = bundle.kind === "ok" ? bundle.diff : "";
  const liveSnapshotLost = bundle.kind === "snapshot-lost";
  const liveFiles: DiffFile[] = bundle.kind === "ok" ? bundle.files : [];
  const liveClassifications = useMemo<Record<string, FileClassification>>(() => {
    if (bundle.kind !== "ok") return {};
    const out: Record<string, FileClassification> = {};
    for (const f of bundle.files) out[f.name] = f.classification;
    return out;
  }, [bundle]);
  const liveFileContents = useMemo<Map<string, FileContentPair>>(() => {
    if (bundle.kind !== "ok") return new Map();
    const out = new Map<string, FileContentPair>();
    for (const f of bundle.files) {
      if (typeof f.oldContent === "string" && typeof f.newContent === "string") {
        out.set(f.name, { oldContent: f.oldContent, newContent: f.newContent });
      }
    }
    return out;
  }, [bundle]);
  const liveReplyLock = replyLock;
  const liveTopLevel = useMemo(() => topLevelAnnotations(liveAnnotations), [liveAnnotations]);
  // 1-based nav-order index per top-level annotation id, for rendering the
  // `i / n` counter in each AnnotationCard header (mirrors webapp).
  const navIndexById = useMemo(() => {
    const m = new Map<string, number>();
    liveTopLevel.forEach((a, i) => m.set(a.id, i + 1));
    return m;
  }, [liveTopLevel]);
  const navTotal = liveTopLevel.length;

  // Wall clock used by the in-flight pill to render "(Ns)". Ticks once per
  // second only when a lock is present so we don't burn renders on the idle
  // path.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!liveReplyLock) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [liveReplyLock]);

  // Per-tour file watcher: drives the bundle reload (so newly-written
  // Annotations show up) and the reply-lock state (so the in-flight pill
  // appears and disappears). The watcher's role is state observation only;
  // reply-agent dispatch is now explicit — pressing `s` calls
  // `requestReply` in-process (ADR 0021, issue #184). Inert when no
  // loadTour is wired.
  useEffect(() => {
    if (!props.cwd || !props.loadTour) return;
    const watcher = new TourWatcher(props.cwd, liveTour.id);

    let cancelled = false;
    const reload = async () => {
      if (!props.loadTour || cancelled) return;
      try {
        const next = await props.loadTour(liveTour.id);
        if (cancelled) return;
        setBundle(next);
        // Re-seed orphan windows on watcher reload (annotations may have
        // changed; orphan windows recompute). seedFromOrphans unions per-side
        // by max so manually expanded user state is preserved (issue #114).
        if (next.kind === "ok") {
          setExpansion((prev) => seedFromOrphans(prev, flattenOrphanWindows(next.files)));
        }
      } catch {
        // transient — keep current bundle
      }
    };
    const reloadLock = async () => {
      if (!props.loadReplyLock || cancelled) return;
      try {
        const next = await props.loadReplyLock(liveTour.id);
        if (cancelled) return;
        setReplyLock(next);
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
  }, [liveTour.id, props.cwd, props.loadTour]);

  const files = useMemo(
    () => sortFilesForStream(liveFiles),
    [liveFiles],
  );

  const tree = useMemo(() => compress(buildTree(liveFiles)), [liveFiles]);

  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of liveAnnotations) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [liveAnnotations]);

  const visibleRows = useMemo<VisibleRow<DiffFile>[]>(
    () => flatten(tree, collapsedFolders, annotationCounts),
    [tree, collapsedFolders, annotationCounts],
  );

  const safeRowIdx = visibleRows.length === 0
    ? 0
    : Math.min(Math.max(0, selectedRowIdx), visibleRows.length - 1);
  const selectedRow: VisibleRow<DiffFile> | undefined = visibleRows[safeRowIdx];

  const fileMetadata = useMemo(() => {
    const out = new Map<string, FileDiffMetadata>();
    for (const meta of parseFileDiffMetadata(liveDiff)) out.set(meta.name, meta);
    return out;
  }, [liveDiff]);

  // Returns true when the planner should emit a synthetic CollapsedFileRow
  // in place of this file's diff body (PRD #108 issue #113). Mirror of the
  // legacy isFileCollapsed-without-annotations rule, but kept distinct so
  // the App can route the body to DiffRows always (the synthetic row IS
  // the affordance the user clicks Enter on).
  const isClassifierCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides[fileName];
    if (override === false) return false;
    const cls = fileClassification(liveClassifications, fileName);
    if (!cls.collapsed) return false;
    if (cls.reason === "binary") return false;
    const hasAnnotations = liveAnnotations.some((a) => a.file === fileName);
    if (hasAnnotations) return false;
    return true;
  };

  const plannedRowsByFile = useMemo(() => {
    const out = new Map<string, PlannedRow[]>();
    for (const [name, meta] of fileMetadata) {
      const fileAnns = liveAnnotations.filter((a) => a.file === name);
      const contents = liveFileContents.get(name);
      out.set(
        name,
        planRows(meta, fileAnns, layout, {
          oldContent: contents?.oldContent,
          newContent: contents?.newContent,
          expansion,
          classifierCollapsed: isClassifierCollapsed(name),
        }),
      );
    }
    return out;
    // isClassifierCollapsed reads from the deps below — listed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fileMetadata,
    liveAnnotations,
    layout,
    liveFileContents,
    expansion,
    collapsedOverrides,
    liveClassifications,
  ]);

  // Body-level visibility (binary placeholder + user-driven `c` collapse).
  // A classifier-collapsed (non-binary) file is NOT body-collapsed any
  // longer — its body always renders and the planner emits the synthetic
  // CollapsedFileRow inside. `c` on a classifier-collapsed file thus
  // toggles between "synthetic row visible" and "body hidden entirely".
  const isFileCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides[fileName];
    if (override !== undefined) return override;
    const cls = fileClassification(liveClassifications, fileName);
    return cls.reason === "binary";
  };

  // Cross-file flat row sequence the line cursor walks (ADR 0011). Skips
  // hunk-headers, annotation rows, and folded files. Re-derives whenever
  // the underlying diff, layout, or fold state changes — the cursor's
  // anchor is invariant across this re-derivation; only its resolved
  // viewport index moves.
  const flatRowsList = useMemo<FlatRow[]>(
    () => flatRows(files, plannedRowsByFile, isFileCollapsed),
    // isFileCollapsed is a fresh closure per render but its observable
    // output is fully determined by the listed state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, plannedRowsByFile, collapsedOverrides, liveClassifications, liveAnnotations],
  );

  // Tour-open per-tour side effects (PRD #192 / ADR 0022): the cursor
  // itself stays null until the user's first interaction (lazy
  // materialization, US 25). Tour-open still drops sidebar focus when
  // annotations exist (issue #132 revision) and reveals the first
  // annotation's file in the tree so the next j/k or n/p lands on
  // visible material. Empty tours keep the default sidebar focus
  // (nothing to read; tree is the right anchor).
  useEffect(() => {
    if (seededTourIdRef.current !== liveTour.id) {
      seededTourIdRef.current = liveTour.id;
      if (liveTopLevel.length === 0) return;
      const first = liveTopLevel[0];
      setSidebarFocused(false);
      const located = revealAndLocate(tree, collapsedFolders, annotationCounts, first.file);
      if (!located) return;
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      setSelectedRowIdx(located.rowIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTopLevel, liveTour.id]);

  // Validate the cursor in place when the row sequence shifts under it
  // (fold toggle, bundle reload, layout change). For a RowAnchor: anchor
  // preserved when it still resolves; snapped to file's first row when
  // the specific row vanishes; snapped to next file in stream order when
  // the file is gone; null when no row remains. For a CardAnchor:
  // preserved when its annotationId is still in the flat-row stream;
  // null otherwise (cards have no fallback row, PRD #192).
  useEffect(() => {
    if (cursor === null) return;
    const validated = validateCursor(cursor, flatRowsList, files);
    if (validated !== cursor) setCursor(validated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRowsList, liveTopLevel]);

  // Keep the cursor's row visible. A RowAnchor scrolls its diff/interactive
  // row with `block:nearest`; a CardAnchor centres its card in the viewport
  // (matches the prior `currentAnnotationId` UX from PRD #126, issue #128
  // — cards always get context above and below). `layout` is in deps so a
  // Shift-L flip — which preserves the anchor but moves the visual
  // position — re-fires the scroll.
  useEffect(() => {
    if (!diffScrollRef.current || !cursor) return;
    if (cursor.kind === "card") {
      centerChildInView(diffScrollRef.current, `annotation-${cursor.annotationId}`);
      return;
    }
    // Culling-safe helper: under `viewportCulling={true}` opentui leaves
    // stale positions inside off-screen file subtrees, and a cross-file
    // `n`/`p` jump lands on the previous file otherwise.
    scrollChildIntoView(
      diffScrollRef.current,
      `diff-row-${cursor.file}-${cursor.side}-${cursor.lineNumber}`,
    );
  }, [cursor, layout]);

  // Sidebar follows the cursor's file. RowAnchor → cursor.file directly.
  // CardAnchor → annotation.file resolved from the bundle. The deps key
  // off the resolved file so in-file j/k motion leaves the sidebar
  // untouched — sidebar selection is a per-file affordance, not a
  // per-row one.
  const cursorFile = useMemo<string | null>(() => {
    if (!cursor) return null;
    if (cursor.kind === "row") return cursor.file;
    const ann = liveAnnotations.find((a) => a.id === cursor.annotationId);
    return ann ? ann.file : null;
  }, [cursor, liveAnnotations]);
  useEffect(() => {
    if (!cursorFile) return;
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, cursorFile);
    if (!located) return;
    if (located.collapsedFolders !== collapsedFolders) {
      setCollapsedFolders(located.collapsedFolders as Set<string>);
    }
    if (located.rowIdx !== safeRowIdx) {
      setSelectedRowIdx(located.rowIdx);
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

  // Scroll a freshly-created top-level Annotation into view (issue #150,
  // PRD #148). Fires once per successful create — the cursor is
  // intentionally untouched (PRD UX 26 r-after-a foot-gun protection).
  // `nearest` semantics from scrollChildIntoView mean already-visible
  // cards do not move. The effect waits for the card's box to mount;
  // the bundle-reload re-render brings it into the scrollbox content
  // tree, after which the pending id is cleared.
  useEffect(() => {
    if (!pendingScrollAnnotationId) return;
    const sb = diffScrollRef.current;
    if (!sb) return;
    const targetId = `annotation-${pendingScrollAnnotationId}`;
    if (!sb.content.findDescendantById(targetId)) return;
    scrollChildIntoView(sb, targetId);
    setPendingScrollAnnotationId(null);
  }, [pendingScrollAnnotationId, liveAnnotations, plannedRowsByFile]);

  // Derived: the cursor's card target (PRD #192 / ADR 0022). When the
  // cursor is on a card, the target is that card's id; when on a row
  // (or null), there is no card target — `r`/`s` are no-ops with a
  // footer hint.
  const cursorCardId: string | null =
    cursor && cursor.kind === "card" ? cursor.annotationId : null;
  const cursorCardAnnotation =
    cursorCardId !== null
      ? liveAnnotations.find((a) => a.id === cursorCardId) ?? null
      : null;
  // 1-based nav index of the cursor's card in the top-level list, or
  // -1 when there is no card target. The top-header pill renders
  // `—/M` when -1 (kind === "row" or null cursor); index is 1-based
  // for human readability.
  const cursorCardNavIdx =
    cursorCardId !== null
      ? liveTopLevel.findIndex((a) => a.id === cursorCardId)
      : -1;

  // Show the `s: send to {agent}` hint whenever `canSendToAgent.visible`
  // is true — i.e. when the cursor's card is human-authored and
  // `--reply-agent` is set, regardless of the lock.
  const sendHintVerdict = cursorCardAnnotation
    ? canSendToAgent({
        replyAgentConfigured: !!props.replyAgent,
        lockHeld: liveReplyLock !== null,
        authorKind: cursorCardAnnotation.author_kind,
        hasReply: liveAnnotations.some(
          (a) => a.replies_to === cursorCardAnnotation.id,
        ),
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
  const cursorRowIdx = resolveCursorRowIdx(cursor, flatRowsList);
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
    annotations: liveAnnotations,
    viewportRange,
    cursorRowIdx,
  });
  const baseFooter = `${footerPreview}  ·  ${footerHints}`;
  const footer = footerStatus ? `${baseFooter}  ·  ${footerStatus}` : baseFooter;

  const pickerRows = useMemo(
    () =>
      buildPickerRows({
        tours: pickerTours,
        annotationCounts: pickerCounts,
        now: Date.now(),
      }),
    [pickerTours, pickerCounts],
  );

  const openPicker = async () => {
    if (pickerOpen) return;
    if (props.loadTours) {
      try {
        const { tours, annotationCounts: counts } = await props.loadTours();
        setPickerTours(tours);
        setPickerCounts(counts);
        const rows = buildPickerRows({ tours, annotationCounts: counts, now: Date.now() });
        setPickerCursor(initialPickerCursor(rows, liveTour.id));
      } catch {
        setPickerTours([]);
        setPickerCounts({});
        setPickerCursor(0);
      }
    } else {
      setPickerCursor(initialPickerCursor(pickerRows, liveTour.id));
    }
    setPickerOpen(true);
  };

  const closePicker = () => {
    setPickerOpen(false);
  };

  const commitTour = async (id: string) => {
    if (!props.loadTour) {
      closePicker();
      return;
    }
    if (id === liveTour.id) {
      closePicker();
      return;
    }
    try {
      const next = await props.loadTour(id);
      setBundle(next);
      if (props.loadReplyLock) {
        try {
          setReplyLock(await props.loadReplyLock(id));
        } catch {
          setReplyLock(null);
        }
      } else {
        setReplyLock(null);
      }
      setSelectedRowIdx(0);
      setCursor(null);
      setCollapsedOverrides({});
      setCollapsedFolders(new Set());
      // Reset expansion fresh, then seed from the new tour's orphan windows
      // (issue #114). Tour switch always wipes user-driven expansion per
      // CONTEXT.md guidance; orphan windows are part of the new tour's
      // planner-init state.
      setExpansion(
        seedFromOrphans(
          emptyExpansion(),
          next.kind === "ok" ? flattenOrphanWindows(next.files) : [],
        ),
      );
    } finally {
      closePicker();
    }
  };

  const jumpToAnnotation = (ann: Annotation) => {
    // Issue #132: explicit annotation jumps (n/p) drop sidebar focus so
    // subsequent j/k move the diff cursor, not the file row.
    setSidebarFocused(false);
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, ann.file);
    if (located) {
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      if (located.rowIdx !== safeRowIdx) {
        setSelectedRowIdx(located.rowIdx);
      }
    }
    setCollapsedOverrides((prev) => ({ ...prev, [ann.file]: false }));
    // PRD #192 / ADR 0022: n/p moves the unified cursor onto the
    // annotation's card directly — no synthesized row anchor.
    setCursor(cursorFromAnnotation(ann));
  };

  // gotoPrev/NextAnnotation walk the card lane via `nextCard` / `prevCard`
  // (PRD #192 / ADR 0022). When the cursor isn't a card, the walkers
  // pick the first / last card so the user can land on the nav target
  // with a single keystroke from any cursor state.
  const gotoPrevAnnotation = () => {
    const target = prevCard(cursor, flatRowsList);
    if (target) {
      const ann = liveAnnotations.find((a) => a.id === target.annotationId);
      if (ann) jumpToAnnotation(ann);
    }
  };

  const gotoNextAnnotation = () => {
    const target = nextCard(cursor, flatRowsList);
    if (target) {
      const ann = liveAnnotations.find((a) => a.id === target.annotationId);
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
    setCursor({ kind: "row", file, lineNumber, side, preferredSide: side });
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, file);
    if (located) {
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      if (located.rowIdx !== safeRowIdx) {
        setSelectedRowIdx(located.rowIdx);
      }
    }
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
    setCursor((prev) =>
      cursorOnInteractive({
        file,
        subKind,
        boundaryRef,
        preferredSide: prev && prev.kind === "row" ? prev.preferredSide : "additions",
      }),
    );
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, file);
    if (located) {
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      if (located.rowIdx !== safeRowIdx) {
        setSelectedRowIdx(located.rowIdx);
      }
    }
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
    const contents = liveFileContents.get(file);
    if (!contents?.newContent) return 0;
    const trimmed = contents.newContent.endsWith("\n")
      ? contents.newContent.slice(0, -1)
      : contents.newContent;
    const lineCount = trimmed === "" ? 0 : trimmed.split("\n").length;
    return Math.max(0, lineCount - lastEnd);
  };

  // Real expansion handlers (PRD #108). Replace the slice-#107 stubs with
  // reducer calls against the per-tour expansion state.
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
    setExpansion((s) =>
      expand(s, { file, ref: boundaryRef }, all ? "all" : "symmetric-20", gapSize, direction),
    );
  };
  const expandGapMidTop = (file: string, boundaryRef: BoundaryRef, all: boolean) => {
    if (typeof boundaryRef !== "number") return;
    const gapSize = hunkSeparatorGapSize(file, boundaryRef);
    if (gapSize === 0) return;
    setExpansion((s) =>
      expand(s, { file, ref: boundaryRef }, all ? "all" : "symmetric-20", gapSize, "up"),
    );
  };
  const expandTopBoundary = (file: string, all: boolean) => {
    const gapSize = boundaryTopGapSize(file);
    if (gapSize === 0) return;
    setExpansion((s) => expandTop(s, file, all ? "all" : "symmetric-20", gapSize));
  };
  const expandBottomBoundary = (file: string, all: boolean) => {
    const gapSize = boundaryBottomGapSize(file);
    if (gapSize === 0) return;
    setExpansion((s) => expandBottom(s, file, all ? "all" : "symmetric-20", gapSize));
  };
  // Enter on a synthetic CollapsedFileRow flips fileExpanded → planner
  // emits the file's normal diff body next render (PRD #108 issue #113).
  // One-way; re-collapse goes through the parallel `c` toggle.
  const expandCollapsedFile = (file: string) => {
    setExpansion((s) => expandFile(s, file));
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

  // Lazy materialization (ADR 0011 Revisions). Returns the seeded
  // cursor (or the existing one if already materialized) so the caller
  // can chain into composer-open / motion in one step. setCursor is
  // queued, so the returned value is what the caller should act on
  // this tick. Surface parity with src/web/client/App.tsx.
  const materializeCursor = (): Cursor | null => {
    if (cursor) return cursor;
    const seeded = initialCursor({
      topLevelAnnotations: liveTopLevel,
      flatRows: flatRowsList,
    });
    if (seeded) setCursor(seeded);
    return seeded;
  };

  const openTopLevelComposer = () => {
    const activeCursor = materializeCursor();
    // `a` is row-only (PRD #192 / ADR 0022). The keymap already gates a
    // card cursor to a footer-hint no-op; the App-shell composer call
    // here defends in depth so the user can't reach a mis-anchored
    // composer through state churn.
    if (activeCursor && activeCursor.kind === "card") return;
    const state = buildTopLevelComposer({
      cursor: activeCursor,
      currentAnnotation: cursorCardAnnotation,
    });
    if (!state) return;
    setComposer(state);
  };

  const openReplyComposer = () => {
    // `r` is card-only (PRD #192 / ADR 0022). When the cursor's card is
    // off-screen (wheel-scrolled away), pull it into view BEFORE the
    // composer mounts — the user sees the card on-screen when the next
    // render lands (auto-recall, PRD #192 user story 14).
    if (!cursorCardAnnotation) return;
    const sb = diffScrollRef.current;
    if (sb) scrollChildIntoView(sb, `annotation-${cursorCardAnnotation.id}`);
    const state = buildReplyComposer({ currentAnnotation: cursorCardAnnotation });
    if (!state) return;
    setComposer(state);
  };

  // Send the focused human Annotation to the configured reply-agent
  // (issue #184). `s` is a no-op with a footer hint when:
  //  - no annotation is focused (null cursor on the annotation list),
  //  - the current annotation is agent-authored / has a Reply / no agent,
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
    const current = cursorCardAnnotation;
    const hasReply = liveAnnotations.some((a) => a.replies_to === current.id);
    const verdict = canSendToAgent({
      replyAgentConfigured: true,
      lockHeld: liveReplyLock !== null,
      authorKind: current.author_kind,
      hasReply,
    });
    if (!verdict.enabled) {
      if (verdict.reason === "lock-held") {
        setFooterStatus(`${liveReplyLock?.agent ?? props.replyAgent} is replying — wait`);
      }
      // agent-card and already-replied both fall out of the visible set
      // (footer hint hidden), so pressing `s` on those is a silent no-op.
      return;
    }
    setFooterStatus(null);
    // Auto-recall (PRD #192 user story 14): pull an off-screen card into
    // view before dispatching so the user sees the card the agent is
    // about to act on when the next render lands.
    const sb = diffScrollRef.current;
    if (sb) scrollChildIntoView(sb, `annotation-${current.id}`);
    const cwd = props.cwd;
    const tourId = liveTour.id;
    const annotationId = current.id;
    const agent = props.replyAgent;
    void requestReply({ cwd, tourId, annotationId, agent }).catch(() => {
      // transient — the watcher's reload will surface any state change
    });
  };

  const cancelComposer = () => {
    setComposer(null);
  };

  // Stable across renders — the in-flight flag inside lives in the closure,
  // so a second Enter fired while the first submit is awaiting the write +
  // bundle reload is silently dropped (issue #159). The submitter also
  // dismisses the composer synchronously before the first await, which
  // unmounts the focused <input> on the next React render so most second-
  // Enter events never even reach this code path.
  const composerSubmitterRef = useRef(createComposerSubmitter());
  const submitComposer = (body: string) =>
    composerSubmitterRef.current({
      composer,
      body,
      tourId: liveTour.id,
      bundle,
      writeAnnotation: props.writeAnnotation,
      loadTour: props.loadTour,
      dismiss: () => setComposer(null),
      applyBundleReload: (refreshed) => {
        // The CLI's `tour annotate` would let the watcher re-render. The
        // TUI path skips the watcher loop and reloads the bundle directly
        // so the new entry shows up immediately on submit.
        setBundle(refreshed);
        if (refreshed.kind === "ok") {
          setExpansion((prev) =>
            seedFromOrphans(prev, flattenOrphanWindows(refreshed.files)),
          );
        }
      },
      applyTopLevelCreated: setPendingScrollAnnotationId,
    });

  useKeyboard((key) => {
    // Ctrl+D — opentui's built-in debug overlay. Shows FPS, frame time,
    // memory. Handle before composer/picker so it works even mid-edit.
    if (key.ctrl && key.name === "d") {
      renderer.toggleDebugOverlay();
      return;
    }
    if (composer) {
      // Esc cancels; Return / typing flows through to the focused <input>.
      if (key.name === "escape") {
        cancelComposer();
      }
      return;
    }
    if (pickerOpen) {
      if (key.ctrl || key.shift) return;
      if (key.name === "escape" || key.name === "t") {
        closePicker();
        return;
      }
      if (key.name === "j" || key.name === "down") {
        setPickerCursor((c) => Math.min(pickerRows.length - 1, c + 1));
        return;
      }
      if (key.name === "k" || key.name === "up") {
        setPickerCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.name === "return") {
        const r = pickerRows[pickerCursor];
        if (r) void commitTour(r.id);
        return;
      }
      return;
    }

    const action = dispatchKey(
      { name: key.name, ctrl: key.ctrl, shift: key.shift },
      {
        sidebarFocused,
        rowCount: visibleRows.length,
        selectedRowKind: selectedRow?.kind ?? null,
        cursorOnInteractive: cursor?.kind === "row" && cursor.interactive != null,
        cursorOnCard: cursor?.kind === "card",
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
        setSelectedRowIdx((i) => Math.min(i + 1, visibleRows.length - 1));
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
        // contribute no rows so cursor goes null. currentAnnotationId is
        // unchanged — annotation focus is independent of code-reading
        // position.
        setCursor(cursorAtFirstFileRow(selectedRow.path, flatRowsList));
        return;
      }
      case "toggle-collapse": {
        if (selectedRow?.kind !== "file") return;
        const f = selectedRow.file;
        const cls = fileClassification(liveClassifications, f.name);
        if (cls.reason === "binary") return;
        setCollapsedOverrides((prev) => ({
          ...prev,
          [f.name]: !isFileCollapsed(f.name),
        }));
        return;
      }
      case "toggle-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        setCollapsedFolders((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        return;
      }
      case "expand-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        setCollapsedFolders((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        return;
      }
      case "collapse-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        setCollapsedFolders((prev) => {
          if (prev.has(path)) return prev;
          const next = new Set(prev);
          next.add(path);
          return next;
        });
        return;
      }
      case "collapse-parent": {
        if (selectedRow?.kind !== "file") return;
        const ancestors = revealAncestors(tree, selectedRow.path);
        if (ancestors.length === 0) return;
        const parentPath = ancestors[ancestors.length - 1];
        const nextCollapsed = new Set(collapsedFolders);
        nextCollapsed.add(parentPath);
        const nextRows = flatten(tree, nextCollapsed, annotationCounts);
        const newIdx = nextRows.findIndex((r) => r.path === parentPath);
        setCollapsedFolders(nextCollapsed);
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
        setLayout((v) => (v === "split" ? "unified" : "split"));
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
        setCursor(result.cursor);
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
        setCursor(result.cursor);
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
          setCursor((c) => moveCursor(c, dir, flatRowsList));
          return;
        }
        // Diff-pane motion contract (ADR 0011 — Diff-pane motion contract).
        // Cursor floats; pane scrolls one row only when crossing the 3-row
        // edge margin. The fallback `[cursor, layout]` useEffect runs after
        // setCursor and applies block:nearest, which dominates for off-
        // viewport cursors (post-wheel-scroll) and is a no-op when the
        // cursor is already visible.
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
        setCursor(result.cursor);
        if (result.scrollTop !== sb.scrollTop) {
          sb.scrollTo(result.scrollTop);
        }
        return;
      }
      case "cursor-side-left":
        setCursor((c) => setCursorSide(c, "deletions", flatRowsList));
        return;
      case "cursor-side-right":
        setCursor((c) => setCursorSide(c, "additions", flatRowsList));
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
        tour={liveTour}
        layout={layout}
        currentAnnotationIdx={cursorCardNavIdx}
        topLevelTotal={liveTopLevel.length}
        selectedPath={selectedRow?.path}
        onOpenPicker={() => void openPicker()}
        onPrevAnnotation={gotoPrevAnnotation}
        onNextAnnotation={gotoNextAnnotation}
        onSplit={() => setLayout("split")}
        onUnified={() => setLayout("unified")}
      />

      {liveSnapshotLost && (
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
                  setCursor(cursorAtFirstFileRow(row.path, flatRowsList));
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
          {!liveSnapshotLost && liveDiff && (
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
                const reason = fileClassification(liveClassifications, file.name).reason;
                return (
                  <box
                    key={file.name}
                    id={`file-card-${file.name}`}
                    borderStyle="single"
                    borderColor={theme.border.default}
                    flexDirection="column"
                    marginBottom={1}
                  >
                    <text>{fileEntryLabel(file, liveClassifications, liveAnnotations)}</text>
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
                      repliesCollapsed,
                      liveReplyLock,
                      now,
                      navIndexById,
                      navTotal,
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

      {pickerOpen && (
        <TourPicker
          rows={pickerRows}
          currentTourId={liveTour.id}
          cursor={pickerCursor}
        />
      )}

      {composer && <Composer state={composer} onSubmit={(body) => void submitComposer(body)} />}
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
