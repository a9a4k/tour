import { describe, it, expect } from "vitest";
import { DiffLine, ACCENT_FG, TINT_BG, CURSOR_FG, CURSOR_ROW_BG, CURSOR_GLYPH } from "../../src/tui/DiffLine.js";
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

  it("accent cell paints a half-block glyph rule in accent fg when gutterAccent=true", () => {
    const root = render({ gutterAccent: true });
    const accent = childrenOf(root).filter(isElement)[0]!;
    // Prototype 2026-05-14 picked variant C (▌ glyph + position="absolute"
    // + overflow="hidden" on the wrapper) over A (full-cell bg). The bg
    // approach read as too thick; the half-block glyph paints the leftmost
    // half of the cell, reading as a thinner rule. Layout footprint is
    // unchanged (still 1 cell wide, alignSelf="stretch" follows wrap).
    const bg = accent.props["backgroundColor"] ?? accent.props["bg"];
    expect(bg).toBeFalsy();
    expect(accent.props["overflow"]).toBe("hidden");
    const inner = childrenOf(accent).filter(isElement);
    const glyph = inner.find((c) => c.type === "text");
    expect(glyph).toBeDefined();
    expect(glyph!.props["position"]).toBe("absolute");
    expect(glyph!.props["fg"]).toBe(ACCENT_FG);
    // Glyph body is the repeated ▌; multiline so the rule extends through
    // any wrapped row depth (clipped by overflow="hidden" on the wrapper).
    const body = glyph!.props["children"];
    expect(typeof body === "string" && body.includes("▌")).toBe(true);
    expect(typeof body === "string" && body.includes("\n")).toBe(true);
  });

  it("accent cell has no glyph child when gutterAccent=false", () => {
    const root = render({ gutterAccent: false });
    const accent = childrenOf(root).filter(isElement)[0]!;
    const bg = accent.props["backgroundColor"] ?? accent.props["bg"];
    expect(bg).toBeFalsy();
    const inner = childrenOf(accent).filter(isElement);
    const glyph = inner.find((c) => c.type === "text");
    expect(glyph).toBeUndefined();
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

// Diff add/del row backgrounds. Issue #74 introduced a single-tone tint
// across gutter + content. Issue #262 (mirroring webapp #221 + #247) splits
// it into two tones: brighter rail on the gutter, softer wash on the code
// cell. Addition paints successRange (gutter) + successCell (content);
// deletion paints dangerRange (gutter) + dangerCell (content). The
// annotation tint composes on top per ADR 0008 (gutter tint wins on +/-
// rows, content tint wins on context rows).

function contentBgOf(root: AnyElement): unknown {
  const kids = childrenOf(root).filter(isElement);
  // The content cell is the last element child after the accent + gutter
  // wrappers. It is a <box> wrapping either a <text> (no syntax highlight)
  // or a <code> (with highlight). The bg lives on the wrapping <box> so the
  // tint fills the full row width, not just behind the characters (commit
  // 4fb8437).
  const last = kids[kids.length - 1]!;
  return last.props["backgroundColor"] ?? last.props["bg"];
}

function gutterBgOf(root: AnyElement): unknown {
  const gutterCell = childrenOf(root).filter(isElement)[1]!;
  return gutterCell.props["backgroundColor"] ?? gutterCell.props["bg"];
}

describe("DiffLine diff backgrounds (issue #74 + #262 two-tone)", () => {
  it("paints dangerRange on gutter and dangerCell on content when diffBg='deletion' (#262)", () => {
    const root = render({ diffBg: "deletion" } as never);
    expect(gutterBgOf(root)).toBe(theme.bg.dangerRange.tui);
    expect(contentBgOf(root)).toBe(theme.bg.dangerCell.tui);
  });

  it("paints successRange on gutter and successCell on content when diffBg='addition' (#262)", () => {
    const root = render({ diffBg: "addition" } as never);
    expect(gutterBgOf(root)).toBe(theme.bg.successRange.tui);
    expect(contentBgOf(root)).toBe(theme.bg.successCell.tui);
  });

  it("the two tones differ on a tinted row (#262 — bright rail vs soft wash)", () => {
    const add = render({ diffBg: "addition" } as never);
    expect(gutterBgOf(add)).not.toBe(contentBgOf(add));
    const del = render({ diffBg: "deletion" } as never);
    expect(gutterBgOf(del)).not.toBe(contentBgOf(del));
  });

  it("paints no bg when diffBg is undefined and no annotation flags", () => {
    const root = render();
    expect(gutterBgOf(root)).toBeFalsy();
    expect(contentBgOf(root)).toBeFalsy();
  });

  it("on a +/- row inside an annotation range, gutter shows annotation tint and content keeps the soft diff cell bg (ADR 0008 + #262)", () => {
    // gutterTinted=true (annotation falls on this row), contentTinted=false
    // (planner restricts content tint to paired/context rows so the +/-
    // signal survives on the content column). Content carries the softer
    // cell tint per #262.
    const root = render({
      diffBg: "addition",
      gutterTinted: true,
      contentTinted: false,
    } as never);
    expect(gutterBgOf(root)).toBe(TINT_BG);
    expect(contentBgOf(root)).toBe(theme.bg.successCell.tui);
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
    // Post-2026-05-14 the stripe is a glyph child, not a bg paint — assert
    // the glyph child is present (in accent fg) with no wrapper bg that
    // could obscure the gutter's addition rail behind it.
    const bg = accent.props["backgroundColor"] ?? accent.props["bg"];
    expect(bg).toBeFalsy();
    const glyph = childrenOf(accent).filter(isElement).find((c) => c.type === "text");
    expect(glyph).toBeDefined();
    expect(glyph!.props["fg"]).toBe(ACCENT_FG);
    // The accent cell still owns column 0; gutter bg lives on the next cell.
    expect(gutterBgOf(root)).toBe(theme.bg.successRange.tui);
  });
});

// ADR 0011 line cursor: when cursorActive is true, both the gutter and
// content cells paint theme.bg.cursorRow (winning over annotation tint
// and diff bg per the composition rule), and a leading ❯ glyph in
// theme.fg.cursor renders in the line-number column. The full-row fill is
// the TUI-native analogue of the web's outlined focus row.

describe("DiffLine cursorActive (ADR 0011)", () => {
  it("paints cursorRow bg when cursorActive=true (overrides annotation tint)", () => {
    const root = render({ cursorActive: true, gutterTinted: true } as never);
    expect(gutterBgOf(root)).toBe(CURSOR_ROW_BG);
  });

  it("paints cursorRow bg when cursorActive=true (overrides diff +/- bg)", () => {
    const root = render({ cursorActive: true, diffBg: "addition" } as never);
    expect(gutterBgOf(root)).toBe(CURSOR_ROW_BG);
  });

  it("renders the ❯ glyph in cursor fg colour when cursorActive=true", () => {
    const root = render({ cursorActive: true } as never);
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const innerTexts = childrenOf(gutterCell).filter((c) => isElement(c) && c.type === "text") as AnyElement[];
    const glyph = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c === CURSOR_GLYPH;
    });
    expect(glyph).toBeDefined();
    expect(glyph!.props["fg"]).toBe(CURSOR_FG);
  });

  it("does not render the ❯ glyph when cursorActive=false", () => {
    const root = render({ cursorActive: false } as never);
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const innerTexts = childrenOf(gutterCell).filter((c) => isElement(c) && c.type === "text") as AnyElement[];
    const glyph = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c === CURSOR_GLYPH;
    });
    expect(glyph).toBeUndefined();
  });

  it("preserves total gutter width when cursorActive=true (drops one leading char)", () => {
    // The gutter "   42 " is 6 chars; with cursor on, the ❯ glyph cell
    // takes one column and the inner number text drops one leading char.
    const root = render({ cursorActive: true, gutter: "   42 " } as never);
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const innerTexts = childrenOf(gutterCell).filter((c) => isElement(c) && c.type === "text") as AnyElement[];
    const number = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c !== CURSOR_GLYPH;
    });
    expect(number).toBeDefined();
    expect((number!.props.children as string).length).toBe(5);
  });

  it("paints cursorRow bg on the content cell too when cursorActive=true (overrides diff +/- bg)", () => {
    // Cursor row reads as a single solid plate — full-row fill is the
    // terminal-native equivalent of the web's outlined focus row.
    const noBg = render({ cursorActive: true } as never);
    expect(contentBgOf(noBg)).toBe(CURSOR_ROW_BG);
    const additionBg = render({ cursorActive: true, diffBg: "addition" } as never);
    expect(contentBgOf(additionBg)).toBe(CURSOR_ROW_BG);
  });

  it("paints cursorRow bg on the content cell when cursorActive=true (overrides annotation content tint)", () => {
    const root = render({ cursorActive: true, gutterTinted: true, contentTinted: true } as never);
    expect(contentBgOf(root)).toBe(CURSOR_ROW_BG);
  });
});

