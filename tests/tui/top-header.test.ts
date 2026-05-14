import { describe, it, expect, vi } from "vitest";
import { TopHeaderTui } from "../../src/tui/TopHeader.js";
import { HamburgerButtonTui } from "../../src/tui/HamburgerButton.js";
import { theme } from "../../src/core/theme.js";
import type { Tour } from "../../src/core/types.js";

// TopHeaderTui is a function component; calling it directly returns a
// React element tree. We walk the tree to assert the structural contract
// from issue #93 (and parent #91): single-line layout with flexWrap so the
// right cluster drops to its own row in narrow terminals; no Tour short-id
// in the header; pill hidden when there are no top-level annotations.
//
// After issue #311 retired the cursor-file path row, `render()` returns the
// row directly (no outer column container). The tree is the row's two
// clusters under a single flex row.

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

function childrenOf(el: AnyElement): unknown[] {
  const c = el.props.children;
  if (c === undefined || c === null) return [];
  return Array.isArray(c) ? c : [c];
}

function walk(node: unknown): AnyElement[] {
  if (!isElement(node)) return [];
  const out: AnyElement[] = [node];
  // For function components we invoke and recurse so the children of e.g.
  // SequencePillTui / LayoutToggleTui show up in the walk. These header
  // sub-components are pure (no hooks), so calling them in tests is safe.
  if (typeof node.type === "function") {
    try {
      const rendered = (node.type as (p: unknown) => unknown)(node.props);
      out.push(...walk(rendered));
    } catch {
      // Component uses hooks or otherwise can't be invoked outside React;
      // skip its sub-tree.
    }
  }
  for (const child of childrenOf(node)) {
    out.push(...walk(child));
  }
  return out;
}

function textChildOf(el: AnyElement): string {
  const c = el.props.children;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((x) => typeof x === "string").join("");
  return "";
}

