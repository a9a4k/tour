// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TourPicker } from "../../src/web/client/TourPicker.js";
import { TEXT_SELECTABLE_CLASS } from "../../src/web/client/text-selection.js";
import type { PickerRow } from "../../src/core/tour-list.js";

let root: Root | null = null;

const sampleRows: PickerRow[] = [
  {
    id: "tour-a",
    title: "Tour A",
    status: "open",
    glyph: "●",
    age: "1d",
    commentCount: 0,
  },
  {
    id: "tour-b",
    title: "Tour B",
    status: "closed",
    glyph: "○",
    age: "2d",
    commentCount: 3,
  },
];

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(props: Partial<ComponentProps<typeof TourPicker>> = {}): HTMLElement {
  const container = document.getElementById("root")!;
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(TourPicker, {
        rows: sampleRows,
        cursor: 0,
        currentTourId: null,
        onMove: () => {},
        onCommit: () => {},
        onClose: () => {},
        ...props,
      }),
    );
  });
  return container;
}

function dispatchMouse(el: Element, type: string, clientX: number, clientY = 0) {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX,
      clientY,
    }),
  );
}

describe("TourPicker (web) Text selection", () => {
  it("keeps picker title drag-selection from committing a row", () => {
    const onMove = vi.fn();
    const onCommit = vi.fn();
    const container = mount({ onMove, onCommit });
    const row = container.querySelector(
      'button[data-picker-row-idx="1"]',
    ) as HTMLButtonElement;
    const title = row.querySelector(".picker-title") as HTMLSpanElement;
    const age = row.querySelector(".picker-age") as HTMLSpanElement;

    expect(title.classList.contains(TEXT_SELECTABLE_CLASS)).toBe(true);
    expect(age.classList.contains(TEXT_SELECTABLE_CLASS)).toBe(true);

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(onMove).toHaveBeenCalledWith(1);
    expect(onCommit).toHaveBeenCalledTimes(1);

    onMove.mockClear();
    onCommit.mockClear();
    act(() => {
      dispatchMouse(title, "mousedown", 10, 10);
      dispatchMouse(title, "mousemove", 24, 10);
      dispatchMouse(title, "mouseup", 24, 10);
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps picker text-selection drags from selecting rows on hover", () => {
    const onMove = vi.fn();
    const onCommit = vi.fn();
    const container = mount({ onMove, onCommit });
    const firstRow = container.querySelector(
      'button[data-picker-row-idx="0"]',
    ) as HTMLButtonElement;
    const secondRow = container.querySelector(
      'button[data-picker-row-idx="1"]',
    ) as HTMLButtonElement;
    const firstTitle = firstRow.querySelector(
      ".picker-title",
    ) as HTMLSpanElement;

    act(() => {
      secondRow.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(onMove).toHaveBeenCalledWith(1);
    onMove.mockClear();

    act(() => {
      dispatchMouse(firstTitle, "mousedown", 10, 10);
      secondRow.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          buttons: 1,
          clientX: 24,
          clientY: 10,
          relatedTarget: null,
        }),
      );
      dispatchMouse(firstTitle, "mouseup", 24, 10);
      secondRow.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
