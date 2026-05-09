import { useEffect, useMemo, useRef, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile, FileDiffMetadata } from "../core/diff-model.js";
import { parseFileDiffMetadata } from "../core/diff-model.js";
import type { PlannedRow } from "../core/diff-rows.js";
import { planRows } from "../core/diff-rows.js";
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
import { shortId } from "../core/ids.js";

function initialPickerCursor(rows: PickerRow[], currentId: string): number {
  if (rows.length === 0) return 0;
  const idx = rows.findIndex((r) => r.id !== currentId);
  return idx === -1 ? 0 : idx;
}

export interface TourBundle {
  tour: Tour;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
  classifications: Record<string, FileClassification>;
}

interface AppProps {
  tour: Tour;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
  classifications?: Record<string, FileClassification>;
  loadTour?: (id: string) => Promise<TourBundle>;
  loadTours?: () => Promise<{ tours: Tour[]; annotationCounts: Record<string, number> }>;
}

function statusIcon(type: string): string {
  switch (type) {
    case "new":
    case "add": return "A";
    case "delete": return "D";
    case "rename": return "R";
    case "change": return "M";
    default: return "M";
  }
}

function annotationCountForFile(annotations: Annotation[], fileName: string): number {
  return annotations.filter((a) => a.file === fileName).length;
}

function fileClassification(classifications: Record<string, FileClassification> | undefined, fileName: string): FileClassification {
  return classifications?.[fileName] ?? { collapsed: false };
}

function reasonLabel(reason?: string): string {
  if (!reason) return "";
  return ` [${reason}]`;
}

function fileEntryLabel(
  file: DiffFile,
  classifications: Record<string, FileClassification> | undefined,
  annotations: Annotation[],
): string {
  const annCount = annotationCountForFile(annotations, file.name);
  const cls = fileClassification(classifications, file.name);
  const icon = statusIcon(file.type);
  const badge = annCount > 0 ? ` [${annCount}]` : "";
  const marker = cls.reason ? reasonLabel(cls.reason) : "";
  return ` ${icon} ${file.name}${marker}${badge} `;
}

function fileCardBody(
  fileName: string,
  collapsed: boolean,
  hasHunks: boolean,
  rows: PlannedRow[],
  layout: "split" | "unified",
  currentAnnotationId: string | null,
) {
  if (collapsed) return <text fg={theme.fg.muted}>{"[collapsed — c to expand]"}</text>;
  if (!hasHunks) return <text fg={theme.fg.muted}>{"[no textual changes]"}</text>;
  return (
    <DiffRows
      fileName={fileName}
      rows={rows}
      layout={layout}
      currentAnnotationId={currentAnnotationId}
    />
  );
}

function folderRowLabel(row: Extract<VisibleRow<DiffFile>, { kind: "folder" }>): string {
  const indent = "  ".repeat(row.depth);
  const caret = row.collapsed ? "▸" : "▾";
  return ` ${indent}${caret} ${row.displayName} `;
}

function fileRowLabel(row: Extract<VisibleRow<DiffFile>, { kind: "file" }>): string {
  const indent = "  ".repeat(row.depth);
  const icon = statusIcon(row.file.type);
  const badge = row.annotationCount > 0 ? ` [${row.annotationCount}]` : "";
  return ` ${indent}${icon} ${row.displayName}${badge} `;
}

