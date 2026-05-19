// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileRow, FolderRow } from "../../src/web/client/App.js";
import type { BundleFile } from "../../src/web/client/types.js";

let root: Root | null = null;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.getElementById("root")!;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

function dispatchMouse(el: Element, type: string, clientX: number, clientY = 0) {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      clientX,
      clientY,
    }),
  );
}

describe("sidebar row Text selection", () => {
  it("keeps plain clicks immediate but ignores drag-selection mouse-up clicks", () => {
    const selectedFiles: string[] = [];
    const toggledFolders: string[] = [];
    const file: BundleFile = { name: "src/deep/file.ts", type: "modified" } as BundleFile;
    const container = mount(
      createElement("div", null, [
        createElement(FileRow, {
          key: "file",
          row: {
            kind: "file",
            path: "src/deep/file.ts",
            displayName: "file.ts",
            depth: 1,
            file,
            commentCount: 0,
          },
          selected: false,
          onSelect: (path) => selectedFiles.push(path),
          registerRef: () => {},
        }),
        createElement(FolderRow, {
          key: "folder",
          row: {
            kind: "folder",
            path: "src/deep",
            displayName: "src/deep",
            depth: 0,
            hasChildren: true,
            commentCount: 0,
            collapsed: false,
          },
          onToggle: (path) => toggledFolders.push(path),
        }),
      ]),
    );

    const fileRow = container.querySelector("button.file-entry")!;
    const folderRow = container.querySelector("button.folder-entry")!;

    fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    folderRow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(selectedFiles).toEqual(["src/deep/file.ts"]);
    expect(toggledFolders).toEqual(["src/deep"]);

    fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    folderRow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    expect(selectedFiles).toEqual(["src/deep/file.ts"]);
    expect(toggledFolders).toEqual(["src/deep"]);

    dispatchMouse(fileRow, "mousedown", 0);
    dispatchMouse(fileRow, "mousemove", 12);
    dispatchMouse(fileRow, "mouseup", 12);
    fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    dispatchMouse(folderRow, "mousedown", 0);
    dispatchMouse(folderRow, "mousemove", 12);
    dispatchMouse(folderRow, "mouseup", 12);
    folderRow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(selectedFiles).toEqual(["src/deep/file.ts"]);
    expect(toggledFolders).toEqual(["src/deep"]);
  });
});
