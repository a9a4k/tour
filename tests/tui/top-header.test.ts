import { describe, it, expect, vi } from "vitest";
import { TopHeaderTui } from "../../src/tui/TopHeader.js";
import { HamburgerButtonTui } from "../../src/tui/HamburgerButton.js";
import type { Tour } from "../../src/core/types.js";

// TopHeaderTui is a function component; calling it directly returns a
// React element tree. We walk the tree to assert the structural contract
// from issue #93 (and parent #91): single-line layout with flexWrap so the
// right cluster drops to its own row in narrow terminals; no Tour short-id
// in the header; pill hidden when there are no top-level annotations.

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
  head_sha: "deadbeef",
  base_sha: "cafebabe",
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
  it("outer header is a flex row with flexWrap='wrap' so the right cluster can drop to row 2 in 80-col terminals", () => {
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

  it("renders the sources string ('main ← feature/x') inside the left cluster", () => {
    const root = render();
    const [left] = childrenOf(root).filter(isElement);
    const leftText = walk(left).filter((e) => e.type === "text").map(textChildOf).join(" | ");
    expect(leftText).toContain("main ← feature/x");
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
        (e.props.children as string).includes("main ← feature/x"),
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

  it("renders the full untruncated selectedPath in the header when provided (issue #156)", () => {
    const root = render({
      selectedPath: "supabase/migrations/20260508144406_setup_public_api.sql",
    });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(headerText).toContain(
      "supabase/migrations/20260508144406_setup_public_api.sql",
    );
  });

  it("does not render a selected-path slot when selectedPath is undefined (issue #156)", () => {
    const root = render({ selectedPath: undefined });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    // The slot renders `  · ${path}` — `·` (U+00B7) is unique to the slot;
    // the rest of the header uses `|`, `[`, `]`, `←` as separators.
    expect(headerText).not.toContain("·");
  });

  it("does not render a selected-path slot when selectedPath is an empty string (issue #156)", () => {
    const root = render({ selectedPath: "" });
    const headerText = walk(root)
      .filter((e) => e.type === "text")
      .map(textChildOf)
      .join(" | ");
    expect(headerText).not.toContain("·");
  });
});
