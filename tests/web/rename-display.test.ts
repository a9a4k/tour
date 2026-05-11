// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  RenameHeaderSpan,
  RenamePlaceholderBody,
} from "../../src/web/client/rename-display.js";

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

describe("RenameHeaderSpan", () => {
  it("renders 'prevName → name' when the file is a rename", () => {
    const container = mount(
      createElement(RenameHeaderSpan, { name: "src/new.ts", prevName: "src/old.ts" }),
    );
    const span = container.querySelector('[data-testid="rename-path"]');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("src/old.ts → src/new.ts");
    expect(span!.classList.contains("rename-path")).toBe(true);
  });

  it("renders nothing when prevName is undefined", () => {
    const container = mount(
      createElement(RenameHeaderSpan, { name: "src/a.ts", prevName: undefined }),
    );
    expect(container.querySelector('[data-testid="rename-path"]')).toBeNull();
  });

  it("renders nothing when prevName equals name", () => {
    const container = mount(
      createElement(RenameHeaderSpan, { name: "src/a.ts", prevName: "src/a.ts" }),
    );
    expect(container.querySelector('[data-testid="rename-path"]')).toBeNull();
  });
});

describe("RenamePlaceholderBody", () => {
  it("renders 'File renamed without changes.' when reason is 'renamed'", () => {
    const container = mount(
      createElement(RenamePlaceholderBody, { reason: "renamed" }),
    );
    const div = container.querySelector('[data-testid="rename-placeholder"]');
    expect(div).not.toBeNull();
    expect(div!.textContent).toBe("File renamed without changes.");
    expect(div!.classList.contains("rename-placeholder")).toBe(true);
  });

  it("renders nothing for other collapse reasons", () => {
    for (const reason of ["binary", "generated", "vendored", undefined]) {
      const container = mount(
        createElement(RenamePlaceholderBody, { reason }),
      );
      expect(container.querySelector('[data-testid="rename-placeholder"]')).toBeNull();
      if (root) {
        act(() => root!.unmount());
        root = null;
      }
    }
  });
});
