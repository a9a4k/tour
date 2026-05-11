// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachGapRowOverlay, dispatchGapRowAction } from "../../src/web/client/gap-row-overlay.js";
import type { PlannedRow } from "../../src/core/diff-rows.js";

function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: Node[] = [],
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
}

function fileBlock(name: string, cells: HTMLElement[]): HTMLElement {
  return el("div", { "data-file": name, class: "file-block" }, cells);
}

function separator(): HTMLElement {
  // Pierre's `@@` row carries `data-separator="metadata"` (see
  // node_modules/@pierre/diffs/dist/utils/createSeparator.js). The overlay
  // anchors chevrons + gap-mid-top siblings off this attribute.
  return el("div", { "data-separator": "metadata" }, [
    el("div", { "data-separator-wrapper": "" }, [document.createTextNode("@@ -1,5 +1,5 @@")]),
  ]);
}

function diffLine(line: number, type: "addition" | "deletion" | "context" = "context"): HTMLElement {
  return el("div", { "data-line": String(line), "data-line-type": type });
}

const cleanups: Array<() => void> = [];
function attach(args: {
  root: HTMLElement;
  plannedRowsByFile: Map<string, PlannedRow[]>;
  fileDiffRefs: Map<string, { expandHunk: (i: number, dir: "up" | "down" | "both", n?: number) => void }>;
  onAfterExpand?: () => void;
}): void {
  cleanups.push(
    attachGapRowOverlay({
      root: args.root,
      plannedRowsByFile: args.plannedRowsByFile,
      fileDiffRefs: args.fileDiffRefs,
      onAfterExpand: args.onAfterExpand ?? (() => {}),
    }),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function nodesBy(subKind: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour-interactive="gap-row"][data-subkind="${subKind}"]`),
  );
}

const plan = (rows: PlannedRow[]): Map<string, PlannedRow[]> =>
  new Map([["x.ts", rows]]);

const hh = (hunkIndex: number, gapAbove: number): PlannedRow => ({
  kind: "hunk-header",
  header: "@@",
  hunkIndex,
  gapAbove,
});

const gapMidTop = (hunkIndex: number, gapAbove = 50): PlannedRow => ({
  kind: "interactive",
  subKind: "gap-mid-top",
  boundaryRef: hunkIndex,
  gapAbove,
});

const boundaryBottom = (gapAbove = 30): PlannedRow => ({
  kind: "interactive",
  subKind: "boundary-bottom",
  boundaryRef: "bottom",
  gapAbove,
});

const stubRefs = (
  expandHunk: (i: number, dir: "up" | "down" | "both", n?: number) => void,
): Map<string, { expandHunk: typeof expandHunk }> => new Map([["x.ts", { expandHunk }]]);

describe("attachGapRowOverlay: hunk-header chevron injection", () => {
  it("injects a chevron node on the @@ cell of an interactive hunk-header (gapAbove > 0)", () => {
    const sep = separator();
    document.body.appendChild(fileBlock("x.ts", [sep, diffLine(1)]));
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 12)]),
      fileDiffRefs: stubRefs(() => {}),
    });
    const chevrons = nodesBy("hunk-header");
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0].dataset.hunkIndex).toBe("0");
    // Chevron lives inside the @@ cell so a left-edge absolute position
    // resolves against the @@ cell itself (matches plus-button-overlay).
    expect(chevrons[0].closest('[data-separator="metadata"]')).toBe(sep);
  });

  it("does NOT inject a chevron for an inert hunk-header (gapAbove === 0)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1)]));
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0)]),
      fileDiffRefs: stubRefs(() => {}),
    });
    expect(nodesBy("hunk-header")).toHaveLength(0);
  });

  it("injects chevrons for multiple hunks, each tagged with its hunkIndex", () => {
    const s0 = separator();
    const s1 = separator();
    document.body.appendChild(fileBlock("x.ts", [s0, diffLine(1), s1, diffLine(10)]));
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 5), hh(1, 7)]),
      fileDiffRefs: stubRefs(() => {}),
    });
    const chevrons = nodesBy("hunk-header");
    expect(chevrons.map((c) => c.dataset.hunkIndex)).toEqual(["0", "1"]);
    expect(chevrons[0].closest('[data-separator="metadata"]')).toBe(s0);
    expect(chevrons[1].closest('[data-separator="metadata"]')).toBe(s1);
  });
});

describe("attachGapRowOverlay: gap-mid-top row injection", () => {
  it("injects a gap-mid-top row immediately above the @@ row when planner emits one", () => {
    const sep0 = separator();
    const sep1 = separator();
    document.body.appendChild(
      fileBlock("x.ts", [sep0, diffLine(1), sep1, diffLine(20)]),
    );
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), gapMidTop(1), hh(1, 50)]),
      fileDiffRefs: stubRefs(() => {}),
    });
    const rows = nodesBy("gap-mid-top");
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset.hunkIndex).toBe("1");
    // The gap-mid-top row is the immediate previousElementSibling of the
    // hunk-1 @@ cell (planner emits it as the row just above).
    expect(sep1.previousElementSibling).toBe(rows[0]);
  });

  it("does NOT inject a gap-mid-top row when planner does not emit one", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1)]));
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 12)]),
      fileDiffRefs: stubRefs(() => {}),
    });
    expect(nodesBy("gap-mid-top")).toHaveLength(0);
  });
});

describe("attachGapRowOverlay: boundary-bottom row injection", () => {
  it("injects a boundary-bottom row immediately after the file's last [data-line] cell", () => {
    const lastLine = diffLine(99);
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1), lastLine]));
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), boundaryBottom()]),
      fileDiffRefs: stubRefs(() => {}),
    });
    const rows = nodesBy("boundary-bottom");
    expect(rows).toHaveLength(1);
    expect(lastLine.nextElementSibling).toBe(rows[0]);
  });

  it("does NOT inject a boundary-bottom row when planner does not emit one", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1)]));
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0)]),
      fileDiffRefs: stubRefs(() => {}),
    });
    expect(nodesBy("boundary-bottom")).toHaveLength(0);
  });
});

describe("attachGapRowOverlay: click → expandHunk", () => {
  it("clicking the hunk-header chevron on a mid-file small gap calls expandHunk(idx, 'both', 20)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), hh(1, 12)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("hunk-header")[0].click();
    expect(expandHunk).toHaveBeenCalledWith(1, "both", 20);
  });

  it("clicking the hunk-header chevron on a first-hunk file-top gap calls expandHunk(0, 'down', 20)", () => {
    // `direction="down"` for the file-top case is non-obvious — see
    // `directionForHunkHeader` in gap-row-overlay.ts for the D1-adjacency
    // rationale.
    document.body.appendChild(fileBlock("x.ts", [separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 30)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("hunk-header")[0].click();
    expect(expandHunk).toHaveBeenCalledWith(0, "down", 20);
  });

  it("clicking the hunk-header chevron on a mid-file large gap calls expandHunk(idx, 'down', 20)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), gapMidTop(1), hh(1, 50)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("hunk-header")[0].click();
    expect(expandHunk).toHaveBeenCalledWith(1, "down", 20);
  });

  it("clicking a gap-mid-top row calls expandHunk(idx, 'up', 20)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), gapMidTop(1), hh(1, 50)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("gap-mid-top")[0].click();
    expect(expandHunk).toHaveBeenCalledWith(1, "up", 20);
  });

  it("clicking a boundary-bottom row calls expandHunk(lastIndex, 'down', 20)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1)]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), boundaryBottom()]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("boundary-bottom")[0].click();
    // Last hunk's index is 0 (single hunk file).
    expect(expandHunk).toHaveBeenCalledWith(0, "down", 20);
  });

  it("shift-click expands the entire gap (passes a high line count)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), hh(1, 12)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const chevron = nodesBy("hunk-header")[0];
    chevron.dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(expandHunk).toHaveBeenCalledTimes(1);
    const [, , lineCount] = expandHunk.mock.calls[0];
    expect(typeof lineCount).toBe("number");
    expect(lineCount).toBeGreaterThanOrEqual(12);
  });

  it("shift-click on gap-mid-top passes the spec's gapAbove", () => {
    // Symmetric with hunk-header's `Math.max(gapAbove, EXPANSION_STEP)` —
    // no SHIFT_EXPAND_ALL sentinel; the spec carries the real gap size.
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), gapMidTop(1, 75), hh(1, 75)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("gap-mid-top")[0].dispatchEvent(
      new MouseEvent("click", { shiftKey: true, bubbles: true }),
    );
    expect(expandHunk).toHaveBeenCalledWith(1, "up", 75);
  });

  it("shift-click on boundary-bottom passes the spec's gapAbove", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1)]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), boundaryBottom(42)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("boundary-bottom")[0].dispatchEvent(
      new MouseEvent("click", { shiftKey: true, bubbles: true }),
    );
    expect(expandHunk).toHaveBeenCalledWith(0, "down", 42);
  });

  it("shift-click on gap-mid-top with a tiny remaining gap still expands at least EXPANSION_STEP (= 20)", () => {
    // Floor matches hunk-header's `Math.max(gapAbove, EXPANSION_STEP)` so
    // the three gap-row kinds share a single shift-click contract.
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), gapMidTop(1, 5), hh(1, 5)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    nodesBy("gap-mid-top")[0].dispatchEvent(
      new MouseEvent("click", { shiftKey: true, bubbles: true }),
    );
    expect(expandHunk).toHaveBeenCalledWith(1, "up", 20);
  });

  it("calls onAfterExpand after expandHunk completes (signal to re-render)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator()]));
    const expandHunk = vi.fn();
    const onAfterExpand = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 12)]),
      fileDiffRefs: stubRefs(expandHunk),
      onAfterExpand,
    });
    nodesBy("hunk-header")[0].click();
    expect(onAfterExpand).toHaveBeenCalledTimes(1);
  });
});

describe("attachGapRowOverlay: idempotency", () => {
  it("attaching twice on the same root does not duplicate nodes", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator(), diffLine(1)]));
    const planMap = plan([hh(0, 5), gapMidTop(1), hh(1, 50), boundaryBottom()]);
    const refs = stubRefs(() => {});
    attach({ root: document.body, plannedRowsByFile: planMap, fileDiffRefs: refs });
    expect(nodesBy("hunk-header")).toHaveLength(2);
    expect(nodesBy("gap-mid-top")).toHaveLength(1);
    expect(nodesBy("boundary-bottom")).toHaveLength(1);
    attach({ root: document.body, plannedRowsByFile: planMap, fileDiffRefs: refs });
    // Same counts as after the first attach — not 4 hunk-headers, not 2
    // gap-mid-tops. Asserting before AND after makes dedup distinguishable
    // from the steady-state count the fixture's 2-hunk plan would produce.
    expect(nodesBy("hunk-header")).toHaveLength(2);
    expect(nodesBy("gap-mid-top")).toHaveLength(1);
    expect(nodesBy("boundary-bottom")).toHaveLength(1);
  });
});

describe("dispatchGapRowAction: keyboard-Enter end-to-end", () => {
  it("hunk-separator interactive cursor → expandHunk called as if the chevron was clicked", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), hh(1, 12)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "hunk-separator", boundaryRef: 1 },
      false,
    );
    expect(fired).toBe(true);
    expect(expandHunk).toHaveBeenCalledWith(1, "both", 20);
  });

  it("boundary-top interactive cursor → expandHunk(0, 'down', 20) (file-top promoted onto hunk 0)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 30)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "boundary-top", boundaryRef: "top" },
      false,
    );
    expect(fired).toBe(true);
    expect(expandHunk).toHaveBeenCalledWith(0, "down", 20);
  });

  it("gap-mid-top interactive cursor → expandHunk(idx, 'up', 20)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), gapMidTop(1), hh(1, 50)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "gap-mid-top", boundaryRef: 1 },
      false,
    );
    expect(fired).toBe(true);
    expect(expandHunk).toHaveBeenCalledWith(1, "up", 20);
  });

  it("boundary-bottom interactive cursor → expandHunk(lastIndex, 'down', 20)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), diffLine(1)]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), boundaryBottom()]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "boundary-bottom", boundaryRef: "bottom" },
      false,
    );
    expect(fired).toBe(true);
    expect(expandHunk).toHaveBeenCalledWith(0, "down", 20);
  });

  it("shiftKey=true on a hunk-separator dispatches the full-gap expansion", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 0), hh(1, 12)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "hunk-separator", boundaryRef: 1 },
      true,
    );
    expect(fired).toBe(true);
    const [, , lineCount] = expandHunk.mock.calls[0];
    expect(lineCount).toBeGreaterThanOrEqual(12);
  });

  it("returns false (no dispatch) when the cursor's subKind is not a gap-row family member", () => {
    document.body.appendChild(fileBlock("x.ts", [separator()]));
    const expandHunk = vi.fn();
    attach({
      root: document.body,
      plannedRowsByFile: plan([hh(0, 12)]),
      fileDiffRefs: stubRefs(expandHunk),
    });
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "collapsed-file", boundaryRef: "top" },
      false,
    );
    expect(fired).toBe(false);
    expect(expandHunk).not.toHaveBeenCalled();
  });

  it("returns false when no DOM node matches (overlay not yet attached / file unknown)", () => {
    document.body.appendChild(fileBlock("x.ts", [separator()]));
    // Overlay not attached — no nodes injected — dispatch should noop.
    const fired = dispatchGapRowAction(
      document.body,
      "x.ts",
      { subKind: "hunk-separator", boundaryRef: 0 },
      false,
    );
    expect(fired).toBe(false);
  });
});

describe("attachGapRowOverlay: cleanup", () => {
  it("returned cleanup removes every injected node", () => {
    document.body.appendChild(fileBlock("x.ts", [separator(), separator(), diffLine(1)]));
    const planMap = plan([hh(0, 5), gapMidTop(1), hh(1, 50), boundaryBottom()]);
    const cleanup = attachGapRowOverlay({
      root: document.body,
      plannedRowsByFile: planMap,
      fileDiffRefs: stubRefs(() => {}),
      onAfterExpand: () => {},
    });
    expect(nodesBy("hunk-header").length + nodesBy("gap-mid-top").length + nodesBy("boundary-bottom").length).toBeGreaterThan(0);
    cleanup();
    expect(nodesBy("hunk-header")).toHaveLength(0);
    expect(nodesBy("gap-mid-top")).toHaveLength(0);
    expect(nodesBy("boundary-bottom")).toHaveLength(0);
  });

  it("re-attach after cleanup behaves identically to a fresh first attach", () => {
    document.body.appendChild(fileBlock("x.ts", [separator()]));
    const planMap = plan([hh(0, 12)]);
    const refs = stubRefs(() => {});
    const cleanup = attachGapRowOverlay({
      root: document.body,
      plannedRowsByFile: planMap,
      fileDiffRefs: refs,
      onAfterExpand: () => {},
    });
    expect(nodesBy("hunk-header")).toHaveLength(1);
    cleanup();
    expect(nodesBy("hunk-header")).toHaveLength(0);
    attach({ root: document.body, plannedRowsByFile: planMap, fileDiffRefs: refs });
    expect(nodesBy("hunk-header")).toHaveLength(1);
  });
});
