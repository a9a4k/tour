import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, MultiFileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileContents, FileDiffMetadata, DiffLineAnnotation } from "@pierre/diffs";
import type { Annotation, AnnotationMetadata, BundleFile, TourBundle, TourSummary } from "./types.js";
import {
  toPierreLineAnnotations,
  buildRangeBackgroundCSS,
  resolveCursorById,
} from "./annotations.js";
import { fileIcon } from "./file-icon.js";
import { ChevronDownIcon, ChevronRightIcon, FileDirectoryFillIcon } from "./icons.js";
import { AnnotationMarkdown } from "./markdown/AnnotationMarkdown.js";
import { TourPicker } from "./TourPicker.js";
import { buildPickerRows } from "../../core/tour-list.js";
import { buildThreads, isTopLevel, topLevelAnnotations } from "../../core/threads.js";
import { ageMs, isStale, type ReplyLock } from "../../core/reply-lock.js";
import { canSendToAgent } from "../../core/can-send-to-agent.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  sortFilesForStream,
  type VisibleRow,
} from "../../core/file-tree.js";
import { flatRows as buildFlatRows } from "../../core/flat-rows.js";
import { planRows } from "../../core/diff-rows.js";
import {
  initialCursor,
  moveCursor,
  setCursorSide,
  type Cursor,
} from "../../core/cursor-state.js";
import { dispatchCursorKey } from "./cursor-keymap.js";
import { nextAnnotationNavStep } from "./annotation-nav.js";
import { CURSOR_OUTLINE_CSS, PLUS_BUTTON_CSS, GAP_ROW_CSS } from "./cursor-css.js";
import { syncCursorOverlay, scrollCursorIntoView } from "./cursor-overlay.js";
import { syncPlusButtonOverlay } from "./plus-button-overlay.js";
import { validateWebappCursor } from "./cursor-validation.js";
import { RenameHeaderSpan, RenamePlaceholderBody } from "./rename-display.js";
import { resolveClickAnchor } from "./click-anchor.js";
import { readTourFromLocation, readAnnFromLocation, composeUrl } from "./url-routing.js";
import { attachGapRowOverlay, dispatchGapRowAction } from "./gap-row-overlay.js";
import { expansionFromPierre } from "./pierre-expansion-bridge.js";
import type { FileDiff as FileDiffInstance } from "@pierre/diffs";

const STICKY_HEADER_CSS = `
  [data-diffs-header=default] {
    position: sticky;
    top: 0;
    z-index: 10;
    cursor: pointer;
  }
`;

// Pointer cursor on annotatable diff lines so the click-to-comment
// affordance reads visually. Pierre paints additions / deletions /
// change-* per-cell via [data-line-type] — same selector list the
// range-tint CSS already uses (annotations.ts).
const COMMENT_AFFORDANCE_CSS = `
  [data-line][data-line-type="addition"],
  [data-line][data-line-type="deletion"],
  [data-line][data-line-type="change-addition"],
  [data-line][data-line-type="change-deletion"] {
    cursor: pointer;
  }
`;

// Workaround for @pierre/diffs split+wrap: library defines
// --diffs-code-grid as "minmax(min-content, max-content) 1fr", which
// expands on the split <pre> grid to two `1fr` content tracks. With
// annotation rows spanning gutter+content, the auto-minimum on `1fr`
// lets one side's track win extra width and the other side shrinks
// when the container is narrow. Forcing `minmax(0, 1fr)` removes the
// auto-minimum and pins both content columns to 50/50.
const EQUAL_COLUMNS_CSS = `
  [data-diff-type="split"][data-overflow="wrap"] {
    --diffs-code-grid: minmax(min-content, max-content) minmax(0, 1fr);
  }
`;

type Layout = "split" | "unified";

type ComposerTarget =
  | {
      kind: "top-level";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
    }
  | { kind: "reply"; replies_to: string };

interface PostBody {
  body: string;
  file?: string;
  side?: "additions" | "deletions";
  line_start?: number;
  line_end?: number;
  replies_to?: string;
}

// Theme / themeType / lineDiffType / tokenizeMaxLineLength are controlled
// by the WorkerPoolContextProvider in main.tsx — Pierre's worker docs
// warn these per-component options are ignored when a pool is wired up.
const BASE_DIFF_OPTIONS = {
  hunkSeparators: "metadata" as const,
  overflow: "wrap" as const,
  expansionLineCount: 20,
};

interface AppProps {
  initialTourId: string | null;
  // The renderer-configured reply-agent name (from `--reply-agent <name>`,
  // baked into the SPA via `__INITIAL_REPLY_AGENT__`). Null when the
  // server was launched without `--reply-agent`; the "Send to {agent}"
  // affordance stays hidden in that case.
  replyAgent?: string | null;
}

interface LoadState {
  bundle: TourBundle | null;
  error: string | null;
  loaded: boolean;
}

function defaultCollapsedFor(file: BundleFile, annotations: Annotation[]): boolean {
  const reason = file.classification.reason;
  if (reason === "binary") return true;
  if (
    file.classification.collapsed === true &&
    !annotations.some((a) => a.file === file.name && isTopLevel(a))
  ) {
    return true;
  }
  return false;
}

function readTourFromUrl(fallback: string | null): string | null {
  if (typeof window === "undefined") return fallback;
  return readTourFromLocation(window.location, fallback);
}

function readAnnFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return readAnnFromLocation(window.location);
}

