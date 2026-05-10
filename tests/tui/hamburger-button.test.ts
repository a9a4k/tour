import { describe, it, expect, vi } from "vitest";
import stringWidth from "string-width";
import { HamburgerButtonTui } from "../../src/tui/HamburgerButton.js";

// HamburgerButtonTui is a function component; calling it directly returns
// a React element tree (intrinsic types like "box" / "text"). We walk the
// tree to assert the layout contract from issue #90: outer box height
// matches the title block (3 rows = paddingTop + 2 text lines), and the
// ☰ glyph is vertically centered inside.
//
// Issue #133 also requires the inner area (outer width minus the single-
// line border on each side) to fit the rendered text under a wcwidth
// measurement of the string — `☰` (U+2630) is 2 cells under wcwidth /
// East-Asian-Ambiguous-as-Wide. OpenTUI's text intrinsic, with no
// wrapping or truncation enabled, drops the entire inner row when content
// overflows by even one cell. `string-width` is OpenTUI core's own width
// dependency, so it is a faithful proxy for the renderer's measurement.
// (A render-frame test using @opentui/react/test-utils — the path the
// issue brief recommended — would require Bun: @opentui/core's native
// renderer pulls in `bun-ffi-structs`, which has no Node fallback. The
// contract test below catches the same regression class without needing
// the native renderer.)

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

  it("horizontal sizing is 6 columns — wide enough for the ☰ glyph plus padding", () => {
    // Bumped from 5 to 6 to fix issue #133: ☰ measures 2 cells under
    // OpenTUI's wcwidth path, so " ☰ " is 4 cells, and the inner area
    // (width - 2 border cells) must be ≥ 4.
    const root = render();
    expect(root.props["width"]).toBe(6);
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

describe("HamburgerButtonTui inner-area fit (issue #133)", () => {
  // The inner area = outer width - 1 cell per single-line border on each
  // side. The rendered text (the only direct text child of the box) must
  // measure ≤ inner width under wcwidth, otherwise OpenTUI drops the row
  // and the box renders empty.

  it("the rendered text measures ≤ inner area under wcwidth (☰ counted as 2 cells)", () => {
    const root = render();
    const outerWidth = root.props["width"] as number;
    const borderStyle = root.props["borderStyle"];
    const borderCells = borderStyle === "single" ? 2 : 0;
    const innerWidth = outerWidth - borderCells;

    const text = root.props["children"] as { props: { children: string } };
    const textContent = text.props.children;
    const measured = stringWidth(textContent);

    expect(measured).toBeLessThanOrEqual(innerWidth);
  });

  it("string-width agrees with the issue's reproduction: ' ☰ ' is 4 cells", () => {
    // Belt-and-braces: if a future string-width upgrade ever stops
    // treating ☰ as East-Asian-Wide, the contract test above could
    // pass spuriously. Pin the measurement we depend on.
    expect(stringWidth(" ☰ ")).toBe(4);
  });
});
