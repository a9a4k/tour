import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata, DiffLineAnnotation } from "@pierre/diffs";
import type { Annotation, AnnotationMetadata, DiffFileInfo, TourData, TourSummary } from "./types.js";
import {
  toPierreLineAnnotations,
  buildRangeBackgroundCSS,
  resolveCursorById,
} from "./annotations.js";
import { fileStatusIcon } from "./file-status.js";
import { AnnotationMarkdown } from "./markdown/AnnotationMarkdown.js";
import { TourPicker } from "./TourPicker.js";
import { buildPickerRows } from "../../core/tour-list.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  type VisibleRow,
} from "../../core/file-tree.js";

const STICKY_HEADER_CSS = `
  [data-diffs-header=default] {
    position: sticky;
    top: 0;
    z-index: 10;
    cursor: pointer;
  }
`;

type Layout = "split" | "unified";

const BASE_DIFF_OPTIONS = {
  theme: { dark: "github-dark-default", light: "github-light-default" } as const,
  themeType: "dark" as const,
  hunkSeparators: "metadata" as const,
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
  if (file.classification?.collapsed === true && !annotations.some((a) => a.file === file.name)) {
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

export function App({ initialTourId }: AppProps): React.JSX.Element {
  const [tourId, setTourId] = useState<string | null>(() => readTourFromUrl() ?? initialTourId);
  const [tourList, setTourList] = useState<TourSummary[] | null>(null);
  const [state, setState] = useState<LoadState>({ tour: null, error: null, loaded: false });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentAnnotationId, setCurrentAnnotationId] = useState<string | null>(null);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [layout, setLayout] = useState<Layout>("split");
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const annotationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
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
    const evtSource = new EventSource(`/api/tours/${tourId}/events`);
    evtSource.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as { type: string };
      if (msg.type === "annotation-changed") {
        const res = await fetch(`/api/tours/${tourId}`);
        const data = (await res.json()) as TourData | { error: string };
        if (!("error" in data)) setState({ tour: data, error: null, loaded: true });
      }
    };
    return () => evtSource.close();
  }, [tourId]);

  const tour = state.tour;
  const annotations = useMemo(() => tour?.annotations ?? [], [tour?.annotations]);
  const currentIdx = useMemo(
    () => resolveCursorById(annotations, currentAnnotationId),
    [annotations, currentAnnotationId],
  );

  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!tour || !tour.diff) return [];
    return parsePatchFiles(tour.diff, tour.id).flatMap((p) => p.files);
  }, [tour?.diff, tour?.id]);

  const modelFiles = useMemo(() => tour?.diffModel?.files ?? [], [tour?.diffModel?.files]);
  const tree = useMemo(() => compress(buildTree(modelFiles)), [modelFiles]);
  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of annotations) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [annotations]);
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
      const newIdx = Math.max(0, Math.min(annotations.length - 1, currentIdx + delta));
      if (newIdx === currentIdx) return;
      const target = annotations[newIdx];
      setCurrentAnnotationId(target.id);
      setSelectedFile(target.file);
      setCollapsedOverrides((prev) =>
        prev[target.file] === false ? prev : { ...prev, [target.file]: false },
      );
      revealFileAncestors(target.file);
      scrollAnnotationIntoView(target.id);
    },
    [annotations, currentIdx, revealFileAncestors, scrollAnnotationIntoView],
  );

  // Re-anchor cursor by id whenever annotations change. On first sight of a
  // non-empty list, set cursor to first, anchor the tree highlight to its
  // file, reveal ancestors, and scroll its card into view. On SSE reload with
  // the same id present, do nothing. If the id is gone, re-anchor to the new
  // first annotation (and re-anchor the tree to it too). Functional setState
  // for the empty-list branch keeps `selectedFile` out of the dep array so a
  // user click while annotations is empty is not clobbered by this effect.
  useEffect(() => {
    if (annotations.length === 0) {
      setCurrentAnnotationId((curr) => (curr === null ? curr : null));
      setSelectedFile((curr) => (curr === null ? curr : null));
      return;
    }
    if (currentAnnotationId === null) {
      const first = annotations[0];
      setCurrentAnnotationId(first.id);
      setSelectedFile(first.file);
      revealFileAncestors(first.file);
      scrollAnnotationIntoView(first.id);
      return;
    }
    const found = annotations.some((a) => a.id === currentAnnotationId);
    if (!found) {
      const first = annotations[0];
      setCurrentAnnotationId(first.id);
      setSelectedFile(first.file);
      revealFileAncestors(first.file);
    }
  }, [annotations, currentAnnotationId, revealFileAncestors, scrollAnnotationIntoView]);

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
    const back = triggerRef.current ?? titleButtonRef.current;
    requestAnimationFrame(() => back?.focus());
  }, []);

  // Global keydown: n / p step the sequence cursor; l flips diff layout;
  // t toggles the tour picker. While the picker is open, n / p / l are inert
  // (the picker owns input). No-op when focus is in an editable element so
  // the shortcuts never steal text input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "p" && e.key !== "l" && e.key !== "t") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      if (pickerOpen) {
        // Picker handles its own keys (including `t` to close). Block n/p/l.
        return;
      }
      e.preventDefault();
      if (e.key === "t") {
        openPicker();
      } else if (e.key === "l") {
        setLayout((prev) => (prev === "split" ? "unified" : "split"));
      } else {
        navigateBy(e.key === "n" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigateBy, pickerOpen, openPicker]);

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
      const back = triggerRef.current ?? titleButtonRef.current;
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

  return (
    <>
      <div className="tour-header">
        <div className="tour-header-text">
          <button
            ref={titleButtonRef}
            type="button"
            className="tour-title-btn"
            aria-label="Open tour picker"
            onClick={openPicker}
          >
            <h1>{tour.title || tour.id}</h1>
            <div className="meta">
              {tour.status} · {tour.id} · {tour.created_at}
            </div>
          </button>
        </div>
        <LayoutToggle layout={layout} onChange={setLayout} />
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
              annotations={tour.annotations}
              currentAnnotationId={currentAnnotationId}
              registerAnnotationRef={registerAnnotationRef}
            />
          ) : (
            parsedFiles.map((f) => (
              <FileBlock
                key={f.name}
                fileDiff={f}
                annotations={tour.annotations}
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
              />
            ))
          )}
        </main>
      </div>
      <SequencePill
        idx={currentIdx}
        total={annotations.length}
        onPrev={() => navigateBy(-1)}
        onNext={() => navigateBy(1)}
      />
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
  const caret = row.collapsed ? "▸" : "▾";
  return (
    <button
      type="button"
      className="folder-entry"
      style={{ paddingLeft: 16 + row.depth * 12 }}
      onClick={() => onToggle(row.path)}
    >
      <span className="folder-icon">{caret}</span>
      <span className="folder-name">{row.displayName}</span>
      {row.annotationCount > 0 ? <span className="badge">{row.annotationCount}</span> : null}
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
  const icon = fileStatusIcon(row.file.type);
  return (
    <button
      ref={registerRef}
      type="button"
      className={`file-entry${selected ? " selected" : ""}`}
      style={{ paddingLeft: 16 + row.depth * 12 }}
      onClick={() => onSelect(row.path)}
    >
      <span className={`file-icon ${icon}`}>{icon}</span>
      <span className="file-name">{row.displayName}</span>
      {row.file.classification?.reason ? (
        <span className="reason-tag">{row.file.classification.reason}</span>
      ) : null}
      {row.annotationCount > 0 ? <span className="badge">{row.annotationCount}</span> : null}
    </button>
  );
}

