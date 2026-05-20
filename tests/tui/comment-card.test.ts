import { describe, it, expect } from "vitest";
import { CommentCard } from "../../src/tui/CommentCard.js";
import { theme } from "../../src/core/theme.js";
import type { Comment } from "../../src/core/types.js";

// CommentCard is a pure function component (no hooks); calling it
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

function textElements(tree: unknown): AnyElement[] {
  return flatten(tree).filter((el) => el.type === "text");
}

const comment: Comment = {
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

describe("CommentCard selection cues", () => {
  it("keeps visible Comment and Reply text selectable while excluding structural glyphs", () => {
    const reply: Comment = {
      ...comment,
      id: "ann-2",
      body: "reply body",
      thread_id: comment.id,
    };
    const tree = CommentCard({
      comment,
      replies: [reply],
      isCurrent: true,
      activeNodeId: reply.id,
      navIndex: 1,
      navTotal: 3,
      onToggleCollapse: () => {},
    });
    const texts = textElements(tree);
    const body = texts.find((t) => t.props["children"] === "hello");
    const replyBody = texts.find((t) => t.props["children"] === "reply body");

    expect(body).toBeDefined();
    expect(body!.props["selectable"]).toBeUndefined();
    expect(replyBody).toBeDefined();
    expect(replyBody!.props["selectable"]).toBeUndefined();

    for (const visible of ["1 / 3 ", "[human]", " (user)"]) {
      const nodes = texts.filter((t) => t.props["children"] === visible);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.props["selectable"]).not.toBe(false);
      }
    }

    for (const structural of ["▾ ", "● "]) {
      const nodes = texts.filter((t) => t.props["children"] === structural);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.props["selectable"]).toBe(false);
      }
    }
  });

  it("keeps collapsed preview and metadata selectable while excluding structural glyphs", () => {
    const reply: Comment = {
      ...comment,
      id: "ann-2",
      body: "reply body",
      thread_id: comment.id,
    };
    const tree = CommentCard({
      comment,
      replies: [reply],
      isCurrent: true,
      collapsed: true,
      navIndex: 1,
      navTotal: 3,
      onToggleCollapse: () => {},
    });
    const texts = textElements(tree);
    const location = texts.find((t) => t.props["children"] === " x.txt:1");
    const preview = texts.find((t) => t.props["children"] === '  "hello"');

    expect(location).toBeDefined();
    expect(location!.props["selectable"]).toBeUndefined();
    expect(preview).toBeDefined();
    expect(preview!.props["selectable"]).toBeUndefined();

    for (const visible of ["1 / 3 ", "[human]", "  💬 1"]) {
      const nodes = texts.filter((t) => t.props["children"] === visible);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.props["selectable"]).not.toBe(false);
      }
    }

    for (const structural of ["● ", "▸ "]) {
      const nodes = texts.filter((t) => t.props["children"] === structural);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.props["selectable"]).toBe(false);
      }
    }
  });

  it("uses a heavy border on the selected card", () => {
    const tree = CommentCard({ comment, isCurrent: true });
    expect(outerBoxOf(tree).props["borderStyle"]).toBe("heavy");
  });

  it("uses the default single border on non-selected cards", () => {
    const tree = CommentCard({ comment, isCurrent: false });
    expect(outerBoxOf(tree).props["borderStyle"]).toBe("single");
  });

  it("retains the accent border colour on both states (accent identity preserved)", () => {
    const cur = outerBoxOf(CommentCard({ comment, isCurrent: true }));
    const sub = outerBoxOf(CommentCard({ comment, isCurrent: false }));
    expect(cur.props["borderColor"]).toBe(theme.fg.accent);
    expect(sub.props["borderColor"]).toBe(theme.fg.accent);
  });

  it("paints the brighter accentCurrent bg when isCurrent=true", () => {
    const tree = CommentCard({ comment, isCurrent: true });
    expect(outerBoxOf(tree).props["backgroundColor"]).toBe(
      theme.bg.accentCurrent.tui,
    );
  });

  it("paints the subtle accentSubtle bg when isCurrent=false (peers recede)", () => {
    const tree = CommentCard({ comment, isCurrent: false });
    expect(outerBoxOf(tree).props["backgroundColor"]).toBe(
      theme.bg.accentSubtle.tui,
    );
  });

  it("renders a dedicated `●` selection marker glyph in the selected card's header", () => {
    const tree = CommentCard({ comment, isCurrent: true });
    expect(visibleText(tree)).toMatch(/●/);
  });

  it("does not render the `●` selection marker on non-selected cards", () => {
    const tree = CommentCard({ comment, isCurrent: false });
    expect(visibleText(tree)).not.toMatch(/●/);
  });

  it("differs along at least two independent visual axes between true/false (redundant cue)", () => {
    const cur = outerBoxOf(CommentCard({ comment, isCurrent: true }));
    const sub = outerBoxOf(CommentCard({ comment, isCurrent: false }));
    const curText = visibleText(CommentCard({ comment, isCurrent: true }));
    const subText = visibleText(CommentCard({ comment, isCurrent: false }));
    const axes = [
      cur.props["borderStyle"] !== sub.props["borderStyle"],
      cur.props["backgroundColor"] !== sub.props["backgroundColor"],
      curText !== subText,
    ];
    const distinct = axes.filter(Boolean).length;
    expect(distinct).toBeGreaterThanOrEqual(2);
  });

  // Collapse rule: ADR 0016 keeps the on-disk `author = author_kind`
  // fallback intact, but the renderer suppresses the trailing `(author)`
  // token when it would just re-state the kind bracket. `[human] (human)`
  // becomes `[human]`; a customised author still surfaces. The `[kind]`
  // bracket itself is load-bearing (ADR 0008's redundant-cue principle)
  // and must survive in every case.
  describe("header collapses redundant `(author)` when author === author_kind", () => {
    it("omits `(human)` on the top-level header when author was defaulted to the kind", () => {
      const defaulted: Comment = { ...comment, author: "human" };
      const text = visibleText(CommentCard({ comment: defaulted, isCurrent: false }));
      expect(text).toContain("[human]");
      expect(text).not.toContain("(human)");
    });

    it("keeps the `(alice)` token on the top-level header when author is customised", () => {
      const customised: Comment = { ...comment, author: "alice" };
      const text = visibleText(CommentCard({ comment: customised, isCurrent: false }));
      expect(text).toContain("[human]");
      expect(text).toContain("(alice)");
    });

    it("omits `(human)` on a reply header when the reply's author was defaulted", () => {
      const parent: Comment = { ...comment, author: "alice" };
      const reply: Comment = {
        ...comment,
        id: "ann-2",
        body: "reply body",
        author: "human",
        thread_id: parent.id,
      };
      const text = visibleText(
        CommentCard({ comment: parent, isCurrent: false, replies: [reply] }),
      );
      // The reply header should carry `[human]` but no `(human)`. The
      // parent's customised `(alice)` must still render — guards against a
      // regression that hides the wrong author.
      expect(text).toContain("(alice)");
      expect(text).not.toContain("(human)");
    });

    it("keeps `(claude)` on a reply header when the agent supplied its name", () => {
      const parent: Comment = { ...comment, author: "alice" };
      const reply: Comment = {
        ...comment,
        id: "ann-2",
        body: "reply body",
        author: "claude",
        author_kind: "agent",
        thread_id: parent.id,
      };
      const text = visibleText(
        CommentCard({ comment: parent, isCurrent: false, replies: [reply] }),
      );
      expect(text).toContain("[agent]");
      expect(text).toContain("(claude)");
    });
  });

  it("does not change the comment range-marking primitives (ADR 0008): no row tint/gutter props leak out of the card", () => {
    // The card is the conversation surface; row tint + gutter mark live
    // on the diff rows, not on the card itself. Sanity-check that the
    // card's outer box does not advertise diff-row props that DiffRows
    // would interpret (gutterTinted / gutterAccent / contentTinted /
    // diffBg) — these belong to DiffLine and must not surface here for
    // either isCurrent state.
    for (const isCurrent of [true, false]) {
      const outer = outerBoxOf(CommentCard({ comment, isCurrent }));
      expect(outer.props["gutterTinted"]).toBeUndefined();
      expect(outer.props["gutterAccent"]).toBeUndefined();
      expect(outer.props["contentTinted"]).toBeUndefined();
      expect(outer.props["diffBg"]).toBeUndefined();
    }
  });
});