export function App({ initialTourId, replyAgent }: AppProps): React.JSX.Element {
  const [tourId, setTourId] = useState<string | null>(() => readTourFromUrl(initialTourId));
  const [tourList, setTourList] = useState<TourSummary[] | null>(null);
  const [state, setState] = useState<LoadState>({ bundle: null, error: null, loaded: false });
  const [replyLock, setReplyLock] = useState<ReplyLock | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentAnnotationId, setCurrentAnnotationId] = useState<string | null>(null);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [layout, setLayout] = useState<Layout>("split");
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [composerTarget, setComposerTarget] = useState<ComposerTarget | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  // Lazy-materialized line cursor (ADR 0012). Null on tour load and on
  // every tour switch; first j/k/h/l/arrows/a/n/p/click materializes it
  // at the default target so first paint isn't competing with the
  // currentAnnotationId accent.
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const annotationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Initial-anchor intent: the id we want vertically centered on first paint.
  // Set by the URL/default restorer, cleared on first user-initiated wheel /
  // touch / keydown. While set, both `registerAnnotationRef` (mount signal)
  // and Pierre's `onPostRender` (paint-settle signal) re-fire scrollIntoView
  // so the target stays centered as the async render cascade settles.
  const pendingAnchorRef = useRef<string | null>(null);
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sidebarRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Per-file Pierre `FileDiff` instances. Captured via the `onPostRender`
  // option each `<FileDiff>` / `<MultiFileDiff>` accepts (Pierre exposes the
  // class instance there because the React wrapper doesn't forward a ref).
  // Read by `attachGapRowOverlay` to call `expandHunk` on chevron clicks.
  const fileDiffRefs = useRef<Map<string, FileDiffInstance<AnnotationMetadata>>>(new Map());
  // Bumped whenever Pierre's expansion state changes (chevron clicked).
  // Drives the gap-row-overlay re-attach so injected nodes re-paint
  // against the freshly-rendered diff DOM.
  const [expansionVersion, setExpansionVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/tours?status=all");
      const tours = (await res.json()) as TourSummary[];
      if (cancelled) return;
      setTourList(tours);
      if (!tourId && tours.length > 0) {
        const open = tours.filter((t) => t.status === "open");
        const target = open.length > 0 ? open[open.length - 1] : tours[tours.length - 1];
        setTourId(target.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPop = () => {
      const fromUrl = readTourFromUrl(null);
      if (fromUrl !== null) setTourId(fromUrl);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!tourId) return;
    let cancelled = false;
    setSelectedFile(null);
    setCurrentAnnotationId(null);
    setCollapsedOverrides({});
    setCollapsedFolders(new Set());
    setComposerTarget(null);
    setComposerError(null);
    setCursor(null);
    (async () => {
      const res = await fetch(`/api/tours/${tourId}`);
      const data = (await res.json()) as TourBundle | { error: string };
      if (cancelled) return;
      if ("error" in data) {
        setState({ bundle: null, error: data.error, loaded: true });
      } else {
        setState({ bundle: data, error: null, loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tourId]);

  useEffect(() => {
    if (!tourId) return;
    let cancelled = false;
    const refetchLock = async () => {
      try {
        const res = await fetch(`/api/tours/${tourId}/reply-lock`);
        const data = (await res.json()) as ReplyLock | { error: string } | null;
        if (cancelled) return;
        if (data && typeof data === "object" && "error" in data) {
          setReplyLock(null);
        } else {
          setReplyLock(data as ReplyLock | null);
        }
      } catch {
        // transient — keep current pill state
      }
    };
    void refetchLock();

    const evtSource = new EventSource(`/api/tours/${tourId}/events`);
    evtSource.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as { type: string };
      if (msg.type === "annotation-changed") {
        const res = await fetch(`/api/tours/${tourId}`);
        const data = (await res.json()) as TourBundle | { error: string };
        if (!("error" in data)) setState({ bundle: data, error: null, loaded: true });
      } else if (msg.type === "reply-in-flight" || msg.type === "reply-cleared") {
        await refetchLock();
      }
    };
    return () => {
      cancelled = true;
      evtSource.close();
    };
  }, [tourId]);

  const bundle = state.bundle;
  const tourMeta = bundle?.tour ?? null;
  const annotations = useMemo(() => bundle?.annotations ?? [], [bundle?.annotations]);
  const topLevel = useMemo(() => topLevelAnnotations(annotations), [annotations]);
  // 1-based nav-order index per top-level annotation id, for rendering the
  // `i / n` counter in each AnnotationCard header. Stable Map so FileBlock's
  // memo bails on cursor moves.
  const navIndexById = useMemo(() => {
    const m = new Map<string, number>();
    topLevel.forEach((a, i) => m.set(a.id, i + 1));
    return m;
  }, [topLevel]);
  const navTotal = topLevel.length;
  const repliesByRoot = useMemo(() => {
    const out = new Map<string, Annotation[]>();
    for (const t of buildThreads(annotations)) {
      out.set(t.root.id, t.replies);
    }
    return out;
  }, [annotations]);
  const currentIdx = useMemo(
    () => resolveCursorById(annotations, currentAnnotationId),
    [annotations, currentAnnotationId],
  );
  // Which file holds the current annotation, so `currentAnnotationId` only
  // goes to that one FileBlock. Before this, every FileBlock saw the prop
  // change on every n/p and bailed React.memo, re-rendering all ~650 files
  // for a single annotation step. Now only the old + new annotation's
  // files re-render on nav.
  const currentAnnotationFile = useMemo<string | null>(() => {
    if (currentAnnotationId === null) return null;
    return annotations.find((a) => a.id === currentAnnotationId)?.file ?? null;
  }, [annotations, currentAnnotationId]);

  const liveDiff = bundle && bundle.kind === "ok" ? bundle.diff : "";
  const liveFiles = useMemo<BundleFile[]>(
    () => (bundle && bundle.kind === "ok" ? bundle.files : []),
    [bundle],
  );
  // O(1) lookup keyed by file name. The previous render-time
  // `liveFiles.find(...)` per `<FileBlock>` is O(N) per file × N files
  // per render = O(N²) and — more importantly — returns the same
  // BundleFile reference each time, but inside a fresh arrow per
  // render. Hoisting to a stable Map keeps the modelFile prop
  // referentially stable across renders so React.memo can short-circuit.
  const modelFilesByName = useMemo<Map<string, BundleFile>>(() => {
    const m = new Map<string, BundleFile>();
    for (const f of liveFiles) m.set(f.name, f);
    return m;
  }, [liveFiles]);
  const snapshotLost = bundle?.kind === "snapshot-lost";

  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!tourMeta || !liveDiff) return [];
    const raw = parsePatchFiles(liveDiff, tourMeta.id).flatMap((p) => p.files);
    return sortFilesForStream(raw);
  }, [liveDiff, tourMeta?.id]);

  const tree = useMemo(() => compress(buildTree(liveFiles)), [liveFiles]);
  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of topLevel) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [topLevel]);
  const visibleRows = useMemo<VisibleRow<BundleFile>[]>(
    () => flatten(tree, collapsedFolders, annotationCounts),
    [tree, collapsedFolders, annotationCounts],
  );

  const revealFileAncestors = useCallback(
    (filePath: string) => {
      const ancestors = revealAncestors(tree, filePath);
      if (ancestors.length === 0) return;
      setCollapsedFolders((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const a of ancestors) {
          if (next.delete(a)) changed = true;
        }
        return changed ? next : prev;
      });
    },
    [tree],
  );

  const toggleFolder = useCallback((folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  // `behavior: "instant"` — same reason as `anchorInitial` below. `navigateBy`
  // also runs `setCursor(nextCursor)`, which wakes `cursor-overlay.ts`'s
  // placement IntersectionObserver; the IO fires
  // `scrollIntoView({ block: "nearest" })` on the cursor cell ~3ms later and,
  // per CSSOM-View, that cancels any in-flight smooth scroll, parking the
  // cursor at the nearest viewport edge and leaving the annotation card
  // offscreen. Instant commits `scrollTop` synchronously, so by the time the
  // IO callback runs the cursor cell is already inside the viewport and the
  // IO no-ops.
  const scrollAnnotationIntoView = useCallback((id: string) => {
    requestAnimationFrame(() => {
      annotationRefs.current.get(id)?.scrollIntoView({ behavior: "instant", block: "center" });
    });
  }, []);

  // Initial-anchor scroll (URL `?ann=` restore / default first annotation).
  // Pierre's `<FileDiff>` renders via a Web Worker pool + virtualized rows,
  // so the AnnotationCard ref isn't reliably present one RAF after the
  // restorer fires. We record a pending intent here; `registerAnnotationRef`
  // and the per-file `onPostRender` both re-center against the latest layout
  // while the intent is live. `behavior: "instant"` because the user is
  // landing on a bookmark — a smooth animation would race with the still-
  // settling async paint and visibly jitter.
  const anchorInitial = useCallback((id: string) => {
    pendingAnchorRef.current = id;
    annotationRefs.current
      .get(id)
      ?.scrollIntoView({ behavior: "instant", block: "center" });
  }, []);

  const navigateBy = useCallback(
    (delta: -1 | 1) => {
      const step = nextAnnotationNavStep({ topLevel, currentIdx, delta });
      if (!step) return;
      const { target, cursor: nextCursor } = step;
      setCurrentAnnotationId(target.id);
      setSelectedFile(target.file);
      setCollapsedOverrides((prev) =>
        prev[target.file] === false ? prev : { ...prev, [target.file]: false },
      );
      revealFileAncestors(target.file);
      scrollAnnotationIntoView(target.id);
      // β-coupling per ADR 0012 (mirrors ADR 0011): annotation nav
      // moves the line cursor too — and materializes it from null on
      // first n/p so the same keystroke that moves currentAnnotationId
      // also lights up the cursor at the target's anchor. Reverse
      // direction (j/k/h/l/arrows) stays decoupled.
      setCursor(nextCursor);
    },
    [topLevel, currentIdx, revealFileAncestors, scrollAnnotationIntoView],
  );

  // Re-anchor cursor to the current top-level Annotation by id (n/p navigates
  // top-level only; replies are not nav targets). On first sight of a
  // non-empty list, anchor the tree to the URL `?ann=` target when valid,
  // else the first top-level annotation; on SSE reload with the same id
  // present, do nothing; if gone, re-anchor. Gated on the loaded Tour
  // matching the routing Tour id so the in-flight Tour-switch window
  // (URL Tour updated, new data still fetching) doesn't anchor the new
  // URL's `ann=` against the previous Tour's annotations.
  useEffect(() => {
    if (!tourMeta || tourMeta.id !== tourId) return;
    if (topLevel.length === 0) {
      setCurrentAnnotationId((curr) => (curr === null ? curr : null));
      setSelectedFile((curr) => (curr === null ? curr : null));
      return;
    }
    if (currentAnnotationId === null) {
      const fromUrl = readAnnFromUrl();
      const target = topLevel.find((a) => a.id === fromUrl) ?? topLevel[0];
      setCurrentAnnotationId(target.id);
      setSelectedFile(target.file);
      revealFileAncestors(target.file);
      anchorInitial(target.id);
      return;
    }
    const found = topLevel.some((a) => a.id === currentAnnotationId);
    if (!found) {
      const first = topLevel[0];
      setCurrentAnnotationId(first.id);
      setSelectedFile(first.file);
      revealFileAncestors(first.file);
    }
  }, [tourMeta, tourId, topLevel, currentAnnotationId, revealFileAncestors, anchorInitial]);

  // Mirror the current top-level Annotation cursor into the URL via
  // replaceState — chosen over pushState so the browser back button steps
  // over Tour switches, not over every n/p keystroke. Writes the new
  // path + fragment shape `/<tour-id>#<ann-id>` (Issue #179) so the
  // printed deep URL and the address bar agree, and so the legacy
  // `?tour=&ann=` form self-heals on first cursor movement. Gate: skip
  // only when the URL asserts a *different* tour-id than state (the
  // in-flight Tour-switch window — Issue #180). A bare URL has no
  // assertion at all; passing `tourId` as the fallback makes the
  // resolver report agreement, so the writer runs and migrates `/` to
  // `/<tour-id>#<ann-id>`. Also defer when topLevel is non-empty but
  // the cursor is still null — the restorer is about to anchor, so we
  // don't want to strip-then-restore a valid ann in a single cycle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!tourMeta || tourMeta.id !== tourId) return;
    if (readTourFromLocation(window.location, tourId) !== tourId) return;
    if (currentAnnotationId === null && topLevel.length > 0) return;
    const next = composeUrl(tourId, currentAnnotationId);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next === current) return;
    window.history.replaceState(window.history.state, "", next);
  }, [currentAnnotationId, tourMeta, tourId, topLevel]);

  // Keep the selected sidebar row visible. block:"nearest" — already-visible
  // rows don't jump.
  useEffect(() => {
    if (selectedFile === null) return;
    const el = sidebarRowRefs.current.get(selectedFile);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedFile]);

  // Cancel the initial-anchor intent on user input so a later Pierre repaint
  // (worker-driven syntax highlight, late virtualized row) can't yank the
  // page after the user has started reading or navigating. Listeners stay
  // attached for the App's lifetime — `{ once: true }` would self-remove
  // during the pre-data-load window, leaving a later anchor uncancelable.
  useEffect(() => {
    const cancel = () => {
      if (pendingAnchorRef.current !== null) pendingAnchorRef.current = null;
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, []);

  const openPicker = useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    const back = triggerRef.current ?? pickerButtonRef.current;
    requestAnimationFrame(() => back?.focus());
  }, []);

  const registerAnnotationRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      annotationRefs.current.set(id, el);
      // R1 (mount race): if the restorer asked to anchor on this id before
      // Pierre had mounted its AnnotationCard, scroll the moment it arrives.
      if (pendingAnchorRef.current === id) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
    } else {
      annotationRefs.current.delete(id);
    }
  }, []);

  const isCollapsed = useCallback(
    (fileName: string): boolean => {
      if (fileName in collapsedOverrides) return collapsedOverrides[fileName];
      const f = liveFiles.find((x) => x.name === fileName);
      return f ? defaultCollapsedFor(f, annotations) : false;
    },
    [collapsedOverrides, liveFiles, annotations],
  );

  const toggleCollapsed = useCallback(
    (fileName: string) => {
      setCollapsedOverrides((prev) => ({ ...prev, [fileName]: !isCollapsed(fileName) }));
    },
    [isCollapsed],
  );

  // Stable per-file ref registrar so FileBlock can be `React.memo`'d.
  // The previous inline arrow `(el) => fileRefs.current.set(f.name, el)`
  // was a fresh function on every App render, defeating any memoisation
  // attempt; lifting it here gives FileBlock a stable function reference
  // and the file name flows through the call instead of the closure.
  const registerFileRef = useCallback((file: string, el: HTMLDivElement | null) => {
    if (el) fileRefs.current.set(file, el);
    else fileRefs.current.delete(file);
  }, []);

  // Sidebar counterparts so memoized FileRow / FolderRow don't re-render
  // on every App state change. Same pattern as `registerFileRef`: path
  // flows as an argument, so a single stable function reference serves
  // every sidebar row.
  const registerSidebarRef = useCallback(
    (path: string, el: HTMLButtonElement | null) => {
      if (el) sidebarRowRefs.current.set(path, el);
      else sidebarRowRefs.current.delete(path);
    },
    [],
  );
  const selectFile = useCallback((name: string) => {
    setSelectedFile(name);
    const el = fileRefs.current.get(name);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Stable per-file FileDiff-instance registrar (issue #154, PRD #151 A1).
  // Pierre's React `<FileDiff>` doesn't forward a ref to the underlying
  // class instance; `onPostRender(node, instance)` is the only seam, so
  // each FileBlock's options closure calls this on every Pierre render.
  // Idempotent — same instance on re-render reuses the same Map entry.
  const registerFileDiffRef = useCallback(
    (file: string, instance: FileDiffInstance<AnnotationMetadata>) => {
      fileDiffRefs.current.set(file, instance);
    },
    [],
  );

  // R2 (cascade race): each Pierre `onPostRender` call signals that a file's
  // layout has changed — including files above the anchor target, which
  // shift its viewport position. Re-center while the pending intent is
  // live. Already-centered → no-op, so re-firing across many onPostRender
  // calls is cheap.
  const onPierreFileRendered = useCallback(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    annotationRefs.current
      .get(pending)
      ?.scrollIntoView({ behavior: "instant", block: "center" });
  }, []);

  // Cursor walk sequence (ADR 0012). Per-file planned rows are built
  // from each Pierre-parsed file + the annotation list + the active
  // layout (split vs unified differ in pairing). The flat-rows builder
  // skips folded files and hunk-header / annotation rows, leaving a
  // walkable sequence indexed by moveCursor.
  //
  // PRD #151 / issue #158: bridge Pierre's `expandedHunks` runtime state
  // into a Tour `ExpansionState` and feed it to `planRows` so chevrons
  // and gap-mid-top rows reflect the REMAINING hidden lines after each
  // `expandHunk` call. `expansionVersion` (bumped by the gap-row overlay
  // after every click) is in this memo's dep list so the planner re-runs
  // off the freshly-mutated Pierre map.
  const plannedRowsByFile = useMemo(() => {
    const expansion = expansionFromPierre(fileDiffRefs.current, parsedFiles);
    const out = new Map<string, ReturnType<typeof planRows>>();
    for (const f of parsedFiles) {
      out.set(f.name, planRows(f, annotations, layout, { expansion }));
    }
    return out;
    // expansionVersion is the re-render trigger; fileDiffRefs is a ref and
    // intentionally not in the dep list — reading `current` at memo time
    // picks up whatever Pierre has accumulated by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedFiles, annotations, layout, expansionVersion]);

  const flatRowsList = useMemo(() => {
    return buildFlatRows(
      parsedFiles.map((f) => ({ name: f.name, type: "change", hunks: [] })),
      plannedRowsByFile,
      isCollapsed,
    );
  }, [parsedFiles, plannedRowsByFile, isCollapsed]);

  // Validate-in-place when the row sequence shifts under the cursor's
  // feet (collapse toggle, bundle reload, layout switch). The webapp
  // policy differentiates "file collapsed" (anchor preserved — file is
  // still in the bundle, only hidden) from "file removed from bundle"
  // (anchor null — re-materializes on next interaction). Lazy-
  // materialization rule: we never seed here — first interaction does.
  useEffect(() => {
    if (cursor === null) return;
    const validated = validateWebappCursor(cursor, flatRowsList, parsedFiles, isCollapsed);
    if (validated !== cursor) setCursor(validated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRowsList, parsedFiles, isCollapsed]);

  // Mirror the line cursor onto the rendered diff DOM as
  // data-tour-cursor / data-tour-cursor-side on the matching cell. The
  // outline CSS (CURSOR_OUTLINE_CSS) keys off these attributes so Pierre's
  // per-file shadow root remains the natural CSS scope. Plain useEffect
  // (post-paint) so click→cursor-attr→outline does not block the input
  // event; click already implies the cell is on screen, and the brief
  // gap on the first keyboard motion is imperceptible.
  useEffect(() => {
    if (typeof document === "undefined") return;
    return syncCursorOverlay(document.body, cursor);
  }, [cursor, parsedFiles, layout, collapsedOverrides]);

  // Lazy materialization (ADR 0012). Returns the seeded cursor (or
  // existing one if already materialized) so the caller can chain into
  // composer-open / move actions in one step. setCursor is queued; the
  // returned value is what the caller should act on this tick.
  const materializeCursor = useCallback((): Cursor | null => {
    if (cursor) return cursor;
    const seeded = initialCursor({ topLevelAnnotations: topLevel, flatRows: flatRowsList });
    if (seeded) setCursor(seeded);
    return seeded;
  }, [cursor, topLevel, flatRowsList]);

  // Global keydown router (ADR 0012). Cursor motion (j/k/h/l/arrows),
  // side selection, annotate-at-cursor (a), annotation nav (n/p, with
  // β-coupling to the line cursor), layout toggle (Shift-L, rebound
  // from the previous lowercase l), and picker open (t) all flow
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
      // Enter / Shift+Enter on a gap-row interactive cursor → dispatch the
      // same action as clicking the row's chevron (issue #154, PRD #151
      // user-stories 6-8). The overlay's per-row click handler is the
      // single source of truth for direction + line-count derivation;
      // dispatchGapRowAction returns false for non-gap-row interactive
      // subkinds (e.g., collapsed-file), letting Enter fall through.
      if (
        e.key === "Enter" &&
        !focusInEditable &&
        composerTarget === null &&
        !pickerOpen &&
        cursor?.interactive &&
        dispatchGapRowAction(document.body, cursor.file, cursor.interactive, e.shiftKey)
      ) {
        e.preventDefault();
        return;
      }
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
        },
      );
      if (action.type === "noop") return;
      e.preventDefault();
      // Lazy materialization rule (ADR 0012): the first j/k/h/l just
      // SHOWS the cursor at the default target, no move past it. `a`
      // materializes AND opens the composer (handled inline below).
      const motion =
        action.type === "move-down" ||
        action.type === "move-up" ||
        action.type === "set-side-additions" ||
        action.type === "set-side-deletions";
      if (motion && !cursor) {
        const seeded = materializeCursor();
        // Keyboard motion needs scroll-into-view; the mouse path
        // (setCursorFromRowClick) deliberately omits it because the
        // clicked cell is already where the user is looking.
        if (seeded) scrollCursorIntoView(document.body, seeded);
        return;
      }
      switch (action.type) {
        case "open-picker":
          openPicker();
          return;
        case "toggle-layout":
          setLayout((prev) => (prev === "split" ? "unified" : "split"));
          return;
        case "nav-next-annotation":
          navigateBy(1);
          return;
        case "nav-prev-annotation":
          navigateBy(-1);
          return;
        case "move-down": {
          // Compute next synchronously so we can scroll the destination
          // cell into view. setCursor(fn) would keep us inside React's
          // updater (no side-effects allowed); since the handler closure
          // already captures the latest `cursor` via the deps array,
          // computing eagerly is safe.
          const next = moveCursor(cursor, "down", flatRowsList);
          setCursor(next);
          if (next) scrollCursorIntoView(document.body, next);
          return;
        }
        case "move-up": {
          const next = moveCursor(cursor, "up", flatRowsList);
          setCursor(next);
          if (next) scrollCursorIntoView(document.body, next);
          return;
        }
        case "set-side-additions":
          // Horizontal side toggle stays on the same row, so the cell is
          // already on screen — no scroll. Skipping the layout flush is
          // the whole reason we hoisted scroll out of syncCursorOverlay.
          setCursor((c) => setCursorSide(c, "additions", flatRowsList));
          return;
        case "set-side-deletions":
          setCursor((c) => setCursorSide(c, "deletions", flatRowsList));
          return;
        case "annotate-at-cursor": {
          const c = cursor ?? materializeCursor();
          if (!c) return;
          // Interactive rows (gap-row family, collapsed-file) are not
          // annotatable — `a` is a silent no-op (issue #154, PRD #107 US 14).
          if (c.interactive) return;
          setComposerError(null);
          setComposerTarget({
            kind: "top-level",
            file: c.file,
            side: c.side,
            line_start: c.lineNumber,
            line_end: c.lineNumber,
          });
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
    flatRowsList,
    materializeCursor,
  ]);

  const closeComposer = useCallback(() => {
    setComposerTarget(null);
    setComposerError(null);
  }, []);

  const openTopLevelComposer = useCallback(
    (file: string, side: "additions" | "deletions", line: number) => {
      setComposerError(null);
      setComposerTarget({
        kind: "top-level",
        file,
        side,
        line_start: line,
        line_end: line,
      });
      // Opening the composer also pins the cursor at the anchor (ADR 0012).
      // preferredSide tracks the chosen side so subsequent keyboard motion
      // preserves the user's mouse-expressed preference.
      setCursor({ file, lineNumber: line, side, preferredSide: side });
    },
    [],
  );

  // Issue #137 / PRD #136: row click no longer opens the composer; it
  // only moves the Line cursor. The composer is reached via the gutter
  // `+` button (plus-button-overlay) or the keyboard `a` shortcut.
  const setCursorFromRowClick = useCallback(
    (file: string, side: "additions" | "deletions", line: number) => {
      setCursor({ file, lineNumber: line, side, preferredSide: side });
    },
    [],
  );

  // Plus-button overlay (PRD #136). Mounts a real-DOM `<button>` next to
  // the cursor cell — the only `+` affordance the mouse can use to open
  // the composer (the keyboard `a` shortcut is the parallel path).
  // Suppressed while the composer is open. Re-attaches on parsedFiles /
  // layout / collapsedOverrides / composerTarget changes so Pierre's
  // shadow-root rebuilds and the composer-open flip both pick up new
  // observer scopes / cleared state.
  useEffect(() => {
    if (typeof document === "undefined") return;
    return syncPlusButtonOverlay(
      document.body,
      ({ file, side, line }) => openTopLevelComposer(file, side, line),
      composerTarget !== null,
    );
  }, [composerTarget, openTopLevelComposer, parsedFiles, layout, collapsedOverrides]);

  // Gap-row overlay (issue #154, PRD #151, ADR 0018). Tour-owned chevrons
  // and standalone interactive rows for the gap-row family — first-hunk
  // file-top, mid-file hunk-header, mid-file gap-mid-top, file-bottom.
  // Re-attaches on parsedFiles / annotations / layout / collapsedOverrides /
  // expansionVersion change so each click → Pierre `expandHunk` → re-render
  // refreshes the overlay against the new DOM.
  useEffect(() => {
    if (typeof document === "undefined") return;
    // `registerFileDiffRef` only `.set()`s — never `.delete()`s — so files
    // dropping out of the bundle leak their FileDiff instance until App
    // unmounts. Prune entries no longer in `parsedFiles` (symmetric with
    // `registerFileRef`'s null-on-unmount delete).
    const liveNames = new Set(parsedFiles.map((f) => f.name));
    for (const f of fileDiffRefs.current.keys()) {
      if (!liveNames.has(f)) fileDiffRefs.current.delete(f);
    }
    return attachGapRowOverlay({
      root: document.body,
      plannedRowsByFile,
      fileDiffRefs: fileDiffRefs.current,
      onAfterExpand: () => setExpansionVersion((v) => v + 1),
    });
  }, [parsedFiles, plannedRowsByFile, layout, collapsedOverrides, expansionVersion]);

  const openReplyComposer = useCallback((replies_to: string) => {
    setComposerError(null);
    setComposerTarget({ kind: "reply", replies_to });
  }, []);

  // Explicit reply-agent dispatch (issue #184, ADR 0021). Fired by the
  // `Send to {agent}` button below each human Annotation card. Hits the
  // `POST /api/tours/:id/request-reply` endpoint which routes through
  // `requestReply` in core. We don't await the result for UX — the
  // watcher's reply-lock SSE event surfaces the in-flight pill within
  // a debounce tick; on completion, the annotation-changed event brings
  // in the landed Reply. Network errors are silent here; the user's
  // visible signal is the pill (or absence of one).
  const sendToAgent = useCallback(
    (annotationId: string) => {
      if (!tourId) return;
      void fetch(`/api/tours/${tourId}/request-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotation_id: annotationId }),
      }).catch(() => {
        // Network transient — watcher events stay the source of truth.
      });
    },
    [tourId],
  );

  const submitComposer = useCallback(
    async (body: string) => {
      if (!tourId || !composerTarget) return;
      const trimmed = body.trim();
      if (trimmed.length === 0) return;
      const payload: PostBody =
        composerTarget.kind === "reply"
          ? { body: trimmed, replies_to: composerTarget.replies_to }
          : {
              body: trimmed,
              file: composerTarget.file,
              side: composerTarget.side,
              line_start: composerTarget.line_start,
              line_end: composerTarget.line_end,
            };
      try {
        const res = await fetch(`/api/tours/${tourId}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setComposerError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        closeComposer();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setComposerError(message);
      }
    },
    [tourId, composerTarget, closeComposer],
  );

  const commitTour = useCallback(
    (id: string) => {
      setPickerOpen(false);
      if (id !== tourId) {
        if (typeof window !== "undefined" && window.history) {
          window.history.pushState({ tourId: id }, "", composeUrl(id, null));
        }
        setTourId(id);
      }
      const back = triggerRef.current ?? pickerButtonRef.current;
      requestAnimationFrame(() => back?.focus());
    },
    [tourId],
  );

  const pickerRows = useMemo(() => {
    if (!tourList) return [];
    const counts: Record<string, number> = {};
    if (bundle) counts[bundle.tour.id] = bundle.annotations.length;
    return buildPickerRows({ tours: tourList, annotationCounts: counts, now: Date.now() });
  }, [tourList, bundle]);

  if (!state.loaded && !tourList) {
    return <div className="empty">Loading…</div>;
  }

  if (tourList && tourList.length === 0) {
    return <div className="empty">No tours found. Create one with: tour create --head HEAD</div>;
  }

  if (state.error) {
    return <div className="empty">Error: {state.error}</div>;
  }

  if (!bundle || !tourMeta) {
    return <div className="empty">Loading…</div>;
  }

  const titleIsEmpty = !tourMeta.title;

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
          <span className="tour-refs">
            {tourMeta.base_source} ← {tourMeta.head_source}
          </span>
        </div>
        <div className="tour-header-right">
          <SequencePill
            idx={currentIdx}
            total={topLevel.length}
            onPrev={() => navigateBy(-1)}
            onNext={() => navigateBy(1)}
          />
          <LayoutToggle layout={layout} onChange={setLayout} />
        </div>
        <TourHeaderPath path={selectedFile} />
      </div>
      <div className="app-body">
        <aside className="app-sidebar">
          <h2>Files</h2>
          {visibleRows.map((row) =>
            row.kind === "folder" ? (
              <FolderRow key={`d:${row.path}`} row={row} onToggle={toggleFolder} />
            ) : (
              <FileRow
                key={`f:${row.path}`}
                row={row}
                selected={selectedFile === row.path}
                registerRef={registerSidebarRef}
                onSelect={selectFile}
              />
            ),
          )}
        </aside>
        <main className="app-main">
          {snapshotLost ? (
            <div className="banner">
              Snapshot lost — annotations preserved but diff cannot be displayed
            </div>
          ) : null}
          {snapshotLost ? (
            <AnnotationList
              topLevel={topLevel}
              repliesByRoot={repliesByRoot}
              navIndexById={navIndexById}
              navTotal={navTotal}
              currentAnnotationId={currentAnnotationId}
              registerAnnotationRef={registerAnnotationRef}
              composerTarget={composerTarget}
              composerError={composerError}
              onOpenReply={openReplyComposer}
              onSubmit={submitComposer}
              onCancel={closeComposer}
              replyLock={replyLock}
              replyAgent={replyAgent}
              onSendToAgent={sendToAgent}
            />
          ) : (
            parsedFiles.map((f) => (
              <FileBlock
                key={f.name}
                fileDiff={f}
                annotations={annotations}
                repliesByRoot={repliesByRoot}
                navIndexById={navIndexById}
                navTotal={navTotal}
                modelFile={modelFilesByName.get(f.name)}
                registerRef={registerFileRef}
                registerFileDiffRef={registerFileDiffRef}
                onPierreFileRendered={onPierreFileRendered}
                collapsed={isCollapsed(f.name)}
                onToggleCollapsed={toggleCollapsed}
                currentAnnotationId={currentAnnotationFile === f.name ? currentAnnotationId : null}
                registerAnnotationRef={registerAnnotationRef}
                layout={layout}
                composerTarget={composerTarget}
                composerError={composerError}
                onRowClick={setCursorFromRowClick}
                onOpenReply={openReplyComposer}
                onSubmit={submitComposer}
                onCancel={closeComposer}
                replyLock={replyLock}
                replyAgent={replyAgent}
                onSendToAgent={sendToAgent}
              />
            ))
          )}
        </main>
      </div>
      {pickerOpen ? (
        <TourPicker
          rows={pickerRows}
          currentTourId={tourId}
          onSelect={commitTour}
          onClose={closePicker}
        />
      ) : null}
    </>
  );
}

// Renders the currently-selected sidebar file's full filesystem path in the
// left cluster of `.tour-header`, prefixed with `·` (U+00B7) to match the
// TUI's separator glyph so the two surfaces feel consistent. Renders
// nothing when no file is selected. The path is echoed verbatim — no
// basename, no app-side truncation; CSS handles horizontal overflow the
// same way it does for the existing title / source-refs siblings.
// Exported so unit tests can mount the slot in isolation.
export function TourHeaderPath({ path }: { path: string | null }): React.JSX.Element | null {
  if (!path) return null;
  return <span className="tour-header-path">{`· ${path}`}</span>;
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
}

// React.memo so cursor / annotation-nav state changes in App don't re-render
// every sidebar row. Without this, the plain function rendered ~800 times per
// annotation click despite none of its props meaningfully changing.
// Exported so unit tests can mount the row in isolation.
export const FolderRow = React.memo(function FolderRow({
  row,
  onToggle,
}: FolderRowProps): React.JSX.Element {
  const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
  const handleClick = useCallback(() => onToggle(row.path), [onToggle, row.path]);
  return (
    <button
      type="button"
      className="folder-entry"
      style={{ paddingLeft: 16 + row.depth * 16 }}
      title={row.path}
      onClick={handleClick}
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
}

export const FileRow = React.memo(function FileRow({
  row,
  selected,
  onSelect,
  registerRef,
}: FileRowProps): React.JSX.Element {
  const { Icon, statusClass } = fileIcon(row.file.type);
  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => registerRef(row.path, el),
    [registerRef, row.path],
  );
  const handleClick = useCallback(() => onSelect(row.path), [onSelect, row.path]);
  return (
    <button
      ref={handleRef}
      type="button"
      className={`file-entry${selected ? " selected" : ""}`}
      style={{ paddingLeft: 16 + row.depth * 16 }}
      title={row.path}
      onClick={handleClick}
    >
      <Icon className={`status-icon ${statusClass}`} />
      <span className="file-name">{row.displayName}</span>
      {row.annotationCount > 0 ? <span className="badge">{row.annotationCount}</span> : null}
    </button>
  );
});

interface FileBlockProps {
  fileDiff: FileDiffMetadata;
  annotations: Annotation[];
  repliesByRoot: Map<string, Annotation[]>;
  navIndexById: Map<string, number>;
  navTotal: number;
  modelFile: BundleFile | undefined;
  // File name is passed as an argument (rather than bound via closure)
  // so the same function reference can serve every file — see App.tsx
  // `registerFileRef` / `toggleCollapsed`. That stability is what lets
  // `React.memo` short-circuit FileBlock on cursor moves.
  registerRef: (file: string, el: HTMLDivElement | null) => void;
  registerFileDiffRef: (file: string, instance: FileDiffInstance<AnnotationMetadata>) => void;
  onPierreFileRendered: () => void;
  collapsed: boolean;
  onToggleCollapsed: (file: string) => void;
  currentAnnotationId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
  layout: Layout;
  composerTarget: ComposerTarget | null;
  composerError: string | null;
  onRowClick: (file: string, side: "additions" | "deletions", line: number) => void;
  onOpenReply: (replies_to: string) => void;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  replyLock: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent: (annotationId: string) => void;
}

// Pierre's hidden-context expansion needs the full pre/post-image of each
// file. When the bundle ships oldContent/newContent (everything except
// binary files), switch from <FileDiff fileDiff=…> (patch-only, isPartial)
// to <MultiFileDiff oldFile= newFile=…> so chevrons can resolve unchanged
// lines on demand. Renamed files key the old side off prevName.
function fileContentsFor(
  fileDiff: FileDiffMetadata,
  modelFile: BundleFile | undefined,
): { oldFile: FileContents; newFile: FileContents } | null {
  if (
    !modelFile ||
    typeof modelFile.oldContent !== "string" ||
    typeof modelFile.newContent !== "string"
  ) {
    return null;
  }
  const oldName = fileDiff.prevName ?? fileDiff.name;
  return {
    oldFile: { name: oldName, contents: modelFile.oldContent },
    newFile: { name: fileDiff.name, contents: modelFile.newContent },
  };
}

// `React.memo` short-circuits re-renders when none of the props change
// by reference. The big payoff: cursor moves (`j`/`k`) update App state
// but do NOT touch any FileBlock prop, so every FileBlock — and the
// Pierre subtree beneath each — bails before React schedules any
// reconciliation work. Pre-memo the trace showed 700 ms-1.3 s input
// tasks driven entirely by per-file render fan-out; with memo the work
// collapses to the cursor-overlay attribute write.
//
// This depends on all props being referentially stable across cursor
// renders. `registerRef` / `onToggleCollapsed` take the file name as
// an argument (not closed over), and `modelFile` comes from a
// `useMemo`'d Map — both done at the App level above.
const FileBlock = React.memo(FileBlockInner);

function FileBlockInner({
  fileDiff,
  annotations,
  repliesByRoot,
  navIndexById,
  navTotal,
  modelFile,
  registerRef,
  registerFileDiffRef,
  onPierreFileRendered,
  collapsed,
  onToggleCollapsed,
  currentAnnotationId,
  registerAnnotationRef,
  layout,
  composerTarget,
  composerError,
  onRowClick,
  onOpenReply,
  onSubmit,
  onCancel,
  replyLock,
  replyAgent,
  onSendToAgent,
}: FileBlockProps): React.JSX.Element {
  const reason = modelFile?.classification?.reason;

  const lineAnns = useMemo<DiffLineAnnotation<AnnotationMetadata>[]>(() => {
    const base = toPierreLineAnnotations(annotations, fileDiff.name);
    if (
      composerTarget &&
      composerTarget.kind === "top-level" &&
      composerTarget.file === fileDiff.name
    ) {
      base.push({
        side: composerTarget.side,
        lineNumber: composerTarget.line_end,
        metadata: {
          kind: "composer",
          file: composerTarget.file,
          side: composerTarget.side,
          line_start: composerTarget.line_start,
          line_end: composerTarget.line_end,
        },
      });
    }
    return base;
  }, [annotations, fileDiff.name, composerTarget]);

  const options = useMemo(() => {
    const rangeCSS = buildRangeBackgroundCSS(annotations, fileDiff.name);
    const parts = [
      STICKY_HEADER_CSS,
      COMMENT_AFFORDANCE_CSS,
      EQUAL_COLUMNS_CSS,
      CURSOR_OUTLINE_CSS,
      PLUS_BUTTON_CSS,
      GAP_ROW_CSS,
      rangeCSS,
    ].filter((s) => s !== "");
    const unsafeCSS = parts.join("\n");
    return {
      ...BASE_DIFF_OPTIONS,
      diffStyle: layout,
      unsafeCSS,
      collapsed,
      // Capture Pierre's FileDiff class instance so `attachGapRowOverlay`
      // can call `expandHunk` on chevron clicks (issue #154, PRD #151
      // architecture decision A1). The React wrapper doesn't forward a
      // ref to the instance; `onPostRender` is Pierre's exposed seam.
      onPostRender: (_node: HTMLElement, instance: FileDiffInstance<AnnotationMetadata>) => {
        registerFileDiffRef(fileDiff.name, instance);
        onPierreFileRendered();
      },
    };
  }, [annotations, fileDiff.name, collapsed, layout, registerFileDiffRef, onPierreFileRendered]);

  const renderAnnotation = useCallback(
    (ann: DiffLineAnnotation<AnnotationMetadata>): React.ReactNode => {
      const meta = ann.metadata;
      if (!meta) return null;
      if (meta.kind === "composer") {
        return (
          <Composer
            placeholder="Leave a comment"
            submitLabel="Comment"
            error={composerError}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        );
      }
      if (!meta.isAnchor) return null;
      const a = meta.annotation;
      const replies = repliesByRoot.get(a.id) ?? [];
      const isReplying =
        composerTarget?.kind === "reply" && composerTarget.replies_to === a.id;
      return (
        <AnnotationCard
          annotation={a}
          replies={replies}
          isCurrent={a.id === currentAnnotationId}
          navIndex={navIndexById.get(a.id) ?? null}
          navTotal={navTotal}
          registerRef={registerAnnotationRef}
          replying={isReplying}
          composerError={isReplying ? composerError : null}
          onOpenReply={() => onOpenReply(a.id)}
          onSubmitReply={onSubmit}
          onCancelReply={onCancel}
          replyLock={replyLock}
          replyAgent={replyAgent}
          onSendToAgent={() => onSendToAgent(a.id)}
        />
      );
    },
    [
      currentAnnotationId,
      navIndexById,
      navTotal,
      registerAnnotationRef,
      repliesByRoot,
      composerTarget,
      composerError,
      onSubmit,
      onCancel,
      onOpenReply,
      replyLock,
      replyAgent,
      onSendToAgent,
    ],
  );

  const onWrapperClick = (e: React.MouseEvent) => {
    const path = e.nativeEvent.composedPath();
    const onHeader = path.some(
      (n) => n instanceof HTMLElement && n.dataset.diffsHeader === "default",
    );
    if (onHeader) {
      onToggleCollapsed(fileDiff.name);
      return;
    }
    if (collapsed) return;
    // Ignore clicks inside an annotation card or a composer (those manage
    // their own affordances). Issue #137: a row click now only seeds the
    // Line cursor; the composer is reached via the gutter `+` button
    // (plus-button-overlay) or the keyboard `a` shortcut.
    const insideCard = path.some(
      (n) =>
        n instanceof HTMLElement &&
        (n.classList?.contains("annotation-block") ||
          n.classList?.contains("composer")),
    );
    if (insideCard) return;
    const hit = resolveClickAnchor(path);
    if (!hit) return;
    onRowClick(fileDiff.name, hit.side, hit.lineNumber);
  };

  // Stable across renders so MultiFileDiff / FileDiff see the same prop
  // reference when nothing relevant changed.
  const headerMetadata = useCallback(
    () => (
      <>
        <RenameHeaderSpan name={fileDiff.name} prevName={fileDiff.prevName} />
        {reason ? <span className="reason-tag">{reason}</span> : null}
        <CopyPathButton path={fileDiff.name} />
      </>
    ),
    [fileDiff.name, fileDiff.prevName, reason],
  );

  // The previous unmemoised call produced a fresh `{ oldFile, newFile }` (and
  // fresh inner `{ name, contents }`) on every render, busting `MultiFileDiff`
  // memoisation. Stabilising it here keeps the props referentially equal
  // unless the underlying file actually changed.
  const contents = useMemo(
    () => fileContentsFor(fileDiff, modelFile),
    [fileDiff, modelFile],
  );

  return (
    <div
      className="file-block"
      data-file={fileDiff.name}
      ref={(el) => registerRef(fileDiff.name, el)}
      onClick={onWrapperClick}
    >
      {contents ? (
        <MultiFileDiff<AnnotationMetadata>
          oldFile={contents.oldFile}
          newFile={contents.newFile}
          options={options}
          lineAnnotations={lineAnns}
          renderAnnotation={renderAnnotation}
          renderHeaderMetadata={headerMetadata}
        />
      ) : (
        <FileDiff<AnnotationMetadata>
          fileDiff={fileDiff}
          options={options}
          lineAnnotations={lineAnns}
          renderAnnotation={renderAnnotation}
          renderHeaderMetadata={headerMetadata}
        />
      )}
      <RenamePlaceholderBody reason={reason} />
    </div>
  );
}

interface AnnotationCardProps {
  annotation: Annotation;
  replies?: Annotation[];
  isCurrent: boolean;
  // 1-based position in the top-level nav order. null when the annotation
  // isn't in topLevel (defensive — shouldn't happen since AnnotationCard
  // only ever renders top-level annotations). Header omits the counter
  // when null or when navTotal is 0.
  navIndex: number | null;
  navTotal: number;
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  replying?: boolean;
  composerError?: string | null;
  onOpenReply?: () => void;
  onSubmitReply?: (body: string) => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  // Reply-agent name from `--reply-agent <name>` (issue #184, PRD #181).
  // Null/undefined → the "Send to {agent}" affordance is hidden.
  replyAgent?: string | null;
  onSendToAgent?: () => void;
}

// Owns its own 1Hz tick so the wall-clock advances only here. The previous
// design lifted `now` to App and threaded it through every FileBlock /
// AnnotationCard, which meant the whole tree re-rendered each second whenever
// a reply was in-flight. With the tick local, only the pill itself re-renders.
function ReplyPill({ lock }: { lock: ReplyLock }): React.JSX.Element {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);
  const seconds = Math.floor(ageMs(lock, now) / 1000);
  if (isStale(lock, now)) {
    return (
      <div className="reply-pill stale" role="status">
        <span className="reply-pill-icon" aria-hidden="true">⚠️</span>
        <span>
          <strong>{lock.agent}</strong> is taking unusually long…
        </span>
      </div>
    );
  }
  return (
    <div className="reply-pill" role="status">
      <span className="reply-pill-icon" aria-hidden="true">✏️</span>
      <span>
        <strong>{lock.agent}</strong> is replying… ({seconds}s)
      </span>
    </div>
  );
}

function pillTargetsThisCard(
  annotationId: string,
  replies: Annotation[] | undefined,
  lock: ReplyLock,
): boolean {
  if (lock.responding_to === annotationId) return true;
  if (!replies) return false;
  return replies.some((r) => r.id === lock.responding_to);
}

export function AnnotationCard({
  annotation,
  replies,
  isCurrent,
  navIndex,
  navTotal,
  registerRef,
  replying,
  composerError,
  onOpenReply,
  onSubmitReply,
  onCancelReply,
  replyLock,
  replyAgent,
  onSendToAgent,
}: AnnotationCardProps): React.JSX.Element {
  const range =
    annotation.line_start === annotation.line_end
      ? `${annotation.line_start}`
      : `${annotation.line_start}-${annotation.line_end}`;
  const showPill =
    !!replyLock && pillTargetsThisCard(annotation.id, replies, replyLock);
  // Compute the "Send to {agent}" affordance via the shared core
  // predicate (issue #184, PRD #181). Visibility hides the button
  // entirely; disabled keeps it visible but unclickable with a tooltip.
  // Focused-card emphasis is applied via CSS — `.annotation-block.current
  // .send-to-agent-button` lights up in the accent colour; peer cards
  // stay muted (see spa.ts).
  const sendVerdict = canSendToAgent({
    replyAgentConfigured: !!replyAgent,
    lockHeld: replyLock !== null && replyLock !== undefined,
    authorKind: annotation.author_kind,
    hasReply: (replies?.length ?? 0) > 0,
  });
  const sendTooltip =
    sendVerdict.reason === "lock-held" && replyLock
      ? `${replyLock.agent} is replying — wait`
      : undefined;
  return (
    <div
      className={isCurrent ? "annotation-block current" : "annotation-block"}
      ref={(el) => registerRef?.(annotation.id, el)}
    >
      <div className="ann-header">
        {isCurrent ? (
          <span className="selection-marker" aria-hidden="true">●{" "}</span>
        ) : null}
        {navIndex !== null && navTotal > 0 ? (
          <span className="nav-index">{navIndex} / {navTotal}{" "}</span>
        ) : null}
        <span className={`author-kind ${annotation.author_kind}`}>
          [{annotation.author_kind}]
        </span>{" "}
        {annotation.author !== annotation.author_kind ? (
          <>{annotation.author} · </>
        ) : null}
        {annotation.file}:{range}
      </div>
      <div className="ann-body">
        <AnnotationMarkdown body={annotation.body} />
      </div>
      {replies && replies.length > 0 ? (
        <div className="ann-replies">
          {replies.map((r) => (
            <div
              className="ann-reply"
              key={r.id}
              ref={(el) => registerRef?.(r.id, el)}
              id={`annotation-${r.id}`}
            >
              <div className="ann-header">
                <span className={`author-kind ${r.author_kind}`}>
                  [{r.author_kind}]
                </span>
                {r.author !== r.author_kind ? <> {r.author}</> : null}
              </div>
              <div className="ann-body">
                <AnnotationMarkdown body={r.body} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showPill && replyLock ? <ReplyPill lock={replyLock} /> : null}
      {replying ? (
        <div className="ann-reply-composer">
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            error={composerError ?? null}
            onSubmit={(body) => onSubmitReply?.(body)}
            onCancel={() => onCancelReply?.()}
          />
        </div>
      ) : onOpenReply || (sendVerdict.visible && onSendToAgent) ? (
        <div className="ann-actions">
          {onOpenReply ? (
            <button
              type="button"
              className="reply-button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenReply();
              }}
            >
              Reply
            </button>
          ) : null}
          {sendVerdict.visible && onSendToAgent ? (
            <button
              type="button"
              className="send-to-agent-button"
              disabled={!sendVerdict.enabled}
              title={sendTooltip}
              onClick={(e) => {
                e.stopPropagation();
                if (sendVerdict.enabled) onSendToAgent();
              }}
            >
              Send to {replyAgent}
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
  error: string | null;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

function Composer({
  placeholder,
  submitLabel,
  error,
  onSubmit,
  onCancel,
}: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState<string>("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(value);
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
        value={value}
        onChange={(e) => setValue(e.target.value)}
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

interface AnnotationListProps {
  topLevel: Annotation[];
  repliesByRoot: Map<string, Annotation[]>;
  navIndexById: Map<string, number>;
  navTotal: number;
  currentAnnotationId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
  composerTarget: ComposerTarget | null;
  composerError: string | null;
  onOpenReply: (replies_to: string) => void;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  replyLock: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent: (annotationId: string) => void;
}

function AnnotationList({
  topLevel,
  repliesByRoot,
  navIndexById,
  navTotal,
  currentAnnotationId,
  registerAnnotationRef,
  composerTarget,
  composerError,
  onOpenReply,
  onSubmit,
  onCancel,
  replyLock,
  replyAgent,
  onSendToAgent,
}: AnnotationListProps): React.JSX.Element {
  if (topLevel.length === 0) return <div className="empty">No annotations</div>;
  return (
    <>
      {topLevel.map((a) => {
        const isReplying =
          composerTarget?.kind === "reply" && composerTarget.replies_to === a.id;
        return (
          <AnnotationCard
            key={a.id}
            annotation={a}
            replies={repliesByRoot.get(a.id) ?? []}
            isCurrent={a.id === currentAnnotationId}
            navIndex={navIndexById.get(a.id) ?? null}
            navTotal={navTotal}
            registerRef={registerAnnotationRef}
            replying={isReplying}
            composerError={isReplying ? composerError : null}
            onOpenReply={() => onOpenReply(a.id)}
            onSubmitReply={onSubmit}
            onCancelReply={onCancel}
            replyLock={replyLock}
            replyAgent={replyAgent}
            onSendToAgent={() => onSendToAgent(a.id)}
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
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= total - 1;
  return (
    <div className="sequence-pill" role="navigation" aria-label="Annotation navigation">
      <button
        type="button"
        className="pill-chevron"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label="Previous annotation"
      >
        ‹
      </button>
      <span className="pill-position">
        {idx + 1} / {total}
      </span>
      <button
        type="button"
        className="pill-chevron"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label="Next annotation"
      >
        ›
      </button>
    </div>
  );
}

function CopyPathButton({ path }: { path: string }): React.JSX.Element {
  const [glyph, setGlyph] = useState("⎘");
  const flash = (next: string) => {
    setGlyph(next);
    setTimeout(() => setGlyph("⎘"), 1200);
  };
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!navigator.clipboard) {
      flash("✗");
      return;
    }
    navigator.clipboard.writeText(path).then(
      () => flash("✓"),
      () => flash("✗"),
    );
  };
  return (
    <button
      type="button"
      className="copy-path"
      title="Copy path"
      aria-label="Copy path"
      onClick={click}
    >
      {glyph}
    </button>
  );
}
