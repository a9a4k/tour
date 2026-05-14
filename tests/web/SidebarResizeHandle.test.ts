// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SidebarResizeHandle } from "../../src/web/client/SidebarResizeHandle.js";

// Drag handle for issue #323. The component is logic-only — it captures
// the pointer, fans pointer events into `onResize(width)` / `onResizeStart`
// / `onResizeEnd`, and otherwise delegates clamp + screen-Y math to the
// caller. Tests cover the event-translation contract; the App-level
// wiring (clamp / preserveScreenY) is covered separately.

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(el: React.ReactElement): HTMLDivElement {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return container;
}

function pointerEvent(
  type: string,
  init: { clientX?: number; button?: number; pointerId?: number } = {},
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  // happy-dom's Event doesn't carry pointer props; assign for the handlers
  // to read them via the React synthetic event passthrough.
  Object.assign(ev, {
    clientX: init.clientX ?? 0,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
  });
  return ev;
}

describe("<SidebarResizeHandle>", () => {
  it("renders a separator role with aria-orientation vertical", () => {
    const onResize = vi.fn();
    mount(
      createElement(SidebarResizeHandle, {
        width: 300,
        onResize,
      }),
    );
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle");
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("role")).toBe("separator");
    expect(handle!.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle!.getAttribute("aria-label")).toBe("Resize sidebar");
  });

  it("emits onResize(startWidth + dx) on pointer-move during drag", () => {
    const onResize = vi.fn();
    mount(
      createElement(SidebarResizeHandle, {
        width: 300,
        onResize,
      }),
    );
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle")!;
    // Stub the pointer-capture methods happy-dom doesn't ship.
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 100 }));
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 150 }));
    });
    expect(onResize).toHaveBeenLastCalledWith(350);
  });

  it("ignores pointer-move when no drag is in progress", () => {
    const onResize = vi.fn();
    mount(
      createElement(SidebarResizeHandle, {
        width: 300,
        onResize,
      }),
    );
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle")!;
    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 150 }));
    });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("invokes onResizeStart at pointer-down and onResizeEnd at pointer-up", () => {
    const onResize = vi.fn();
    const onResizeStart = vi.fn();
    const onResizeEnd = vi.fn();
    mount(
      createElement(SidebarResizeHandle, {
        width: 300,
        onResize,
        onResizeStart,
        onResizeEnd,
      }),
    );
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle")!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 100 }));
    });
    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).not.toHaveBeenCalled();
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerup", { clientX: 200 }));
    });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it("requests pointer-capture at pointerdown so the drag survives leaving the window", () => {
    const onResize = vi.fn();
    mount(
      createElement(SidebarResizeHandle, {
        width: 300,
        onResize,
      }),
    );
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle")!;
    const setPointerCapture = vi.fn();
    handle.setPointerCapture = setPointerCapture;
    handle.releasePointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, pointerId: 42 }));
    });
    expect(setPointerCapture).toHaveBeenCalledWith(42);
  });

  it("ignores right-click (button !== 0) so the browser's context menu still works", () => {
    const onResize = vi.fn();
    const onResizeStart = vi.fn();
    mount(
      createElement(SidebarResizeHandle, {
        width: 300,
        onResize,
        onResizeStart,
      }),
    );
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle")!;
    handle.setPointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, button: 2 }));
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 150 }));
    });
    expect(onResizeStart).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("emits onResize relative to the latest pointerdown baseline (re-drag uses new width)", () => {
    const onResize = vi.fn();
    let currentWidth = 300;
    // Re-render with updated width after the first drag commits.
    function render(width: number): void {
      act(() => {
        root!.render(createElement(SidebarResizeHandle, { width, onResize }));
      });
    }
    mount(createElement(SidebarResizeHandle, { width: currentWidth, onResize }));
    const handle = container.querySelector<HTMLDivElement>(".sidebar-resize-handle")!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    // First drag: 100 → 200, delta +100 → 400.
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 100 }));
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 200 }));
    });
    expect(onResize).toHaveBeenLastCalledWith(400);
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerup", { clientX: 200 }));
    });
    currentWidth = 400;
    render(currentWidth);

    // Second drag: starts from 400 baseline; 50 → 100 → +50 → 450.
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 50 }));
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 100 }));
    });
    expect(onResize).toHaveBeenLastCalledWith(450);
  });
});
