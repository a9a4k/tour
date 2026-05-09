import { useEffect, useMemo, useRef, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import { splitRawDiffByFile } from "../core/diff-model.js";
import type { FileClassification } from "../core/file-classifier.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  type VisibleRow,
} from "../core/file-tree.js";
import { dispatchKey } from "./keymap.js";

interface AppProps {
  tour: Tour;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
  classifications?: Record<string, FileClassification>;
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
  collapsed: boolean,
  hasHunks: boolean,
  segment: string,
  layout: "split" | "unified",
) {
  if (collapsed) return <text fg="gray">{"[collapsed — Space to expand]"}</text>;
  if (!hasHunks) return <text fg="gray">{"[no textual changes]"}</text>;
  return <diff diff={segment} view={layout} showLineNumbers />;
}

function folderRowLabel(row: Extract<VisibleRow<DiffFile>, { kind: "folder" }>): string {
  const indent = "  ".repeat(row.depth);
  const caret = row.collapsed ? "▸" : "▾";
  const badge = row.annotationCount > 0 ? ` [${row.annotationCount}]` : "";
  return ` ${indent}${caret} ${row.displayName}${badge} `;
}

function fileRowLabel(
  row: Extract<VisibleRow<DiffFile>, { kind: "file" }>,
  classifications: Record<string, FileClassification> | undefined,
): string {
  const indent = "  ".repeat(row.depth);
  const cls = fileClassification(classifications, row.file.name);
  const icon = statusIcon(row.file.type);
  const badge = row.annotationCount > 0 ? ` [${row.annotationCount}]` : "";
  const marker = cls.reason ? reasonLabel(cls.reason) : "";
  return ` ${indent}${icon} ${row.displayName}${marker}${badge} `;
}

