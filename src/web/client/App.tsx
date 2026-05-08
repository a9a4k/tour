import { useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata, DiffLineAnnotation } from "@pierre/diffs";
import type { Annotation, AnnotationMetadata, TourData, TourSummary } from "./types.js";
import { toPierreLineAnnotations } from "./annotations.js";
import { fileStatusIcon, countAnnotationsForFile, fileStat } from "./file-status.js";

const DIFF_OPTIONS = {
  diffStyle: "unified" as const,
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

export function App({ initialTourId }: AppProps): React.JSX.Element {
  const [tourId, setTourId] = useState<string | null>(initialTourId);
  const [tourList, setTourList] = useState<TourSummary[] | null>(null);
  const [state, setState] = useState<LoadState>({ tour: null, error: null, loaded: false });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
    if (!tourId) return;
    let cancelled = false;
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

  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!tour || !tour.diff) return [];
    return parsePatchFiles(tour.diff, tour.id).flatMap((p) => p.files);
  }, [tour?.diff, tour?.id]);

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

  const sortedFiles = [...(tour.diffModel?.files ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <>
      <aside className="app-sidebar">
        <h2>Files</h2>
        {sortedFiles.map((f) => {
          const icon = fileStatusIcon(f.type);
          const annCount = countAnnotationsForFile(tour.annotations, f.name);
          return (
            <button
              key={f.name}
              type="button"
              className={`file-entry${selectedFile === f.name ? " selected" : ""}`}
              onClick={() => {
                setSelectedFile(f.name);
                const el = fileRefs.current.get(f.name);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span className={`file-icon ${icon}`}>{icon}</span>
              <span className="file-name">{f.name}</span>
              {f.classification?.reason ? (
                <span className="reason-tag">{f.classification.reason}</span>
              ) : null}
              {annCount > 0 ? <span className="badge">{annCount}</span> : null}
            </button>
          );
        })}
      </aside>
      <main className="app-main">
        <div className="tour-header">
          <h1>{tour.title || tour.id}</h1>
          <div className="meta">
            {tour.status} · {tour.id} · {tour.created_at}
          </div>
        </div>
        {tour.snapshotLost ? (
          <div className="banner">
            Snapshot lost — annotations preserved but diff cannot be displayed
          </div>
        ) : null}
        {tour.snapshotLost ? (
          <AnnotationList annotations={tour.annotations} />
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
            />
          ))
        )}
      </main>
    </>
  );
}

interface FileBlockProps {
  fileDiff: FileDiffMetadata;
  annotations: Annotation[];
  modelFile: TourData["diffModel"]["files"][number] | undefined;
  registerRef: (el: HTMLDivElement | null) => void;
}

function FileBlock({ fileDiff, annotations, modelFile, registerRef }: FileBlockProps): React.JSX.Element {
  const isBinary = modelFile?.classification?.reason === "binary";
  const startCollapsed =
    isBinary ||
    (modelFile?.classification?.collapsed === true &&
      !annotations.some((a) => a.file === fileDiff.name));
  const [collapsed, setCollapsed] = useState(startCollapsed);

  const lineAnns = useMemo<DiffLineAnnotation<AnnotationMetadata>[]>(
    () => toPierreLineAnnotations(annotations, fileDiff.name),
    [annotations, fileDiff.name],
  );

  const stat = fileStat(modelFile?.hunks ?? []);

  return (
    <div className="file-block" ref={registerRef}>
      <div
        className="file-block-header"
        style={isBinary ? undefined : { cursor: "pointer" }}
        onClick={() => {
          if (!isBinary) setCollapsed((c) => !c);
        }}
      >
        <span>{fileDiff.name}</span>
        <CopyPathButton path={fileDiff.name} />
        {modelFile?.classification?.reason ? (
          <span className="reason">{modelFile.classification.reason}</span>
        ) : null}
        {isBinary ? (
          <span className="stat">Binary file changed</span>
        ) : (
          <span className="stat">
            <span className="add">+{stat.add}</span> <span className="del">-{stat.del}</span>
          </span>
        )}
      </div>
      {isBinary || collapsed ? null : (
        <FileDiff<AnnotationMetadata>
          fileDiff={fileDiff}
          options={DIFF_OPTIONS}
          lineAnnotations={lineAnns}
          renderAnnotation={renderAnnotationContent}
          disableWorkerPool
        />
      )}
    </div>
  );
}

function AnnotationCard({ annotation }: { annotation: Annotation }): React.JSX.Element {
  const range =
    annotation.line_start === annotation.line_end
      ? `${annotation.line_start}`
      : `${annotation.line_start}-${annotation.line_end}`;
  return (
    <div className="annotation-block">
      <div className="ann-header">
        {annotation.author} · {annotation.file}:{range}
      </div>
      <div className="ann-body">{annotation.body}</div>
    </div>
  );
}

function renderAnnotationContent(ann: DiffLineAnnotation<AnnotationMetadata>): React.ReactNode {
  if (!ann.metadata?.isAnchor) return null;
  return <AnnotationCard annotation={ann.metadata.annotation} />;
}

function AnnotationList({ annotations }: { annotations: Annotation[] }): React.JSX.Element {
  if (annotations.length === 0) return <div className="empty">No annotations</div>;
  return (
    <>
      {annotations.map((a) => (
        <AnnotationCard key={a.id} annotation={a} />
      ))}
    </>
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
