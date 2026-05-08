import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import type { Review, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import type { FileClassification } from "../core/file-classifier.js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { dispatchKey } from "./keymap.js";

interface AppProps {
  review: Review;
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

function fileStat(hunks: DiffFile["hunks"]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.content) {
      if (line.type === "addition") additions++;
      else if (line.type === "deletion") deletions++;
      else if (line.type === "change") { additions++; deletions++; }
    }
  }
  return { additions, deletions };
}

function App(props: AppProps) {
  const [selectedFileIdx, setSelectedFileIdx] = createSignal(0);
  const [sidebarFocused, setSidebarFocused] = createSignal(true);
  const [collapsedOverrides, setCollapsedOverrides] = createSignal<Record<string, boolean>>({});
  const renderer = useRenderer();
  let diffScrollRef: ScrollBoxRenderable | undefined;

  const files = () => [...props.files].sort((a, b) => a.name.localeCompare(b.name));

  const isFileCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides()[fileName];
    if (override !== undefined) return override;
    const cls = fileClassification(props.classifications, fileName);
    if (!cls.collapsed) return false;
    if (cls.reason === "binary") return true;
    const hasAnnotations = props.annotations.some((a) => a.file === fileName);
    if (hasAnnotations) return false;
    return true;
  };

  const fileAnnotations = () => {
    const f = files()[selectedFileIdx()];
    if (!f) return [];
    return props.annotations
      .filter((a) => a.file === f.name)
      .sort((a, b) => a.line_start - b.line_start);
  };

  useKeyboard((key) => {
    const action = dispatchKey(
      { name: key.name, ctrl: key.ctrl, shift: key.shift },
      { sidebarFocused: sidebarFocused(), fileCount: files().length },
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
        setSelectedFileIdx((i) => Math.min(i + 1, files().length - 1));
        return;
      case "move-file-up":
        setSelectedFileIdx((i) => Math.max(i - 1, 0));
        return;
      case "select-file":
        setSidebarFocused(false);
        if (diffScrollRef) diffScrollRef.scrollTo(0);
        return;
      case "toggle-collapse": {
        const f = files()[selectedFileIdx()];
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
          Review: {props.review.title || props.review.id} [{props.review.status}]
        </text>
      </box>

      <Show when={props.snapshotLost}>
        <box height={2} width="100%" paddingX={1}>
          <text color="yellow" bold>
            ⚠ Snapshot lost — annotations preserved but diff cannot be displayed
          </text>
        </box>
      </Show>

      {/* Main layout */}
      <box flexGrow={1} width="100%" flexDirection="row">
        {/* Sidebar */}
        <box
          width={30}
          borderStyle="single"
          borderColor={sidebarFocused() ? "cyan" : "gray"}
          title=" Files "
          flexDirection="column"
        >
          <scrollbox height="100%" scrollY>
            <For each={files()}>
              {(file, idx) => {
                const annCount = () => annotationCountForFile(props.annotations, file.name);
                const isSelected = () => idx() === selectedFileIdx();
                const icon = statusIcon(file.type);
                const badge = () => annCount() > 0 ? ` [${annCount()}]` : "";
                const cls = () => fileClassification(props.classifications, file.name);
                const marker = () => cls().reason ? reasonLabel(cls().reason) : "";
                return (
                  <text
                    color={isSelected() ? "black" : "white"}
                    bg={isSelected() ? "cyan" : undefined}
                    bold={isSelected()}
                  >
                    {` ${icon} ${file.name}${marker()}${badge()} `}
                  </text>
                );
              }}
            </For>
          </scrollbox>
        </box>

        {/* Diff pane */}
        <box
          flexGrow={1}
          borderStyle="single"
          borderColor={!sidebarFocused() ? "cyan" : "gray"}
          title=" Diff "
          flexDirection="column"
        >
          <Show when={!props.snapshotLost && props.diff}>
            <scrollbox
              ref={(el: ScrollBoxRenderable) => { diffScrollRef = el; }}
              height="100%"
              scrollY
              focused={!sidebarFocused()}
            >
              <diff
                diff={props.diff}
                view="split"
                showLineNumbers
              />
            </scrollbox>
          </Show>

          {/* Annotations panel */}
          <Show when={fileAnnotations().length > 0}>
            <box
              borderStyle="single"
              borderColor="yellow"
              title=" Annotations "
              height={Math.min(fileAnnotations().length * 3 + 2, 12)}
            >
              <scrollbox scrollY height="100%">
                <For each={fileAnnotations()}>
                  {(ann) => (
                    <box flexDirection="column" paddingX={1}>
                      <text color="yellow" bold>
                        [{ann.side}] {ann.file}:{ann.line_start === ann.line_end ? ann.line_start : `${ann.line_start}-${ann.line_end}`} ({ann.author})
                      </text>
                      <text color="white">  {ann.body}</text>
                    </box>
                  )}
                </For>
              </scrollbox>
            </box>
          </Show>
        </box>
      </box>

      {/* Footer */}
      <box height={1} width="100%" paddingX={1}>
        <text color="gray">
          j/k: navigate  Tab: switch pane  Enter: select file  Space: toggle collapse  q: quit
        </text>
      </box>
    </box>
  );
}

export async function startTui(props: AppProps): Promise<void> {
  await render(() => <App {...props} />);
}
