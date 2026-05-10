import { describe, it, expect, vi } from "vitest";
import stringWidth from "string-width";
import { HamburgerButtonTui } from "../../src/tui/HamburgerButton.js";

// HamburgerButtonTui is a function component; calling it directly returns
// a React element tree. We walk the tree to assert the bracket-style
// contract: single-row flex container with muted [ ] brackets framing a
// clickable ≡ glyph. This keeps the hamburger visually consistent with
// the sibling header controls ([Split | Unified], [← N/M →]) and lets the
// whole header collapse to a single row.

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

function childrenOf(el: AnyElement): AnyElement[] {
  const c = el.props.children;
  if (c === undefined || c === null) return [];
  const arr = Array.isArray(c) ? c : [c];
  return arr.filter(isElement);
}

describe("HamburgerButtonTui (bracket style)", () => {
  it("renders as a single-row flex container (no border, no fixed height)", () => {
    const root = render();
    expect(root.type).toBe("box");
    expect(root.props["flexDirection"]).toBe("row");
    expect(root.props["borderStyle"]).toBeUndefined();
    expect(root.props["height"]).toBeUndefined();
  });

  it("renders three text children: opening bracket, glyph, closing bracket", () => {
    const root = render();
    const kids = childrenOf(root);
    expect(kids).toHaveLength(3);
    expect(kids.every((k) => k.type === "text")).toBe(true);
    expect(kids[0]!.props["children"]).toBe("[");
    expect(kids[1]!.props["children"]).toBe("≡");
    expect(kids[2]!.props["children"]).toBe("]");
  });

  it("wires onMouseDown on the glyph to the supplied handler", () => {
    const onOpen = vi.fn();
    const root = render(onOpen);
    const [, glyph] = childrenOf(root);
    const handler = glyph!.props["onMouseDown"];
    expect(typeof handler).toBe("function");
    (handler as () => void)();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("pins the glyph width: ≡ (U+2261) is 1 cell under wcwidth", () => {
    // If a future string-width upgrade ever changed ≡'s measurement,
    // the trigger could shift relative to neighbouring header controls.
    // Pin the assumption we depend on.
    expect(stringWidth("≡")).toBe(1);
  });
});
