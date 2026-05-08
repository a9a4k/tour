import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import type { Review, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import type { ScrollBoxRenderable } from "@opentui/core";

interface AppProps {
  review: Review;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
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

function App(props: AppProps) {
  const [selectedFileIdx, setSelectedFileIdx] = createSignal(0);
  const [sidebarFocused, setSidebarFocused] = createSignal(true);
  const renderer = useRenderer();
  let diffScrollRef: ScrollBoxRenderable | undefined;

  const files = () => [...props.files].sort((a, b) => a.name.localeCompare(b.name));

  const fileAnnotations = () => {
    const f = files()[selectedFileIdx()];
    if (!f) return [];
    return props.annotations
      .filter((a) => a.file === f.name)
      .sort((a, b) => a.line_start - b.line_start);
  };

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.close();
      return;
    }

    if (key.name === "tab") {
      if (key.shift) {
        setSidebarFocused(true);
      } else {
        setSidebarFocused((v) => !v);
      }
      return;
    }

    if (sidebarFocused()) {
      const count = files().length;
      if (count === 0) return;
      if (key.name === "j" || key.name === "down") {
        setSelectedFileIdx((i) => Math.min(i + 1, count - 1));
      } else if (key.name === "k" || key.name === "up") {
        setSelectedFileIdx((i) => Math.max(i - 1, 0));
      } else if (key.name === "return") {
        setSidebarFocused(false);
        if (diffScrollRef) {
          diffScrollRef.scrollTo(0);
        }
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
                return (
                  <text
                    color={isSelected() ? "black" : "white"}
                    bg={isSelected() ? "cyan" : undefined}
                    bold={isSelected()}
                  >
                    {` ${icon} ${file.name}${badge()} `}
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
          j/k: navigate  Tab: switch pane  Enter: select file  q: quit
        </text>
      </box>
    </box>
  );
}

export async function startTui(props: AppProps): Promise<void> {
  await render(() => <App {...props} />);
}
