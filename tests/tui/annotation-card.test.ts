import { describe, it, expect } from "vitest";
import { AnnotationCard } from "../../src/tui/AnnotationCard.js";
import { theme } from "../../src/core/theme.js";
import type { Annotation } from "../../src/core/types.js";

// AnnotationCard is a pure function component (no hooks); calling it
// returns the React element tree (the outer `<box>`). Walk the tree to
// assert the redundant per-`isCurrent` visual signals required for the
// selected card to be distinguishable at a glance from its peers.

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function isElement(node: unknown): node is AnyElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node
  );
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

function outerBoxOf(tree: unknown): AnyElement {
  if (!isElement(tree)) throw new Error("expected element");
  return tree;
}

function visibleText(tree: unknown): string {
  const strings: string[] = [];
  for (const el of flatten(tree)) {
    const c = el.props.children;
    if (typeof c === "string") strings.push(c);
    else if (Array.isArray(c)) {
      for (const s of c) if (typeof s === "string") strings.push(s);
    }
  }
  return strings.join("");
}

const annotation: Annotation = {
  id: "ann-1",
  file: "x.txt",
  side: "additions",
  line_start: 1,
  line_end: 1,
  body: "hello",
  author: "user",
  author_kind: "human",
  created_at: "2025-01-01T00:00:00Z",
};

describe("AnnotationCard selection cues", () => {
  it("uses a heavy border on the selected card", () => {
    const tree = AnnotationCard({ annotation, isCurrent: true });
    expect(outerBoxOf(tree).props["borderStyle"]).toBe("heavy");
  });

  it("uses the default single border on non-selected cards", () => {
    const tree = AnnotationCard({ annotation, isCurrent: false });
    expect(outerBoxOf(tree).props["borderStyle"]).toBe("single");
  });

  it("retains the accent border colour on both states (accent identity preserved)", () => {
    const cur = outerBoxOf(AnnotationCard({ annotation, isCurrent: true }));
    const sub = outerBoxOf(AnnotationCard({ annotation, isCurrent: false }));
    expect(cur.props["borderColor"]).toBe(theme.fg.accent);
    expect(sub.props["borderColor"]).toBe(theme.fg.accent);
  });

  it("paints the brighter accentCurrent bg when isCurrent=true", () => {
    const tree = AnnotationCard({ annotation, isCurrent: true });
    expect(outerBoxOf(tree).props["backgroundColor"]).toBe(
      theme.bg.accentCurrent.tui,
    );
  });

  it("paints the subtle accentSubtle bg when isCurrent=false (peers recede)", () => {
    const tree = AnnotationCard({ annotation, isCurrent: false });
    expect(outerBoxOf(tree).props["backgroundColor"]).toBe(
      theme.bg.accentSubtle.tui,
    );
  });

  it("renders a dedicated `●` selection marker glyph in the selected card's header", () => {
    const tree = AnnotationCard({ annotation, isCurrent: true });
    expect(visibleText(tree)).toMatch(/●/);
  });

  it("does not render the `●` selection marker on non-selected cards", () => {
    const tree = AnnotationCard({ annotation, isCurrent: false });
    expect(visibleText(tree)).not.toMatch(/●/);
  });

  it("differs along at least two independent visual axes between true/false (redundant cue)", () => {
    const cur = outerBoxOf(AnnotationCard({ annotation, isCurrent: true }));
    const sub = outerBoxOf(AnnotationCard({ annotation, isCurrent: false }));
    const curText = visibleText(AnnotationCard({ annotation, isCurrent: true }));
    const subText = visibleText(AnnotationCard({ annotation, isCurrent: false }));
    const axes = [
      cur.props["borderStyle"] !== sub.props["borderStyle"],
      cur.props["backgroundColor"] !== sub.props["backgroundColor"],
      curText !== subText,
    ];
    const distinct = axes.filter(Boolean).length;
    expect(distinct).toBeGreaterThanOrEqual(2);
  });

  it("does not change the annotation range-marking primitives (ADR 0008): no row tint/gutter props leak out of the card", () => {
    // The card is the conversation surface; row tint + gutter mark live
    // on the diff rows, not on the card itself. Sanity-check that the
    // card's outer box does not advertise diff-row props that DiffRows
    // would interpret (gutterTinted / gutterAccent / contentTinted /
    // diffBg) — these belong to DiffLine and must not surface here for
    // either isCurrent state.
    for (const isCurrent of [true, false]) {
      const outer = outerBoxOf(AnnotationCard({ annotation, isCurrent }));
      expect(outer.props["gutterTinted"]).toBeUndefined();
      expect(outer.props["gutterAccent"]).toBeUndefined();
      expect(outer.props["contentTinted"]).toBeUndefined();
      expect(outer.props["diffBg"]).toBeUndefined();
    }
  });
});