// Issue #260: split-layout single-side rows previously rendered the
// empty side as plain canvas, indistinguishable from the inter-row gap.
// The webapp's #227 shipped a canvas.inset fill on the three cells of
// the empty side. The TUI matches by painting both the gutter and the
// content cell of an emptySide-flagged DiffLine in theme.canvas.inset
// — sub-canvas-default so the empty side recedes while the active side
// sits at canvas. Cursor + range tint still win when they apply.
describe("DiffLine emptySide (issue #260)", () => {
  it("paints theme.canvas.inset on gutter and content when emptySide=true and no other bg", () => {
    const root = render({ emptySide: true } as never);
    expect(gutterBgOf(root)).toBe(theme.canvas.inset);
    expect(contentBgOf(root)).toBe(theme.canvas.inset);
  });

  it("cursor fill wins over emptySide (cursored side keeps cursor plate)", () => {
    const root = render({ emptySide: true, cursorActive: true } as never);
    expect(gutterBgOf(root)).toBe(CURSOR_ROW_BG);
    expect(contentBgOf(root)).toBe(CURSOR_ROW_BG);
  });

  it("annotation tint wins over emptySide (range tint paints the tinted cell)", () => {
    const root = render({
      emptySide: true,
      gutterTinted: true,
      contentTinted: true,
    } as never);
    expect(gutterBgOf(root)).toBe(TINT_BG);
    expect(contentBgOf(root)).toBe(TINT_BG);
  });

  it("emptySide=false leaves the cells un-bgd (default behaviour)", () => {
    const root = render({ emptySide: false } as never);
    expect(gutterBgOf(root)).toBeFalsy();
    expect(contentBgOf(root)).toBeFalsy();
  });
});

