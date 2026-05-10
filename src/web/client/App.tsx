import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, MultiFileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileContents, FileDiffMetadata, DiffLineAnnotation } from "@pierre/diffs";
import type { Annotation, AnnotationMetadata, DiffFileInfo, TourData, TourSummary } from "./types.js";
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
  validateCursor,
  cursorFromAnnotation,
  type Cursor,
} from "../../core/cursor-state.js";
import { dispatchCursorKey } from "./cursor-keymap.js";
import { buildCursorOutlineCSS, buildHoverTintCSS } from "./cursor-css.js";

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

const BASE_DIFF_OPTIONS = {
  theme: { dark: "github-dark-default", light: "github-light-default" } as const,
  themeType: "dark" as const,
  hunkSeparators: "metadata" as const,
  overflow: "wrap" as const,
  expandUnchanged: true,
  expansionLineCount: 20,
};

interface AppProps {
  initialTourId: string | null;
}

interface LoadState {
  tour: TourData | null;
  error: string | null;
  loaded: boolean;
}

function defaultCollapsedFor(file: DiffFileInfo, annotations: Annotation[]): boolean {
  const reason = file.classification?.reason;
  if (reason === "binary") return true;
  if (
    file.classification?.collapsed === true &&
    !annotations.some((a) => a.file === file.name && isTopLevel(a))
  ) {
    return true;
  }
  return false;
}

function readTourFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const v = params.get("tour");
  return v && v.length > 0 ? v : null;
}

function readAnnFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const v = params.get("ann");
  return v && v.length > 0 ? v : null;
}

