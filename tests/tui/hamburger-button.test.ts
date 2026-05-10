import { describe, it, expect, vi } from "vitest";
import { HamburgerButtonTui } from "../../src/tui/HamburgerButton.js";

// HamburgerButtonTui is a function component; calling it directly returns
// a React element tree (intrinsic types like "box" / "text"). We walk the
// tree to assert the layout contract from issue #90: outer box height
// matches the title block (3 rows = paddingTop + 2 text lines), and the
// ☰ glyph is vertically centered inside.

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

function render(onOpen: () => void = () => {}): AnyElement {
  const out = HamburgerButtonTui({ onOpen });
  if (!isElement(out)) throw new Error("HamburgerButtonTui did not return an element");
  return out;
}

describe("HamburgerButtonTui (issue #90)", () => {
  it("outer box height is 3 — flush with the 3-row title block (paddingTop + 2 text lines)", () => {
    const root = render();
    expect(root.type).toBe("box");
    expect(root.props["height"]).toBe(3);
  });

  it("keeps the bordered single-line look", () => {
    const root = render();
    expect(root.props["borderStyle"]).toBe("single");
  });

  it("horizontal sizing is unchanged at 5 columns", () => {
    const root = render();
    expect(root.props["width"]).toBe(5);
  });

  it("centers the ☰ glyph inside the box (alignItems + justifyContent center)", () => {
    const root = render();
    expect(root.props["alignItems"]).toBe("center");
    expect(root.props["justifyContent"]).toBe("center");
  });

  it("wires onMouseDown to the supplied handler so clicking still opens the picker", () => {
    const onOpen = vi.fn();
    const root = render(onOpen);
    const handler = root.props["onMouseDown"];
    expect(typeof handler).toBe("function");
    (handler as () => void)();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
