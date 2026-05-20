import { describe, it, expect, vi } from "vitest";
import { TourPicker } from "../../src/tui/TourPicker.js";
import type { PickerRow } from "../../src/core/tour-list.js";

// Mirrors the React-tree introspection idiom from
// `tests/tui/hamburger-button.test.ts`: call the function component
// directly and walk the returned element tree to assert click wiring.

interface AnyElement {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

function isElement(node: unknown): node is AnyElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node &&
    typeof (node as { type: unknown }).type === "string"
  );
}

function childrenOf(el: AnyElement): AnyElement[] {
  const c = el.props.children;
  if (c === undefined || c === null) return [];
  const arr = Array.isArray(c) ? c : [c];
  return arr.filter(isElement);
}

const sampleRows: PickerRow[] = [
  { id: "tour-a", title: "Tour A", status: "open", glyph: "●", age: "1d", commentCount: 0 },
  { id: "tour-b", title: "Tour B", status: "closed", glyph: "○", age: "2d", commentCount: 3 },
  { id: "tour-c", title: "Tour C", status: "open", glyph: "●", age: "3d", commentCount: 1 },
];

function renderPicker(opts: {
  onSelect?: (idx: number) => void;
  cursor?: number;
  currentTourId?: string | null;
  rows?: PickerRow[];
} = {}): AnyElement {
  const out = TourPicker({
    rows: opts.rows ?? sampleRows,
    cursor: opts.cursor ?? 0,
    currentTourId: opts.currentTourId ?? null,
    onSelect: opts.onSelect ?? (() => {}),
  });
  if (!isElement(out)) throw new Error("TourPicker did not return an element");
  return out;
}

function rowBoxes(root: AnyElement): AnyElement[] {
  // root -> [scrollbox, footer-box]
  const kids = childrenOf(root);
  const scrollbox = kids.find((k) => k.type === "scrollbox");
  if (!scrollbox) return [];
  return childrenOf(scrollbox).filter((k) => k.type === "box");
}

function flatten(node: unknown, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const c of node) flatten(c, out);
    return out;
  }
  if (!isElement(node)) return out;
  out.push(node);
  flatten(node.props.children, out);
  return out;
}

describe("TourPicker (TUI) — row click wiring (issue #321)", () => {
  it("wires onMouseDown on each row to onSelect with the row's idx", () => {
    const onSelect = vi.fn();
    const root = renderPicker({ onSelect });
    const rows = rowBoxes(root);
    expect(rows).toHaveLength(3);
    for (let i = 0; i < rows.length; i++) {
      const handler = rows[i]!.props["onMouseDown"];
      expect(typeof handler).toBe("function");
      (handler as () => void)();
      expect(onSelect).toHaveBeenLastCalledWith(i);
    }
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("keeps picker label drag-selection from selecting a row", () => {
    const onSelect = vi.fn();
    const stopPropagation = vi.fn();
    const root = renderPicker({ onSelect });
    const row = rowBoxes(root)[1]!;
    const event = {
      button: 0,
      target: { selectable: true },
      stopPropagation,
    };

    (row.props["onMouseDown"] as (event: typeof event) => void)(event);
    (row.props["onMouseDrag"] as (event: typeof event) => void)(event);
    (row.props["onMouseUp"] as (event: typeof event) => void)(event);

    expect(onSelect).not.toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("keeps plain clicks on picker labels selecting the row", () => {
    const onSelect = vi.fn();
    const root = renderPicker({ onSelect });
    const row = rowBoxes(root)[1]!;
    const event = {
      button: 0,
      target: { selectable: true },
      stopPropagation: vi.fn(),
    };

    (row.props["onMouseDown"] as (event: typeof event) => void)(event);
    expect(onSelect).not.toHaveBeenCalled();
    (row.props["onMouseUp"] as (event: typeof event) => void)(event);

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("renders no rows (and no stray handlers) when the row list is empty", () => {
    const onSelect = vi.fn();
    const root = renderPicker({ onSelect, rows: [] });
    expect(rowBoxes(root)).toHaveLength(0);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps picker row labels and hints selectable while excluding cursor glyphs", () => {
    const root = renderPicker({ cursor: 1, currentTourId: "tour-a" });
    const texts = flatten(root).filter((el) => el.type === "text");

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts.filter((t) => t.props.children === "❯" || t.props.children === " ")) {
      expect(text.props["selectable"]).toBe(false);
    }
    for (const text of texts.filter((t) => t.props.children !== "❯" && t.props.children !== " ")) {
      expect(text.props["selectable"]).not.toBe(false);
    }
  });
});