export function App({ initialTourId }: AppProps): React.JSX.Element {
  const [tourId, setTourId] = useState<string | null>(() => readTourFromUrl() ?? initialTourId);
  const [tourList, setTourList] = useState<TourSummary[] | null>(null);
  const [state, setState] = useState<LoadState>({ tour: null, error: null, loaded: false });
  const [replyLock, setReplyLock] = useState<ReplyLock | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
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
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sidebarRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
      const fromUrl = readTourFromUrl();
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
      const data = (await res.json()) as TourData | { error: string };
      if (cancelled) return;
      if ("error" in data) {
        setState({ tour: null, error: data.error, loaded: true });
      } else {
        setState({ tour: data, error: null, loaded: true });
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
        const data = (await res.json()) as TourData | { error: string };
        if (!("error" in data)) setState({ tour: data, error: null, loaded: true });
      } else if (msg.type === "reply-in-flight" || msg.type === "reply-cleared") {
        await refetchLock();
      }
    };
    return () => {
      cancelled = true;
      evtSource.close();
    };
  }, [tourId]);

  // Tick the wall clock once a second only while a lock is in-flight, so the
  // "(Ns)" counter advances without burning renders on the idle path.
  useEffect(() => {
    if (!replyLock) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [replyLock]);

  const tour = state.tour;
  const annotations = useMemo(() => tour?.annotations ?? [], [tour?.annotations]);
  const topLevel = useMemo(() => topLevelAnnotations(annotations), [annotations]);
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

  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!tour || !tour.diff) return [];
    const raw = parsePatchFiles(tour.diff, tour.id).flatMap((p) => p.files);
    return sortFilesForStream(raw);
  }, [tour?.diff, tour?.id]);

  const modelFiles = useMemo(() => tour?.diffModel?.files ?? [], [tour?.diffModel?.files]);
  const tree = useMemo(() => compress(buildTree(modelFiles)), [modelFiles]);
  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of topLevel) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [topLevel]);
  const visibleRows = useMemo<VisibleRow<DiffFileInfo>[]>(
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

  const scrollAnnotationIntoView = useCallback((id: string) => {
    requestAnimationFrame(() => {
      annotationRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const navigateBy = useCallback(
    (delta: number) => {
      if (currentIdx === -1) return;
      const newIdx = Math.max(0, Math.min(topLevel.length - 1, currentIdx + delta));
      if (newIdx === currentIdx) return;
      const target = topLevel[newIdx];
      setCurrentAnnotationId(target.id);
      setSelectedFile(target.file);
      setCollapsedOverrides((prev) =>
        prev[target.file] === false ? prev : { ...prev, [target.file]: false },
      );
      revealFileAncestors(target.file);
      scrollAnnotationIntoView(target.id);
      // β-coupling per ADR 0012 (mirrors ADR 0011): annotation nav
      // moves the line cursor too. Reverse direction (j/k/h/l) stays
      // decoupled — line motion is for code reading, annotation motion
      // is for engaging with conversation.
      setCursor(cursorFromAnnotation(target));
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
    if (!tour || tour.id !== tourId) return;
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
      scrollAnnotationIntoView(target.id);
      return;
    }
    const found = topLevel.some((a) => a.id === currentAnnotationId);
    if (!found) {
      const first = topLevel[0];
      setCurrentAnnotationId(first.id);
      setSelectedFile(first.file);
      revealFileAncestors(first.file);
    }
  }, [tour, tourId, topLevel, currentAnnotationId, revealFileAncestors, scrollAnnotationIntoView]);

  // Mirror the current top-level Annotation cursor into the URL via
  // replaceState — chosen over pushState so the browser back button steps
  // over Tour switches, not over every n/p keystroke. Same gate as the
  // restorer above: writing during the in-flight Tour-switch window can
  // leak the previous Tour's `ann=` into the new URL. When the cursor is
  // null on a Tour with zero annotations and a stale `ann=` lingers,
  // strip it so the URL self-heals and shared links can't propagate
  // broken state. When cursor is null but topLevel is non-empty, the
  // restorer is about to anchor — defer the URL write to that pass so
  // we don't strip-then-restore a valid `ann=` in a single cycle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!tour || tour.id !== tourId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tour") !== tourId) return;
    if (currentAnnotationId === null && topLevel.length > 0) return;
    if (params.get("ann") === currentAnnotationId) return;
    if (currentAnnotationId === null) params.delete("ann");
    else params.set("ann", currentAnnotationId);
    window.history.replaceState(window.history.state, "", `/?${params.toString()}`);
  }, [currentAnnotationId, tour, tourId, topLevel]);

  // Keep the selected sidebar row visible. block:"nearest" — already-visible
  // rows don't jump.
  useEffect(() => {
    if (selectedFile === null) return;
    const el = sidebarRowRefs.current.get(selectedFile);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedFile]);

  const openPicker = useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    const back = triggerRef.current ?? pickerButtonRef.current;
    requestAnimationFrame(() => back?.focus());
  }, []);

  // Global keydown router (ADR 0012). Cursor motion (j/k/h/l/arrows),
  // side selection, annotate-at-cursor (a), annotation nav (n/p, with
  // β-coupling to the line cursor), layout toggle (Shift-L, rebound
  // from the previous lowercase l), and picker open (t) all flow
  // through the pure dispatchCursorKey classifier so the keymap
  // contract is testable independent of React state plumbing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const focusInEditable = !!(
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      );
      const action = dispatchCursorKey(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
        },
        {
          cursorExists: cursor !== null,
          composerOpen: composerTarget !== null,
          pickerOpen,
          focusInEditable,
        },
      );
      if (action.type === "noop") return;
      e.preventDefault();
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
        case "move-down":
          // Lazy materialization rule (ADR 0012): the first j/k just
          // SHOWS the cursor at the default target, no move past it.
          if (!cursor) {
            materializeCursor();
            return;
          }
          setCursor((c) => moveCursor(c, "down", flatRowsList));
          return;
        case "move-up":
          if (!cursor) {
            materializeCursor();
            return;
          }
          setCursor((c) => moveCursor(c, "up", flatRowsList));
          return;
        case "set-side-additions":
          if (!cursor) {
            materializeCursor();
            return;
          }
          setCursor((c) => setCursorSide(c, "additions", flatRowsList));
          return;
        case "set-side-deletions":
          if (!cursor) {
            materializeCursor();
            return;
          }
          setCursor((c) => setCursorSide(c, "deletions", flatRowsList));
          return;
        case "annotate-at-cursor": {
          if (!cursor) return;
          setComposerError(null);
          setComposerTarget({
            kind: "top-level",
            file: cursor.file,
            side: cursor.side,
            line_start: cursor.lineNumber,
            line_end: cursor.lineNumber,
          });
          return;
        }
        case "materialize-and-annotate": {
          const seeded = materializeCursor();
          if (!seeded) return;
          setComposerError(null);
          setComposerTarget({
            kind: "top-level",
            file: seeded.file,
            side: seeded.side,
            line_start: seeded.lineNumber,
            line_end: seeded.lineNumber,
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

  const registerAnnotationRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) annotationRefs.current.set(id, el);
    else annotationRefs.current.delete(id);
  }, []);

  const isCollapsed = useCallback(
    (fileName: string): boolean => {
      if (fileName in collapsedOverrides) return collapsedOverrides[fileName];
      const f = tour?.diffModel?.files.find((x) => x.name === fileName);
      return f ? defaultCollapsedFor(f, annotations) : false;
    },
    [collapsedOverrides, tour, annotations],
  );

  const toggleCollapsed = useCallback(
    (fileName: string) => {
      setCollapsedOverrides((prev) => ({ ...prev, [fileName]: !isCollapsed(fileName) }));
    },
    [isCollapsed],
  );

  // Cursor walk sequence (ADR 0012). Per-file planned rows are built
  // from each Pierre-parsed file + the annotation list + the active
  // layout (split vs unified differ in pairing). The flat-rows builder
  // skips folded files and hunk-header / annotation rows, leaving a
  // walkable sequence indexed by moveCursor. Pierre's expandUnchanged
  // (PRD #106) chevron-revealed rows are DOM-only and not in this
  // list; v1 walks the patch's context rows only.
  const plannedRowsByFile = useMemo(() => {
    const out = new Map<string, ReturnType<typeof planRows>>();
    for (const f of parsedFiles) {
      out.set(f.name, planRows(f, annotations, layout));
    }
    return out;
  }, [parsedFiles, annotations, layout]);

  const flatRowsList = useMemo(() => {
    return buildFlatRows(
      parsedFiles.map((f) => ({ name: f.name, type: "change", hunks: [] })),
      plannedRowsByFile,
      isCollapsed,
    );
  }, [parsedFiles, plannedRowsByFile, isCollapsed]);

  // Validate-in-place when the row sequence shifts under the cursor's
  // feet (fold toggle, bundle reload, layout switch). Lazy
  // materialization rule: we never seed here — first interaction does.
  useEffect(() => {
    if (cursor === null) return;
    const validated = validateCursor(cursor, flatRowsList);
    if (validated !== cursor) setCursor(validated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRowsList]);

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
      // Click-to-annotate also sets the cursor at the clicked anchor
      // (ADR 0012). preferredSide tracks the clicked side so subsequent
      // keyboard motion preserves the user's mouse-expressed preference.
      setCursor({ file, lineNumber: line, side, preferredSide: side });
    },
    [],
  );

  const openReplyComposer = useCallback((replies_to: string) => {
    setComposerError(null);
    setComposerTarget({ kind: "reply", replies_to });
  }, []);

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
          window.history.pushState(
            { tourId: id },
            "",
            `/?tour=${encodeURIComponent(id)}`,
          );
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
    if (tour) counts[tour.id] = tour.annotations.length;
    return buildPickerRows({ tours: tourList, annotationCounts: counts, now: Date.now() });
  }, [tourList, tour]);

  if (!state.loaded && !tourList) {
    return <div className="empty">Loading…</div>;
  }

  if (tourList && tourList.length === 0) {
    return <div className="empty">No tours found. Create one with: tour create --head HEAD</div>;
  }

  if (state.error) {
    return <div className="empty">Error: {state.error}</div>;
  }

  if (!tour) {
    return <div className="empty">Loading…</div>;
  }

  const titleIsEmpty = !tour.title;

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
            ☰
          </button>
          <h1 className={titleIsEmpty ? "untitled" : undefined}>
            {tour.title || "(untitled)"}
          </h1>
          <span className="tour-refs">
            {tour.base_source} ← {tour.head_source}
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
                registerRef={(el) => {
                  if (el) sidebarRowRefs.current.set(row.path, el);
                  else sidebarRowRefs.current.delete(row.path);
                }}
                onSelect={(name) => {
                  setSelectedFile(name);
                  const el = fileRefs.current.get(name);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            ),
          )}
        </aside>
        <main className="app-main">
          {tour.snapshotLost ? (
            <div className="banner">
              Snapshot lost — annotations preserved but diff cannot be displayed
            </div>
          ) : null}
          {tour.snapshotLost ? (
            <AnnotationList
              topLevel={topLevel}
              repliesByRoot={repliesByRoot}
              currentAnnotationId={currentAnnotationId}
              registerAnnotationRef={registerAnnotationRef}
              composerTarget={composerTarget}
              composerError={composerError}
              onOpenReply={openReplyComposer}
              onSubmit={submitComposer}
              onCancel={closeComposer}
              replyLock={replyLock}
              now={now}
            />
          ) : (
            parsedFiles.map((f) => (
              <FileBlock
                key={f.name}
                fileDiff={f}
                annotations={tour.annotations}
                repliesByRoot={repliesByRoot}
                modelFile={tour.diffModel?.files.find((m) => m.name === f.name)}
                registerRef={(el) => {
                  if (el) fileRefs.current.set(f.name, el);
                  else fileRefs.current.delete(f.name);
                }}
                collapsed={isCollapsed(f.name)}
                onToggleCollapsed={() => toggleCollapsed(f.name)}
                currentAnnotationId={currentAnnotationId}
                registerAnnotationRef={registerAnnotationRef}
                layout={layout}
                composerTarget={composerTarget}
                composerError={composerError}
                cursor={cursor}
                onOpenTopLevel={openTopLevelComposer}
                onOpenReply={openReplyComposer}
                onSubmit={submitComposer}
                onCancel={closeComposer}
                replyLock={replyLock}
                now={now}
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
  row: Extract<VisibleRow<DiffFileInfo>, { kind: "folder" }>;
  onToggle: (path: string) => void;
}

function FolderRow({ row, onToggle }: FolderRowProps): React.JSX.Element {
  const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      className="folder-entry"
      style={{ paddingLeft: 16 + row.depth * 16 }}
      onClick={() => onToggle(row.path)}
    >
      <Chevron className="tree-icon" />
      <FileDirectoryFillIcon className="tree-icon" />
      <span className="folder-name">{row.displayName}</span>
    </button>
  );
}

interface FileRowProps {
  row: Extract<VisibleRow<DiffFileInfo>, { kind: "file" }>;
  selected: boolean;
  onSelect: (name: string) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}

function FileRow({ row, selected, onSelect, registerRef }: FileRowProps): React.JSX.Element {
  const { Icon, statusClass } = fileIcon(row.file.type);
  return (
    <button
      ref={registerRef}
      type="button"
      className={`file-entry${selected ? " selected" : ""}`}
      style={{ paddingLeft: 16 + row.depth * 16 }}
      onClick={() => onSelect(row.path)}
    >
      <Icon className={`status-icon ${statusClass}`} />
      <span className="file-name">{row.displayName}</span>
      {row.annotationCount > 0 ? <span className="badge">{row.annotationCount}</span> : null}
    </button>
  );
}

interface FileBlockProps {
  fileDiff: FileDiffMetadata;
  annotations: Annotation[];
  repliesByRoot: Map<string, Annotation[]>;
  modelFile: TourData["diffModel"]["files"][number] | undefined;
  registerRef: (el: HTMLDivElement | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentAnnotationId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
  layout: Layout;
  composerTarget: ComposerTarget | null;
  composerError: string | null;
  cursor: Cursor | null;
  onOpenTopLevel: (file: string, side: "additions" | "deletions", line: number) => void;
  onOpenReply: (replies_to: string) => void;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  replyLock: ReplyLock | null;
  now: number;
}

// Pierre's hidden-context expansion needs the full pre/post-image of each
// file. When the bundle ships oldContent/newContent (everything except
// binary files), switch from <FileDiff fileDiff=…> (patch-only, isPartial)
// to <MultiFileDiff oldFile= newFile=…> so chevrons can resolve unchanged
// lines on demand. Renamed files key the old side off prevName.
function fileContentsFor(
  fileDiff: FileDiffMetadata,
  modelFile: TourData["diffModel"]["files"][number] | undefined,
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

// Per ADR 0012: context rows annotate as side="additions" (CONTEXT.md
// convention). Click-to-annotate used to silently drop context rows; the
// cursor walks them, so click resolution must too.
function sideFromLineType(t: string | undefined): "additions" | "deletions" | null {
  if (t === "addition" || t === "change-addition") return "additions";
  if (t === "deletion" || t === "change-deletion") return "deletions";
  if (t === "context") return "additions";
  return null;
}

function findAnnotatableLine(path: EventTarget[]): { line: number; side: "additions" | "deletions" } | null {
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    const lineAttr = node.dataset.line;
    if (lineAttr === undefined) continue;
    const side = sideFromLineType(node.dataset.lineType);
    if (!side) return null;
    const line = Number(lineAttr);
    if (!Number.isFinite(line)) return null;
    return { line, side };
  }
  return null;
}

function FileBlock({
  fileDiff,
  annotations,
  repliesByRoot,
  modelFile,
  registerRef,
  collapsed,
  onToggleCollapsed,
  currentAnnotationId,
  registerAnnotationRef,
  layout,
  composerTarget,
  composerError,
  cursor,
  onOpenTopLevel,
  onOpenReply,
  onSubmit,
  onCancel,
  replyLock,
  now,
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
    const cursorCSS = buildCursorOutlineCSS(cursor, fileDiff.name);
    const hoverCSS = buildHoverTintCSS(composerTarget !== null);
    const parts = [
      STICKY_HEADER_CSS,
      COMMENT_AFFORDANCE_CSS,
      hoverCSS,
      rangeCSS,
      cursorCSS,
    ].filter((s) => s !== "");
    const unsafeCSS = parts.join("\n");
    return { ...BASE_DIFF_OPTIONS, diffStyle: layout, unsafeCSS, collapsed };
  }, [annotations, fileDiff.name, collapsed, layout, cursor, composerTarget]);

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
          registerRef={registerAnnotationRef}
          replying={isReplying}
          composerError={isReplying ? composerError : null}
          onOpenReply={() => onOpenReply(a.id)}
          onSubmitReply={onSubmit}
          onCancelReply={onCancel}
          replyLock={replyLock}
          now={now}
        />
      );
    },
    [
      currentAnnotationId,
      registerAnnotationRef,
      repliesByRoot,
      composerTarget,
      composerError,
      onSubmit,
      onCancel,
      onOpenReply,
      replyLock,
      now,
    ],
  );

  const onWrapperClick = (e: React.MouseEvent) => {
    const path = e.nativeEvent.composedPath();
    const onHeader = path.some(
      (n) => n instanceof HTMLElement && n.dataset.diffsHeader === "default",
    );
    if (onHeader) {
      onToggleCollapsed();
      return;
    }
    if (collapsed) return;
    // Ignore clicks inside an annotation card or a composer (those manage
    // their own affordances). Otherwise route to the top-level composer.
    const insideCard = path.some(
      (n) =>
        n instanceof HTMLElement &&
        (n.classList?.contains("annotation-block") ||
          n.classList?.contains("composer")),
    );
    if (insideCard) return;
    const hit = findAnnotatableLine(path);
    if (!hit) return;
    onOpenTopLevel(fileDiff.name, hit.side, hit.line);
  };

  const headerMetadata = () => (
    <>
      {reason ? <span className="reason-tag">{reason}</span> : null}
      <CopyPathButton path={fileDiff.name} />
    </>
  );

  const contents = fileContentsFor(fileDiff, modelFile);

  return (
    <div className="file-block" ref={registerRef} onClick={onWrapperClick}>
      {contents ? (
        <MultiFileDiff<AnnotationMetadata>
          oldFile={contents.oldFile}
          newFile={contents.newFile}
          options={options}
          lineAnnotations={lineAnns}
          renderAnnotation={renderAnnotation}
          renderHeaderMetadata={headerMetadata}
          disableWorkerPool
        />
      ) : (
        <FileDiff<AnnotationMetadata>
          fileDiff={fileDiff}
          options={options}
          lineAnnotations={lineAnns}
          renderAnnotation={renderAnnotation}
          renderHeaderMetadata={headerMetadata}
          disableWorkerPool
        />
      )}
    </div>
  );
}

