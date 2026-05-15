// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileRow, FolderRow } from "../../src/web/client/App.js";
import type { BundleFile } from "../../src/web/client/types.js";

// Webapp sidebar rows must carry a native `title` tooltip with the row's
// full path so reviewers can reveal end-truncated names without any CSS /
// layout changes. For folders, `row.path` is the compressed-chain path;
// for files, it's the full filesystem path. The tooltip is unconditional
// — it does not depend on whether the row is visually truncated.

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

describe("FileRow: native title tooltip", () => {
  it("renders the file's full path as the button's title attribute", () => {
    const file: BundleFile = {
      name: "src/web/server/handlers/very-long/file-name.controller.ts",
      type: "modified",
    } as BundleFile;
    const container = mount(
      createElement(FileRow, {
        row: {
          kind: "file",
          path: "src/web/server/handlers/very-long/file-name.controller.ts",
          displayName: "file-name.controller.ts",
          depth: 4,
          file,
          commentCount: 0,
        },
        selected: false,
        onSelect: () => {},
        registerRef: () => {},
      }),
    );
    const button = container.querySelector("button.file-entry");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("title")).toBe(
      "src/web/server/handlers/very-long/file-name.controller.ts",
    );
  });

  it("uses the title attribute even when the displayName fits the sidebar", () => {
    const file: BundleFile = { name: "a.ts", type: "added" } as BundleFile;
    const container = mount(
      createElement(FileRow, {
        row: {
          kind: "file",
          path: "a.ts",
          displayName: "a.ts",
          depth: 0,
          file,
          commentCount: 0,
        },
        selected: false,
        onSelect: () => {},
        registerRef: () => {},
      }),
    );
    expect(container.querySelector("button.file-entry")?.getAttribute("title")).toBe("a.ts");
  });
});

describe("FolderRow: native title tooltip", () => {
  it("renders the folder's compressed-chain path as the button's title attribute", () => {
    const container = mount(
      createElement(FolderRow, {
        row: {
          kind: "folder",
          path: "src/web/server/handlers",
          displayName: "src/web/server/handlers",
          depth: 0,
          hasChildren: true,
          commentCount: 0,
          collapsed: false,
        },
        onToggle: () => {},
      }),
    );
    const button = container.querySelector("button.folder-entry");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("title")).toBe("src/web/server/handlers");
  });
});