interface FileBlockProps {
  fileDiff: FileDiffMetadata;
  annotations: Annotation[];
  modelFile: TourData["diffModel"]["files"][number] | undefined;
  registerRef: (el: HTMLDivElement | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentAnnotationId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
  layout: Layout;
}

function FileBlock({
  fileDiff,
  annotations,
  modelFile,
  registerRef,
  collapsed,
  onToggleCollapsed,
  currentAnnotationId,
  registerAnnotationRef,
  layout,
}: FileBlockProps): React.JSX.Element {
  const reason = modelFile?.classification?.reason;

  const lineAnns = useMemo<DiffLineAnnotation<AnnotationMetadata>[]>(
    () => toPierreLineAnnotations(annotations, fileDiff.name),
    [annotations, fileDiff.name],
  );

  const options = useMemo(() => {
    const rangeCSS = buildRangeBackgroundCSS(annotations, fileDiff.name);
    const unsafeCSS = rangeCSS ? `${STICKY_HEADER_CSS}\n${rangeCSS}` : STICKY_HEADER_CSS;
    return { ...BASE_DIFF_OPTIONS, diffStyle: layout, unsafeCSS, collapsed };
  }, [annotations, fileDiff.name, collapsed, layout]);

  const renderAnnotation = useCallback(
    (ann: DiffLineAnnotation<AnnotationMetadata>): React.ReactNode => {
      if (!ann.metadata?.isAnchor) return null;
      const a = ann.metadata.annotation;
      return (
        <AnnotationCard
          annotation={a}
          isCurrent={a.id === currentAnnotationId}
          registerRef={registerAnnotationRef}
        />
      );
    },
    [currentAnnotationId, registerAnnotationRef],
  );

  const onWrapperClick = (e: React.MouseEvent) => {
    const onHeader = e.nativeEvent.composedPath().some(
      (n) => n instanceof HTMLElement && n.dataset.diffsHeader === "default",
    );
    if (onHeader) onToggleCollapsed();
  };

  return (
    <div className="file-block" ref={registerRef} onClick={onWrapperClick}>
      <FileDiff<AnnotationMetadata>
        fileDiff={fileDiff}
        options={options}
        lineAnnotations={lineAnns}
        renderAnnotation={renderAnnotation}
        renderHeaderMetadata={() => (
          <>
            {reason ? <span className="reason-tag">{reason}</span> : null}
            <CopyPathButton path={fileDiff.name} />
          </>
        )}
        disableWorkerPool
      />
    </div>
  );
}

interface AnnotationCardProps {
  annotation: Annotation;
  isCurrent: boolean;
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
}

function AnnotationCard({ annotation, isCurrent, registerRef }: AnnotationCardProps): React.JSX.Element {
  const range =
    annotation.line_start === annotation.line_end
      ? `${annotation.line_start}`
      : `${annotation.line_start}-${annotation.line_end}`;
  return (
    <div
      className={isCurrent ? "annotation-block current" : "annotation-block"}
      ref={(el) => registerRef?.(annotation.id, el)}
    >
      <div className="ann-header">
        {annotation.author} · {annotation.file}:{range}
      </div>
      <div className="ann-body">
        <AnnotationMarkdown body={annotation.body} />
      </div>
    </div>
  );
}

interface AnnotationListProps {
  annotations: Annotation[];
  currentAnnotationId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
}

function AnnotationList({
  annotations,
  currentAnnotationId,
  registerAnnotationRef,
}: AnnotationListProps): React.JSX.Element {
  if (annotations.length === 0) return <div className="empty">No annotations</div>;
  return (
    <>
      {annotations.map((a) => (
        <AnnotationCard
          key={a.id}
          annotation={a}
          isCurrent={a.id === currentAnnotationId}
          registerRef={registerAnnotationRef}
        />
      ))}
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