interface AnnotationCardProps {
  annotation: Annotation;
  replies?: Annotation[];
  isCurrent: boolean;
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  replying?: boolean;
  composerError?: string | null;
  onOpenReply?: () => void;
  onSubmitReply?: (body: string) => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  now?: number;
}

function ReplyPill({ lock, now }: { lock: ReplyLock; now: number }): React.JSX.Element {
  const seconds = Math.floor(ageMs(lock, now) / 1000);
  if (isStale(lock, now)) {
    return (
      <div className="reply-pill stale" role="status">
        <span className="reply-pill-icon" aria-hidden="true">⚠️</span>
        <span>
          <strong>{lock.agent}</strong> is taking unusually long…
        </span>
        <span className="reply-pill-hint">Run <code>tour reply-cancel {lock.tour_id}</code></span>
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

function AnnotationCard({
  annotation,
  replies,
  isCurrent,
  registerRef,
  replying,
  composerError,
  onOpenReply,
  onSubmitReply,
  onCancelReply,
  replyLock,
  now,
}: AnnotationCardProps): React.JSX.Element {
  const range =
    annotation.line_start === annotation.line_end
      ? `${annotation.line_start}`
      : `${annotation.line_start}-${annotation.line_end}`;
  const showPill =
    !!replyLock && pillTargetsThisCard(annotation.id, replies, replyLock);
  return (
    <div
      className={isCurrent ? "annotation-block current" : "annotation-block"}
      ref={(el) => registerRef?.(annotation.id, el)}
    >
      <div className="ann-header">
        <span className={`author-kind ${annotation.author_kind}`}>
          [{annotation.author_kind}]
        </span>{" "}
        {annotation.author} · {annotation.file}:{range}
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
                </span>{" "}
                {r.author}
              </div>
              <div className="ann-body">
                <AnnotationMarkdown body={r.body} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showPill && replyLock ? <ReplyPill lock={replyLock} now={now ?? Date.now()} /> : null}
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
      ) : onOpenReply ? (
        <div className="ann-actions">
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
  currentAnnotationId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
  composerTarget: ComposerTarget | null;
  composerError: string | null;
  onOpenReply: (replies_to: string) => void;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  replyLock: ReplyLock | null;
  now: number;
}

function AnnotationList({
  topLevel,
  repliesByRoot,
  currentAnnotationId,
  registerAnnotationRef,
  composerTarget,
  composerError,
  onOpenReply,
  onSubmit,
  onCancel,
  replyLock,
  now,
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
            registerRef={registerAnnotationRef}
            replying={isReplying}
            composerError={isReplying ? composerError : null}
            onOpenReply={() => onOpenReply(a.id)}
            onSubmitReply={onSubmit}
            onCancelReply={onCancel}
            replyLock={replyLock}
            now={now}
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