const tour: Tour = {
  id: "2026-05-10-101010-abc1",
  title: "Add foo",
  status: "open",
  created_at: "2026-05-10T10:10:10Z",
  closed_at: "",
  // Realistic 40-char hex SHAs so the 7-char slice test (issue #308) has
  // something meaningful to assert against.
  head_sha: "deadbeefcafebabe0000000000000000abcdef12",
  base_sha: "cafebabe1234567800000000000000009876fedc",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

function render(
  overrides: Partial<Parameters<typeof TopHeaderTui>[0]> = {},
): AnyElement {
  const props = {
    tour,
    layout: "split" as const,
    currentAnnotationIdx: 0,
    topLevelTotal: 3,
    tourStats: { additions: 0, deletions: 0 },
    onOpenPicker: () => {},
    onPrevAnnotation: () => {},
    onNextAnnotation: () => {},
    onSplit: () => {},
    onUnified: () => {},
    ...overrides,
  };
  const out = TopHeaderTui(props);
  if (!isElement(out)) throw new Error("TopHeaderTui did not return an element");
  return out;
}

describe("TopHeaderTui (issue #93)", () => {
  it("is a flex row with flexWrap='wrap' so the right cluster can drop in 80-col terminals", () => {
    const root = render();
    expect(root.props["flexDirection"]).toBe("row");
    expect(root.props["flexWrap"]).toBe("wrap");
  });

  it("renders exactly two flex children (left cluster + right cluster) for group-wrap, not element-wrap", () => {
    const root = render();
    const directChildren = childrenOf(root).filter(isElement);
    expect(directChildren).toHaveLength(2);
  });

  it("the right cluster pushes itself to the right edge via marginLeft='auto'", () => {
    const root = render();
    const [, right] = childrenOf(root).filter(isElement);
    expect(right.props["marginLeft"]).toBe("auto");
  });

  it("does not render the Tour short-id ('#abc1') anywhere in the header", () => {
    const root = render({
      tour: { ...tour, id: "2026-05-10-101010-abc1" },
    });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(headerText).not.toContain("#");
    expect(headerText).not.toContain("abc1");
  });

  it("renders the title text inside the left cluster", () => {
    const root = render({ tour: { ...tour, title: "Add foo" } });
    const [left] = childrenOf(root).filter(isElement);
    const leftText = walk(left).filter((e) => e.type === "text").map(textChildOf).join(" | ");
    expect(leftText).toContain("Add foo");
  });

  it("renders the source pair as short SHAs ('<base[:7]> ← <head[:7]>') inside the left cluster (issue #308)", () => {
    const root = render();
    const [left] = childrenOf(root).filter(isElement);
    const leftText = walk(left).filter((e) => e.type === "text").map(textChildOf).join(" | ");
    expect(leftText).toContain("cafebab ← deadbee");
  });

  it("does not render the original ref names in the header (issue #308)", () => {
    const root = render();
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    // The fixture's head_source / base_source must not leak into the
    // header — they would re-introduce the ref-name drift the issue
    // closes (re-opened tour misread as pointing at current main / HEAD).
    expect(headerText).not.toContain("main ← feature/x");
    expect(headerText).not.toContain("feature/x");
    // "main" is a substring of several common words; assert the exact
    // " main " token (with spaces) is absent rather than the bare word.
    expect(headerText).not.toMatch(/\bmain\b/);
  });

  it("renders WIP literally on the head side when wip_snapshot === true (issue #308)", () => {
    const root = render({
      tour: {
        ...tour,
        // head_source is deliberately NOT "WIP" — the discriminator must be
        // the wip_snapshot boolean, not a string comparison on head_source.
        head_source: "HEAD",
        wip_snapshot: true,
      },
    });
    const leftText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(leftText).toContain("cafebab ← WIP");
    // The base side still renders as a short SHA, not the ref name.
    expect(leftText).not.toMatch(/\bmain\b/);
  });

  it("falls back to '(untitled)' when the tour title is empty", () => {
    const root = render({ tour: { ...tour, title: "" } });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(headerText).toContain("(untitled)");
  });

  it("places the HamburgerButtonTui inside the left cluster (not the right)", () => {
    const root = render();
    const [left, right] = childrenOf(root).filter(isElement);
    const inLeft = walk(left).some((e) => e.type === HamburgerButtonTui);
    const inRight = walk(right).some((e) => e.type === HamburgerButtonTui);
    expect(inLeft).toBe(true);
    expect(inRight).toBe(false);
  });

  it("forwards onOpenPicker to the HamburgerButtonTui", () => {
    const onOpenPicker = vi.fn();
    const root = render({ onOpenPicker });
    const hamburger = walk(root).find((e) => e.type === HamburgerButtonTui);
    expect(hamburger).toBeDefined();
    (hamburger!.props["onOpen"] as () => void)();
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("title text has truncate + maxWidth so long titles clip rather than push controls down", () => {
    const root = render({ tour: { ...tour, title: "Add foo" } });
    const titleNode = walk(root).find(
      (e) =>
        e.type === "text" &&
        typeof e.props.children === "string" &&
        (e.props.children as string).includes("Add foo"),
    );
    expect(titleNode).toBeDefined();
    expect(titleNode!.props["truncate"]).toBe(true);
    expect(titleNode!.props["maxWidth"]).toBeDefined();
  });

  it("sources text has truncate + maxWidth so long source strings clip rather than push controls down", () => {
    const root = render();
    const sourcesNode = walk(root).find(
      (e) =>
        e.type === "text" &&
        typeof e.props.children === "string" &&
        (e.props.children as string).includes("cafebab ← deadbee"),
    );
    expect(sourcesNode).toBeDefined();
    expect(sourcesNode!.props["truncate"]).toBe(true);
    expect(sourcesNode!.props["maxWidth"]).toBeDefined();
  });

  it("does not render the navigation pill when topLevelTotal === 0", () => {
    const root = render({ topLevelTotal: 0 });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    // The pill renders " N/M " between the arrows; its absence is the contract.
    expect(headerText).not.toContain("0/0");
    expect(headerText).not.toMatch(/\s\d+\/\d+\s/);
  });

  it("renders the navigation pill with N/M when topLevelTotal > 0", () => {
    const root = render({ topLevelTotal: 3, currentAnnotationIdx: 1 });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(headerText).toContain("2/3");
  });

  it("renders the layout toggle (Split | Unified)", () => {
    const root = render();
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(headerText).toContain("Split");
    expect(headerText).toContain("Unified");
  });

  // Issue #311 retired the cursor-file path row. The "what file am I in"
  // affordance is now owned by the pane-top active-file header (issue
  // #307); the "what file is selected" affordance is owned by the
  // sidebar's row-highlight. The header is single-row in all states.
  it("does not render a cursor-file path row alongside the main bar (issue #311)", () => {
    const root = render();
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    // The retired slot rendered `· ${path}` — `·` (U+00B7) was unique to
    // it; the rest of the header uses `|`, `[`, `]`, `←` as separators.
    expect(headerText).not.toContain("·");
  });

  // Tour-level diff stats — `+N -M` in the right cluster (issue #266 /
  // webapp parity #233). Leads the cluster ahead of the SequencePill and
  // LayoutToggle per issue #277. Pure presentation: zero counts render
  // nothing, non-zero counts paint in theme.fg.success / theme.fg.danger,
  // single-space gap, no proportion bar.
  describe("tour-level diff stats indicator (issue #266)", () => {
    function additionTextNode(root: AnyElement): AnyElement | undefined {
      return walk(root).find(
        (e) =>
          e.type === "text" &&
          typeof e.props.children === "string" &&
          /^\+\d+$/.test(e.props.children as string),
      );
    }
    function deletionTextNode(root: AnyElement): AnyElement | undefined {
      return walk(root).find(
        (e) =>
          e.type === "text" &&
          typeof e.props.children === "string" &&
          /^-\d+$/.test(e.props.children as string),
      );
    }

    it("renders `+N` and `-M` text in the right cluster on a mixed bundle", () => {
      const root = render({ tourStats: { additions: 12, deletions: 7 } });
      const [, right] = childrenOf(root).filter(isElement);
      const rightText = walk(right)
        .filter((e) => e.type === "text")
        .map(textChildOf)
        .join(" | ");
      expect(rightText).toContain("+12");
      expect(rightText).toContain("-7");
    });

    it("paints `+N` in theme.fg.success", () => {
      const root = render({ tourStats: { additions: 5, deletions: 0 } });
      const add = additionTextNode(root);
      expect(add).toBeDefined();
      expect(add!.props["fg"]).toBe(theme.fg.success);
    });

    it("paints `-M` in theme.fg.danger", () => {
      const root = render({ tourStats: { additions: 0, deletions: 4 } });
      const del = deletionTextNode(root);
      expect(del).toBeDefined();
      expect(del!.props["fg"]).toBe(theme.fg.danger);
    });

    it("renders nothing for a zero-total bundle (no `+0` / `-0`)", () => {
      const root = render({ tourStats: { additions: 0, deletions: 0 } });
      const headerText = walk(root)
        .filter((e) => e.type === "text")
        .map(textChildOf)
        .join(" | ");
      expect(headerText).not.toMatch(/\+\d/);
      expect(headerText).not.toMatch(/-\d/);
    });

    it("omits the `-M` segment on a pure-addition tour", () => {
      const root = render({ tourStats: { additions: 9, deletions: 0 } });
      expect(additionTextNode(root)).toBeDefined();
      expect(deletionTextNode(root)).toBeUndefined();
    });

    it("omits the `+N` segment on a pure-deletion tour", () => {
      const root = render({ tourStats: { additions: 0, deletions: 6 } });
      expect(additionTextNode(root)).toBeUndefined();
      expect(deletionTextNode(root)).toBeDefined();
    });

    it("places the indicator inside the right cluster, not the left", () => {
      const root = render({ tourStats: { additions: 3, deletions: 2 } });
      const [left, right] = childrenOf(root).filter(isElement);
      const inLeft = walk(left).some(
        (e) =>
          e.type === "text" &&
          typeof e.props.children === "string" &&
          /^[+-]\d+$/.test(e.props.children as string),
      );
      const inRight = walk(right).some(
        (e) =>
          e.type === "text" &&
          typeof e.props.children === "string" &&
          /^[+-]\d+$/.test(e.props.children as string),
      );
      expect(inLeft).toBe(false);
      expect(inRight).toBe(true);
    });
  });

  // Issue #277: the right cluster reads left-to-right as stats, sequence
  // pill, layout toggle. The stats text leads the cluster as a
  // navigational landmark (GitHub PR-header convention) — interactive
  // controls cluster after it.
  describe("right cluster reading order (issue #277)", () => {
    // Indexes within the cluster of the first text node carrying each
    // signature. `+N` / `-M` belong to the TourStatsIndicator; ` N/M ` /
    // ` —/M ` belongs to the SequencePill; `Split` / `Unified` belongs to
    // the LayoutToggle. Indexes are first-occurrence positions in the
    // walk order, which mirrors render order.
    function firstIndex(
      texts: string[],
      predicate: (s: string) => boolean,
    ): number {
      return texts.findIndex(predicate);
    }

    it("stats lead, then nav pill, then layout toggle (mixed stats)", () => {
      const root = render({
        tourStats: { additions: 12, deletions: 7 },
        topLevelTotal: 3,
        currentAnnotationIdx: 0,
      });
      const [, right] = childrenOf(root).filter(isElement);
      const texts = walk(right)
        .filter((e) => e.type === "text")
        .map(textChildOf);
      const statsIdx = firstIndex(texts, (s) => /^\+\d+$/.test(s));
      const navIdx = firstIndex(texts, (s) => /^\s\d+\/\d+\s$/.test(s));
      const splitIdx = firstIndex(texts, (s) => s === "Split");
      expect(statsIdx).toBeGreaterThanOrEqual(0);
      expect(navIdx).toBeGreaterThanOrEqual(0);
      expect(splitIdx).toBeGreaterThanOrEqual(0);
      expect(statsIdx).toBeLessThan(navIdx);
      expect(navIdx).toBeLessThan(splitIdx);
    });

    it("pure-addition tour: `+N` leads the cluster", () => {
      const root = render({
        tourStats: { additions: 9, deletions: 0 },
        topLevelTotal: 2,
        currentAnnotationIdx: 0,
      });
      const [, right] = childrenOf(root).filter(isElement);
      const texts = walk(right)
        .filter((e) => e.type === "text")
        .map(textChildOf);
      const statsIdx = firstIndex(texts, (s) => /^\+\d+$/.test(s));
      const navIdx = firstIndex(texts, (s) => /^\s\d+\/\d+\s$/.test(s));
      expect(statsIdx).toBeGreaterThanOrEqual(0);
      expect(statsIdx).toBeLessThan(navIdx);
    });

    it("pure-deletion tour: `-M` leads the cluster", () => {
      const root = render({
        tourStats: { additions: 0, deletions: 6 },
        topLevelTotal: 2,
        currentAnnotationIdx: 0,
      });
      const [, right] = childrenOf(root).filter(isElement);
      const texts = walk(right)
        .filter((e) => e.type === "text")
        .map(textChildOf);
      const statsIdx = firstIndex(texts, (s) => /^-\d+$/.test(s));
      const navIdx = firstIndex(texts, (s) => /^\s\d+\/\d+\s$/.test(s));
      expect(statsIdx).toBeGreaterThanOrEqual(0);
      expect(statsIdx).toBeLessThan(navIdx);
    });

    it("zero-total tour: cluster reads nav pill then layout toggle, no orphan leading gap", () => {
      const root = render({
        tourStats: { additions: 0, deletions: 0 },
        topLevelTotal: 2,
        currentAnnotationIdx: 0,
      });
      const [, right] = childrenOf(root).filter(isElement);
      const texts = walk(right)
        .filter((e) => e.type === "text")
        .map(textChildOf)
        .join(" | ");
      // No `+N` / `-M` segments — the indicator is gone entirely.
      expect(texts).not.toMatch(/\+\d/);
      expect(texts).not.toMatch(/-\d/);
      // Nav pill and layout toggle still render.
      expect(texts).toMatch(/\s\d+\/\d+\s/);
      expect(texts).toContain("Split");
    });
  });
});
