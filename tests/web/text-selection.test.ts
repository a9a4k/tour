// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  consumeTextSelectionDrag,
  createTextSelectionDragState,
  recordTextSelectionMouseDown,
  recordTextSelectionMouseMove,
  TEXT_SELECTABLE_CLASS,
} from "../../src/web/client/text-selection.js";

describe("text selection drag guard", () => {
  it("treats drags that start on selectable text nodes as selection drags", () => {
    const target = document.createElement("span");
    target.className = TEXT_SELECTABLE_CLASS;
    const text = document.createTextNode("selectable");
    target.appendChild(text);

    const state = createTextSelectionDragState();
    recordTextSelectionMouseDown(state, {
      target: text,
      clientX: 10,
      clientY: 10,
    });
    recordTextSelectionMouseMove(state, { clientX: 20, clientY: 10 });

    expect(consumeTextSelectionDrag(state)).toBe(true);
  });

  it("ignores drags that start outside selectable content", () => {
    const target = document.createElement("span");

    const state = createTextSelectionDragState();
    recordTextSelectionMouseDown(state, {
      target,
      clientX: 10,
      clientY: 10,
    });
    recordTextSelectionMouseMove(state, { clientX: 20, clientY: 10 });

    expect(consumeTextSelectionDrag(state)).toBe(false);
  });
});
