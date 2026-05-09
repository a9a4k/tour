import { describe, it, expect } from "vitest";
import { DiffLine, ACCENT_FG, TINT_BG } from "../../src/tui/DiffLine.js";
import { theme } from "../../src/core/theme.js";

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

// Diff add/del row backgrounds. Issue #74: a deletion row paints
// theme.bg.dangerRange on both gutter and content; an addition row paints
// theme.bg.successRange. The annotation tint composes on top per ADR 0008
// (gutter tint wins on +/- rows, content tint wins on context rows).

function contentBgOf(root: AnyElement): unknown {
  const kids = childrenOf(root).filter(isElement);
  // The content cell is the last element child after the accent + gutter
  // wrappers. It may be either a <text> (no syntax highlight) or a <box>
  // wrapping a <code> (with highlight). The bg is on the <text> or the
  // <code> child; we read either.
  const last = kids[kids.length - 1]!;
  if (last.type === "text") return last.props["bg"] ?? last.props["backgroundColor"];
  const inner = childrenOf(last).filter(isElement);
  const code = inner.find((c) => c.type === "code");
  if (code) return code.props["bg"] ?? code.props["backgroundColor"];
  return undefined;
}

function gutterBgOf(root: AnyElement): unknown {
  const gutterCell = childrenOf(root).filter(isElement)[1]!;
  return gutterCell.props["backgroundColor"] ?? gutterCell.props["bg"];
}

describe("DiffLine diff backgrounds (issue #74)", () => {
  it("paints dangerRange on gutter and content when diffBg='deletion'", () => {
    const root = render({ diffBg: "deletion" } as never);
    expect(gutterBgOf(root)).toBe(theme.bg.dangerRange.tui);
    expect(contentBgOf(root)).toBe(theme.bg.dangerRange.tui);
  });

  it("paints successRange on gutter and content when diffBg='addition'", () => {
    const root = render({ diffBg: "addition" } as never);
    expect(gutterBgOf(root)).toBe(theme.bg.successRange.tui);
    expect(contentBgOf(root)).toBe(theme.bg.successRange.tui);
  });

  it("paints no bg when diffBg is undefined and no annotation flags", () => {
    const root = render();
    expect(gutterBgOf(root)).toBeFalsy();
    expect(contentBgOf(root)).toBeFalsy();
  });

  it("on a +/- row inside an annotation range, gutter shows annotation tint and content keeps the diff bg (ADR 0008)", () => {
    // gutterTinted=true (annotation falls on this row), contentTinted=false
    // (planner restricts content tint to paired/context rows so the +/-
    // signal survives on the content column).
    const root = render({
      diffBg: "addition",
      gutterTinted: true,
      contentTinted: false,
    } as never);
    expect(gutterBgOf(root)).toBe(TINT_BG);
    expect(contentBgOf(root)).toBe(theme.bg.successRange.tui);
  });

  it("on a context row inside an annotation range, both gutter and content show annotation tint", () => {
    const root = render({
      diffBg: undefined,
      gutterTinted: true,
      contentTinted: true,
    } as never);
    expect(gutterBgOf(root)).toBe(TINT_BG);
    expect(contentBgOf(root)).toBe(TINT_BG);
  });

  it("the accent stripe still paints on top of a diff bg row (not clipped)", () => {
    const root = render({ diffBg: "addition", gutterAccent: true } as never);
    const accent = childrenOf(root).filter(isElement)[0]!;
    const bg = accent.props["backgroundColor"] ?? accent.props["bg"];
    expect(bg).toBe(ACCENT_FG);
    // The accent cell still owns column 0; gutter bg lives on the next cell.
    expect(gutterBgOf(root)).toBe(theme.bg.successRange.tui);
  });
});
