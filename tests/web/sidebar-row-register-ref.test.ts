// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileRow, FolderRow } from "../../src/web/client/App.js";
import type { BundleFile } from "../../src/web/client/types.js";

// PRD #343 / ADR 0031 / issue #367: every visible sidebar row participates
// in the App-level ref registry so the paneFocus = sidebar focus-realisation
// effect can `.focus()` whichever row carries the keyboard cursor — file
// rows AND folder rows. The two unit tests below mount each row in isolation
// with a spy registerRef and assert the registry is populated on mount /
// drained on unmount with the row's path key.

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

describe("FileRow: ref-registry wiring", () => {
  it("calls registerRef with (path, element) on mount and (path, null) on unmount", () => {
    const calls: Array<{ path: string; el: HTMLButtonElement | null }> = [];
    const file: BundleFile = { name: "src/a.ts", type: "modified" } as BundleFile;
    mount(
      createElement(FileRow, {
        row: {
          kind: "file",
          path: "src/a.ts",
          displayName: "a.ts",
          depth: 1,
          file,
          commentCount: 0,
        },
        selected: false,
        onSelect: () => {},
        registerRef: (path, el) => calls.push({ path, el }),
      }),
    );
    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("src/a.ts");
    expect(calls[0].el).toBeInstanceOf(HTMLButtonElement);

    act(() => root!.unmount());
    root = null;

    expect(calls.length).toBe(2);
    expect(calls[1].path).toBe("src/a.ts");
    expect(calls[1].el).toBeNull();
  });
});

describe("FolderRow: ref-registry wiring", () => {
  it("calls registerRef with (path, element) on mount and (path, null) on unmount", () => {
    const calls: Array<{ path: string; el: HTMLButtonElement | null }> = [];
    mount(
      createElement(FolderRow, {
        row: {
          kind: "folder",
          path: "src/web",
          displayName: "src/web",
          depth: 0,
          hasChildren: true,
          commentCount: 0,
          collapsed: false,
        },
        onToggle: () => {},
        registerRef: (path, el) => calls.push({ path, el }),
      }),
    );
    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("src/web");
    expect(calls[0].el).toBeInstanceOf(HTMLButtonElement);

    act(() => root!.unmount());
    root = null;

    expect(calls.length).toBe(2);
    expect(calls[1].path).toBe("src/web");
    expect(calls[1].el).toBeNull();
  });
});
