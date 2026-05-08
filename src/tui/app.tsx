import { useMemo, useRef, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import type { FileClassification } from "../core/file-classifier.js";
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

function App(props: AppProps) {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const renderer = useRenderer();
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const files = useMemo(
    () => [...props.files].sort((a, b) => a.name.localeCompare(b.name)),
    [props.files],
  );

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

  const selectedFile = files[selectedFileIdx];
  const fileAnnotations = selectedFile
    ? props.annotations
        .filter((a) => a.file === selectedFile.name)
        .sort((a, b) => a.line_start - b.line_start)
    : [];

  useKeyboard((key) => {
    const action = dispatchKey(
      { name: key.name, ctrl: key.ctrl, shift: key.shift },
      { sidebarFocused, fileCount: files.length },
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
        setSelectedFileIdx((i) => Math.min(i + 1, files.length - 1));
        return;
      case "move-file-up":
        setSelectedFileIdx((i) => Math.max(i - 1, 0));
        return;
      case "select-file":
        setSidebarFocused(false);
        if (diffScrollRef.current) diffScrollRef.current.scrollTo(0);
        return;
      case "toggle-collapse": {
        const f = files[selectedFileIdx];
        if (!f) return;
        const cls = fileClassification(props.classifications, f.name);
        if (cls.reason === "binary") return;
        setCollapsedOverrides((prev) => ({
          ...prev,
          [f.name]: !isFileCollapsed(f.name),
        }));
        return;
      }
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
            {files.map((file, idx) => {
              const annCount = annotationCountForFile(props.annotations, file.name);
              const isSelected = idx === selectedFileIdx;
              const icon = statusIcon(file.type);
              const badge = annCount > 0 ? ` [${annCount}]` : "";
              const cls = fileClassification(props.classifications, file.name);
              const marker = cls.reason ? reasonLabel(cls.reason) : "";
              return (
                <text
                  key={file.name}
                  fg={isSelected ? "black" : "white"}
                  bg={isSelected ? "cyan" : undefined}
                  bold={isSelected}
                >
                  {` ${icon} ${file.name}${marker}${badge} `}
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
              <diff
                diff={props.diff}
                view="split"
                showLineNumbers
              />
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
                {fileAnnotations.map((ann) => (
                  <box key={ann.id} flexDirection="column" paddingX={1}>
                    <text fg="yellow" bold>
                      [{ann.side}] {ann.file}:{ann.line_start === ann.line_end ? ann.line_start : `${ann.line_start}-${ann.line_end}`} ({ann.author})
                    </text>
                    <text fg="white">  {ann.body}</text>
                  </box>
                ))}
              </scrollbox>
            </box>
          )}
        </box>
      </box>

      {/* Footer */}
      <box height={1} width="100%" paddingX={1}>
        <text fg="gray">
          j/k: navigate  Tab: switch pane  Enter: select file  Space: toggle collapse  q: quit
        </text>
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
