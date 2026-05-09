import { describe, it, expect } from "vitest";
import { DiffLine, ACCENT_FG, TINT_BG } from "../../src/tui/DiffLine.js";

// DiffLine is a function component; calling it directly returns a React
// element tree (intrinsic types like "box" / "text"). We walk the tree
// to assert the structural contract that backs ADR 0008's continuous
// gutter cue across wrapped multi-line rows.

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

function childrenOf(el: AnyElement): unknown[] {
  const c = el.props.children;
  if (c === undefined || c === null) return [];
  return Array.isArray(c) ? c : [c];
}

function render(props: Partial<Parameters<typeof DiffLine>[0]> = {}): AnyElement {
  const out = DiffLine({
    gutter: "   42 ",
    text: "const x = 1;",
    gutterTinted: false,
    contentTinted: false,
    gutterAccent: false,
    filetype: "ts",
    syntaxStyle: { tokens: {} } as never,
    width: "50%",
    ...props,
  } as Parameters<typeof DiffLine>[0]);
  if (!isElement(out)) throw new Error("DiffLine did not return an element");
  return out;
}

describe("DiffLine layout", () => {
  it("accent cell stretches to full row height (no fixed height={1})", () => {
    const root = render({ gutterAccent: true });
    const kids = childrenOf(root).filter(isElement);
    const accent = kids[0]!;
    // Either the accent is its own cell with alignSelf=stretch and no
    // hard height={1}, or it's a wrapper with the same property — either
    // way the cue must extend across wraps.
    expect(accent.props["alignSelf"]).toBe("stretch");
    expect(accent.props["height"]).not.toBe(1);
  });

  it("accent cell paints accent color when gutterAccent=true", () => {
    const root = render({ gutterAccent: true });
    const accent = childrenOf(root).filter(isElement)[0]!;
    // bg via box backgroundColor is the option-A pattern (1-cell-wide
    // cell stretches with row height). fg+glyph would also satisfy
    // visually but only if the glyph is repeated per visual line, which
    // OpenTUI's <text> does not do.
    const bg = accent.props["backgroundColor"] ?? accent.props["bg"];
    expect(bg).toBe(ACCENT_FG);
  });

  it("accent cell has no bg when gutterAccent=false", () => {
    const root = render({ gutterAccent: false });
    const accent = childrenOf(root).filter(isElement)[0]!;
    const bg = accent.props["backgroundColor"] ?? accent.props["bg"];
    expect(bg).toBeFalsy();
  });

  it("accent cell is exactly 1 column wide", () => {
    const root = render({ gutterAccent: true });
    const accent = childrenOf(root).filter(isElement)[0]!;
    expect(accent.props["width"]).toBe(1);
  });

  it("line-number cell stretches but the inner number text is pinned to one visual line", () => {
    const root = render({ gutterAccent: true, gutterTinted: true });
    const kids = childrenOf(root).filter(isElement);
    const gutterCell = kids[1]!;
    expect(gutterCell.props["alignSelf"]).toBe("stretch");
    // The visible line-number text inside must remain 1 row tall so the
    // 7ee3e85 anchor behavior does not regress on wrapped rows.
    const inner = childrenOf(gutterCell).filter(isElement);
    const numberText = inner.find((c) => c.type === "text");
    expect(numberText).toBeDefined();
    expect(numberText!.props["height"]).toBe(1);
  });

  it("gutterTinted paints the tint bg on the line-number cell, stretched", () => {
    const root = render({ gutterTinted: true });
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const bg =
      gutterCell.props["backgroundColor"] ?? gutterCell.props["bg"];
    expect(bg).toBe(TINT_BG);
  });

  it("gutterTinted=false leaves the line-number cell un-tinted", () => {
    const root = render({ gutterTinted: false });
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const bg =
      gutterCell.props["backgroundColor"] ?? gutterCell.props["bg"];
    expect(bg).toBeFalsy();
  });

  it("parent row pins gutter siblings to the top so the line number sits on visual-line 1", () => {
    const root = render({ gutterAccent: true });
    expect(root.props["alignItems"]).toBe("flex-start");
    expect(root.props["flexDirection"]).toBe("row");
  });
});