function App(props: AppProps) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [currentAnnotationId, setCurrentAnnotationId] = useState<string | null>(null);
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const renderer = useRenderer();
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const files = useMemo(
    () => [...props.files].sort((a, b) => a.name.localeCompare(b.name)),
    [props.files],
  );

  const tree = useMemo(() => compress(buildTree(props.files)), [props.files]);

  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of props.annotations) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [props.annotations]);

  const visibleRows = useMemo<VisibleRow<DiffFile>[]>(
    () => flatten(tree, collapsedFolders, annotationCounts),
    [tree, collapsedFolders, annotationCounts],
  );

  const safeRowIdx = visibleRows.length === 0
    ? 0
    : Math.min(Math.max(0, selectedRowIdx), visibleRows.length - 1);
  const selectedRow: VisibleRow<DiffFile> | undefined = visibleRows[safeRowIdx];

  const rawSegments = useMemo(() => splitRawDiffByFile(props.diff), [props.diff]);

  // Re-anchor the cursor by id across annotation reloads.
  useEffect(() => {
    if (props.annotations.length === 0) {
      if (currentAnnotationId !== null) setCurrentAnnotationId(null);
      return;
    }
    if (
      currentAnnotationId === null ||
      !props.annotations.some((a) => a.id === currentAnnotationId)
    ) {
      setCurrentAnnotationId(props.annotations[0].id);
    }
  }, [props.annotations, currentAnnotationId]);

  const currentAnnotationIdx = useMemo(() => {
    if (props.annotations.length === 0) return -1;
    if (currentAnnotationId === null) return 0;
    const idx = props.annotations.findIndex((a) => a.id === currentAnnotationId);
    return idx === -1 ? 0 : idx;
  }, [props.annotations, currentAnnotationId]);

  const isFileCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides[fileName];
    if (override !== undefined) return override;
    const cls = fileClassification(props.classifications, fileName);
    if (!cls.collapsed) return false;
    if (cls.reason === "binary") return true;
    const hasAnnotations = props.annotations.some((a) => a.file === fileName);
    if (hasAnnotations) return false;
    return true;
  };

  const selectedFile = selectedRow?.kind === "file" ? selectedRow.file : null;
  const fileAnnotations = selectedFile
    ? props.annotations.filter((a) => a.file === selectedFile.name)
    : [];

  const footerHints =
    "n/p: navigate  ·  j/k: rows  ·  Space: toggle  ·  ←→: fold/expand  ·  l: layout  ·  Tab: switch pane  ·  q: quit";
  const footer =
    props.annotations.length > 0
      ? `Annotation ${currentAnnotationIdx + 1}/${props.annotations.length}  ·  ${footerHints}`
      : footerHints;

  const jumpToAnnotation = (ann: Annotation) => {
    setCurrentAnnotationId(ann.id);
    const ancestors = revealAncestors(tree, ann.file);
    const needsReveal = ancestors.some((a) => collapsedFolders.has(a));
    let nextRows = visibleRows;
    if (needsReveal) {
      const nextCollapsed = new Set(collapsedFolders);
      for (const a of ancestors) nextCollapsed.delete(a);
      setCollapsedFolders(nextCollapsed);
      nextRows = flatten(tree, nextCollapsed, annotationCounts);
    }
    const newIdx = nextRows.findIndex(
      (r) => r.kind === "file" && r.path === ann.file,
    );
    if (newIdx >= 0 && newIdx !== safeRowIdx) {
      setSelectedRowIdx(newIdx);
      if (diffScrollRef.current) diffScrollRef.current.scrollTo(0);
    }
    setCollapsedOverrides((prev) => ({ ...prev, [ann.file]: false }));
  };

  useKeyboard((key) => {
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
        renderer.close();
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
        const cls = fileClassification(props.classifications, f.name);
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
        if (currentAnnotationIdx >= props.annotations.length - 1) return;
        jumpToAnnotation(props.annotations[currentAnnotationIdx + 1]);
        return;
      }
      case "prev-annotation": {
        if (currentAnnotationIdx <= 0) return;
        jumpToAnnotation(props.annotations[currentAnnotationIdx - 1]);
        return;
      }
      case "toggle-layout":
        setLayout((v) => (v === "split" ? "unified" : "split"));
        return;
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      {/* Header */}
      <box height={1} width="100%" paddingX={1}>
        <text bold>
          Tour: {props.tour.title || props.tour.id} [{props.tour.status}]
        </text>
      </box>

      {props.snapshotLost && (
        <box height={2} width="100%" paddingX={1}>
          <text fg="yellow" bold>
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
          borderColor={sidebarFocused ? "cyan" : "gray"}
          title=" Files "
          flexDirection="column"
        >
          <scrollbox height="100%">
            {visibleRows.map((row, idx) => {
              const isSelected = idx === safeRowIdx;
              if (row.kind === "folder") {
                return (
                  <text
                    key={`d:${row.path}`}
                    fg={isSelected ? "black" : "cyan"}
                    bg={isSelected ? "cyan" : undefined}
                    bold={isSelected}
                  >
                    {folderRowLabel(row)}
                  </text>
                );
              }
              return (
                <text
                  key={`f:${row.path}`}
                  fg={isSelected ? "black" : "white"}
                  bg={isSelected ? "cyan" : undefined}
                  bold={isSelected}
                >
                  {fileRowLabel(row, props.classifications)}
                </text>
              );
            })}
          </scrollbox>
        </box>

        {/* Diff pane */}
        <box
          flexGrow={1}
          borderStyle="single"
          borderColor={!sidebarFocused ? "cyan" : "gray"}
          title=" Diff "
          flexDirection="column"
        >
          {!props.snapshotLost && props.diff && (
            <scrollbox
              ref={diffScrollRef}
              height="100%"
              focused={!sidebarFocused}
            >
              {files.map((file) => {
                const collapsed = isFileCollapsed(file.name);
                const segment = rawSegments.get(file.name) ?? "";
                return (
                  <box
                    key={file.name}
                    id={`file-card-${file.name}`}
                    borderStyle="single"
                    borderColor="gray"
                    flexDirection="column"
                    marginBottom={1}
                  >
                    <text>{fileEntryLabel(file, props.classifications, props.annotations)}</text>
                    {fileCardBody(collapsed, file.hunks.length > 0, segment, layout)}
                  </box>
                );
              })}
            </scrollbox>
          )}

          {/* Annotations panel */}
          {fileAnnotations.length > 0 && (
            <box
              borderStyle="single"
              borderColor="yellow"
              title=" Annotations "
              height={Math.min(fileAnnotations.length * 3 + 2, 12)}
            >
              <scrollbox height="100%">
                {fileAnnotations.map((ann) => {
                  const isCurrent = ann.id === currentAnnotationId;
                  return (
                    <box key={ann.id} flexDirection="column" paddingX={1}>
                      <text
                        fg={isCurrent ? "black" : "yellow"}
                        bg={isCurrent ? "cyan" : undefined}
                        bold
                      >
                        [{ann.side}] {ann.file}:{ann.line_start === ann.line_end ? ann.line_start : `${ann.line_start}-${ann.line_end}`} ({ann.author})
                      </text>
                      <text fg="white">  {ann.body}</text>
                    </box>
                  );
                })}
              </scrollbox>
            </box>
          )}
        </box>
      </box>

      {/* Footer */}
      <box height={1} width="100%" paddingX={1}>
        <text fg="gray">{footer}</text>
      </box>
    </box>
  );
}

export async function startTui(props: AppProps): Promise<void> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    useMouse: true,
    exitOnCtrlC: true,
  });
  const root = createRoot(renderer);
  root.render(<App {...props} />);
  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve());
  });
}