function App(props: AppProps) {
  const [bundle, setBundle] = useState<TourBundle>({
    tour: props.tour,
    diff: props.diff,
    files: props.files,
    annotations: props.annotations,
    snapshotLost: props.snapshotLost,
    classifications: props.classifications ?? {},
  });
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [currentAnnotationId, setCurrentAnnotationId] = useState<string | null>(null);
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCursor, setPickerCursor] = useState(0);
  const [pickerTours, setPickerTours] = useState<Tour[]>([]);
  const [pickerCounts, setPickerCounts] = useState<Record<string, number>>({});
  const renderer = useRenderer();
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sidebarScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const liveTour = bundle.tour;
  const liveAnnotations = bundle.annotations;
  const liveDiff = bundle.diff;
  const liveSnapshotLost = bundle.snapshotLost;
  const liveClassifications = bundle.classifications;

  const files = useMemo(
    () => sortFilesForStream(bundle.files),
    [bundle.files],
  );

  const tree = useMemo(() => compress(buildTree(bundle.files)), [bundle.files]);

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

  const plannedRowsByFile = useMemo(() => {
    const out = new Map<string, PlannedRow[]>();
    for (const [name, meta] of fileMetadata) {
      const fileAnns = liveAnnotations.filter((a) => a.file === name);
      out.set(name, planRows(meta, fileAnns, layout));
    }
    return out;
  }, [fileMetadata, liveAnnotations, layout]);

  // Re-anchor the cursor by id across annotation reloads. On first sight of a
  // non-empty list (or when the previously-current id is gone), pick the first
  // annotation, reveal its file's ancestor folders, and select that file's
  // row in the sidebar — so the highlight always agrees with the diff being
  // shown. Reads of tree/collapsedFolders/etc. are intentionally not in deps
  // so manual fold/expand doesn't re-anchor the cursor.
  useEffect(() => {
    if (liveAnnotations.length === 0) {
      if (currentAnnotationId !== null) setCurrentAnnotationId(null);
      return;
    }
    if (
      currentAnnotationId !== null &&
      liveAnnotations.some((a) => a.id === currentAnnotationId)
    ) {
      return;
    }
    const first = liveAnnotations[0];
    setCurrentAnnotationId(first.id);
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, first.file);
    if (!located) return;
    if (located.collapsedFolders !== collapsedFolders) {
      setCollapsedFolders(located.collapsedFolders as Set<string>);
    }
    setSelectedRowIdx(located.rowIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAnnotations, currentAnnotationId]);

  // Keep the selected sidebar row visible: whenever the row index or the row
  // list changes, ask the scrollbox to scroll the row into view (block:nearest
  // semantics — already-visible rows don't move).
  useEffect(() => {
    const row = visibleRows[safeRowIdx];
    if (!row || !sidebarScrollRef.current) return;
    sidebarScrollRef.current.scrollChildIntoView(`row-${row.path}`);
  }, [safeRowIdx, visibleRows]);

  // Keep the current annotation card in the diff-pane viewport. Fires only
  // when the current annotation id (or the underlying diff content) changes,
  // so manual scrolling between transitions is preserved. Falls back to the
  // file card when the annotation card itself can't be located (e.g. the
  // annotation's anchor row isn't in any hunk).
  useEffect(() => {
    if (!diffScrollRef.current || !currentAnnotationId) return;
    const ann = liveAnnotations.find((a) => a.id === currentAnnotationId);
    if (!ann) return;
    diffScrollRef.current.scrollChildIntoView(`annotation-${ann.id}`);
  }, [currentAnnotationId, liveAnnotations, plannedRowsByFile]);

  const currentAnnotationIdx = useMemo(() => {
    if (liveAnnotations.length === 0) return -1;
    if (currentAnnotationId === null) return 0;
    const idx = liveAnnotations.findIndex((a) => a.id === currentAnnotationId);
    return idx === -1 ? 0 : idx;
  }, [liveAnnotations, currentAnnotationId]);

  const isFileCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides[fileName];
    if (override !== undefined) return override;
    const cls = fileClassification(liveClassifications, fileName);
    if (!cls.collapsed) return false;
    if (cls.reason === "binary") return true;
    const hasAnnotations = liveAnnotations.some((a) => a.file === fileName);
    if (hasAnnotations) return false;
    return true;
  };

  const footerHints =
    "n/p: navigate  ·  j/k: rows  ·  c: collapse  ·  Space: page diff  ·  ←→: fold/expand  ·  l: layout  ·  t: tour picker  ·  Tab: switch pane  ·  q: quit";
  const footer =
    liveAnnotations.length > 0
      ? `Annotation ${currentAnnotationIdx + 1}/${liveAnnotations.length}  ·  ${footerHints}`
      : footerHints;

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
      setSelectedRowIdx(0);
      setCurrentAnnotationId(null);
      setCollapsedOverrides({});
      setCollapsedFolders(new Set());
    } finally {
      closePicker();
    }
  };

  const jumpToAnnotation = (ann: Annotation) => {
    setCurrentAnnotationId(ann.id);
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
  };

  useKeyboard((key) => {
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
      },
    );

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
          diffScrollRef.current.scrollChildIntoView(`file-card-${selectedRow.path}`);
        }
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
      case "next-annotation": {
        if (currentAnnotationIdx < 0) return;
        if (currentAnnotationIdx >= liveAnnotations.length - 1) return;
        jumpToAnnotation(liveAnnotations[currentAnnotationIdx + 1]);
        return;
      }
      case "prev-annotation": {
        if (currentAnnotationIdx <= 0) return;
        jumpToAnnotation(liveAnnotations[currentAnnotationIdx - 1]);
        return;
      }
      case "toggle-layout":
        setLayout((v) => (v === "split" ? "unified" : "split"));
        return;
      case "open-picker":
        void openPicker();
        return;
      case "page-diff-down":
        diffScrollRef.current?.scrollBy(1, "viewport");
        return;
      case "page-diff-up":
        diffScrollRef.current?.scrollBy(-1, "viewport");
        return;
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      {/* Header — GitHub PR-style 2-line: hamburger | title+#shortId / refs | toggle / pill */}
      <box width="100%" flexDirection="row" paddingX={1}>
        <box
          borderStyle="single"
          borderColor={theme.border.default}
          width={5}
          height={4}
          onMouseDown={() => void openPicker()}
        >
          <text fg={theme.fg.default}>{" ☰ "}</text>
        </box>
        <box flexDirection="column" flexGrow={1} paddingX={1} paddingTop={1}>
          <box flexDirection="row">
            <text bold fg={liveTour.title ? theme.fg.default : theme.fg.muted}>
              {liveTour.title || "(untitled)"}
            </text>
            <text fg={theme.fg.muted}>{` #${shortId(liveTour.id)}`}</text>
          </box>
          <text fg={theme.fg.muted}>
            {`${liveTour.base_source} ← ${liveTour.head_source}`}
          </text>
        </box>
        <box flexDirection="column" alignItems="flex-end" paddingTop={1}>
          <LayoutToggleTui
            layout={layout}
            onSplit={() => setLayout("split")}
            onUnified={() => setLayout("unified")}
          />
          <SequencePillTui
            idx={currentAnnotationIdx}
            total={liveAnnotations.length}
            onPrev={() => {
              if (currentAnnotationIdx <= 0) return;
              jumpToAnnotation(liveAnnotations[currentAnnotationIdx - 1]);
            }}
            onNext={() => {
              if (
                currentAnnotationIdx < 0 ||
                currentAnnotationIdx >= liveAnnotations.length - 1
              )
                return;
              jumpToAnnotation(liveAnnotations[currentAnnotationIdx + 1]);
            }}
          />
        </box>
      </box>

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
          width={30}
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
                if (row.kind === "file" && diffScrollRef.current) {
                  diffScrollRef.current.scrollChildIntoView(`file-card-${row.path}`);
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
                    {folderRowLabel(row)}
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
                  {fileRowLabel(row)}
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
              focused={!sidebarFocused}
              viewportCulling={false}
            >
              {files.map((file) => {
                const collapsed = isFileCollapsed(file.name);
                const rows = plannedRowsByFile.get(file.name) ?? [];
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
                      rows,
                      layout,
                      currentAnnotationId,
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
    </box>
  );
}

interface LayoutToggleTuiProps {
  layout: "split" | "unified";
  onSplit: () => void;
  onUnified: () => void;
}

function LayoutToggleTui({ layout, onSplit, onUnified }: LayoutToggleTuiProps) {
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text
        fg={layout === "split" ? theme.fg.accent : theme.fg.muted}
        bold={layout === "split"}
        onMouseDown={onSplit}
      >
        {"Split"}
      </text>
      <text fg={theme.fg.muted}>{" | "}</text>
      <text
        fg={layout === "unified" ? theme.fg.accent : theme.fg.muted}
        bold={layout === "unified"}
        onMouseDown={onUnified}
      >
        {"Unified"}
      </text>
      <text fg={theme.fg.muted}>{"]"}</text>
    </box>
  );
}

interface SequencePillTuiProps {
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function SequencePillTui({ idx, total, onPrev, onNext }: SequencePillTuiProps) {
  if (total === 0) return null;
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= total - 1;
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text
        fg={prevDisabled ? theme.fg.subtle : theme.fg.default}
        onMouseDown={prevDisabled ? undefined : onPrev}
      >
        {"←"}
      </text>
      <text fg={theme.fg.default}>{` ${idx + 1}/${total} `}</text>
      <text
        fg={nextDisabled ? theme.fg.subtle : theme.fg.default}
        onMouseDown={nextDisabled ? undefined : onNext}
      >
        {"→"}
      </text>
      <text fg={theme.fg.muted}>{"]"}</text>
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