// Issue #259: hunk-header rows are metadata, not code. The webapp's
// `.tour-hunk-header` paints the whole line in fg.muted; the TUI matches
// by passing `mutedText` to DiffLine. The flag forces the plain <text>
// branch (so the syntax highlighter does not paint `import` red, etc.)
// and tints the content text in theme.fg.muted.
describe("DiffLine mutedText (issue #259)", () => {
  function contentInnerOf(root: AnyElement): AnyElement[] {
    const kids = childrenOf(root).filter(isElement);
    const wrap = kids[kids.length - 1]!;
    return childrenOf(wrap).filter(isElement);
  }

  it("forces the plain <text> branch (skips <code>) even when filetype is supplied", () => {
    const root = render({ mutedText: true, filetype: "ts" } as never);
    const inner = contentInnerOf(root);
    expect(inner.some((c) => c.type === "code")).toBe(false);
    expect(inner.some((c) => c.type === "text")).toBe(true);
  });

  it("paints the content text in theme.fg.muted", () => {
    const root = render({ mutedText: true, filetype: "ts" } as never);
    const inner = contentInnerOf(root);
    const textNode = inner.find((c) => c.type === "text");
    expect(textNode).toBeDefined();
    expect(textNode!.props["fg"]).toBe(theme.fg.muted);
  });

  it("leaves the content text un-tinted when mutedText is not set (default behaviour unchanged)", () => {
    // Empty side of a pure +/- row in split: filetype is supplied but
    // text is empty, so showCode is false and the plain <text> renders
    // with no fg override. Pre-#259 behaviour.
    const root = render({ filetype: "ts", text: "" } as never);
    const inner = contentInnerOf(root);
    const textNode = inner.find((c) => c.type === "text");
    expect(textNode).toBeDefined();
    expect(textNode!.props["fg"]).toBeUndefined();
  });
});

// Issue #268: the TUI's diff-row gutter renders line numbers in the
// default white foreground on all row kinds. GitHub renders context-row
// gutter numbers in fg.muted and tinted-row numbers in fg.default —
// bright numbers anchor scan on tinted rows, muted numbers keep
// context rows quiet. DiffLine now derives a gutterFg from the
// existing diffBg prop: tinted rows (addition / deletion) keep
// fg.default; context rows (no diffBg) mute to fg.muted.
describe("DiffLine gutter fg by row kind (issue #268)", () => {
  function gutterNumberTextOf(root: AnyElement): AnyElement {
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const innerTexts = childrenOf(gutterCell).filter(
      (c) => isElement(c) && c.type === "text",
    ) as AnyElement[];
    const number = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c !== CURSOR_GLYPH;
    });
    if (!number) throw new Error("no gutter number text found");
    return number;
  }

  it("paints the gutter line-number text in theme.fg.muted on a context row (no diffBg)", () => {
    const root = render({ diffBg: undefined } as never);
    expect(gutterNumberTextOf(root).props["fg"]).toBe(theme.fg.muted);
  });

  it("paints the gutter line-number text in theme.fg.default on an addition row", () => {
    const root = render({ diffBg: "addition" } as never);
    expect(gutterNumberTextOf(root).props["fg"]).toBe(theme.fg.default);
  });

  it("paints the gutter line-number text in theme.fg.default on a deletion row", () => {
    const root = render({ diffBg: "deletion" } as never);
    expect(gutterNumberTextOf(root).props["fg"]).toBe(theme.fg.default);
  });

  it("cursor glyph keeps its CURSOR_FG colour independent of the gutter-text rule (context row)", () => {
    const root = render({ cursorActive: true, diffBg: undefined } as never);
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const innerTexts = childrenOf(gutterCell).filter(
      (c) => isElement(c) && c.type === "text",
    ) as AnyElement[];
    const glyph = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c === CURSOR_GLYPH;
    });
    expect(glyph).toBeDefined();
    expect(glyph!.props["fg"]).toBe(CURSOR_FG);
    // And the number text alongside it still follows the row-kind rule.
    const number = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c !== CURSOR_GLYPH;
    });
    expect(number!.props["fg"]).toBe(theme.fg.muted);
  });

  it("cursor glyph keeps its CURSOR_FG colour and the number stays bright on tinted rows", () => {
    const root = render({ cursorActive: true, diffBg: "addition" } as never);
    const gutterCell = childrenOf(root).filter(isElement)[1]!;
    const innerTexts = childrenOf(gutterCell).filter(
      (c) => isElement(c) && c.type === "text",
    ) as AnyElement[];
    const glyph = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c === CURSOR_GLYPH;
    });
    expect(glyph!.props["fg"]).toBe(CURSOR_FG);
    const number = innerTexts.find((t) => {
      const c = t.props.children;
      return typeof c === "string" && c !== CURSOR_GLYPH;
    });
    expect(number!.props["fg"]).toBe(theme.fg.default);
  });

  it("annotation tint on a context row does not change the gutter-text colour (stays muted)", () => {
    // gutterTinted=true with no diffBg = a context row inside an
    // annotation range. The bg layer composes; the fg rule still keys
    // off diffBg, so the number stays muted.
    const root = render({
      gutterTinted: true,
      contentTinted: true,
      diffBg: undefined,
    } as never);
    expect(gutterNumberTextOf(root).props["fg"]).toBe(theme.fg.muted);
  });

  it("annotation tint on a +/- row does not change the gutter-text colour (stays bright)", () => {
    const root = render({
      gutterTinted: true,
      contentTinted: false,
      diffBg: "addition",
    } as never);
    expect(gutterNumberTextOf(root).props["fg"]).toBe(theme.fg.default);
  });

  it("emptySide context row still uses the muted gutter-fg rule (no number to paint, but rule is consistent)", () => {
    const root = render({ emptySide: true, diffBg: undefined } as never);
    expect(gutterNumberTextOf(root).props["fg"]).toBe(theme.fg.muted);
  });
});
