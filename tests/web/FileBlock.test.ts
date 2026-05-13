// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileBlock, type ExpandAction } from "../../src/web/client/FileBlock.js";
import type { BundleFile } from "../../src/web/client/types.js";
import type { PlannedRow } from "../../src/core/diff-rows.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { Annotation } from "../../src/web/client/types.js";

// `<FileBlock>` is the per-file React component the Tour-owned web row
// renderer mounts (PRD #212 slice 5). It owns the file-level grid, calls
// `useLazyHighlight`, walks a `PlannedRow[]`, and dispatches each row to
// `<DiffRow>` / `<CardRow>` / `<InteractiveRow>`. The tests below cover
// the contract end-to-end against happy-dom: rows in order, cards at the
// right anchor, click invokes the right dispatch action, cursor flows by
// anchor type, layout flips the grid template, collapsed state suppresses
// the body, composer renders at the right anchor.
//
// `useLazyHighlight` falls back to "immediately visible" when
// `IntersectionObserver` is undefined (see `use-lazy-highlight.ts`). The
// suite deletes the IO global so tokens land in the rendered DOM as plain
// text in deterministic order — no manual IO firing required.

let container: HTMLDivElement;
let root: Root | null = null;
let savedIO: typeof IntersectionObserver | undefined;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  savedIO = (
    globalThis as { IntersectionObserver?: typeof IntersectionObserver }
  ).IntersectionObserver;
  delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  if (savedIO) {
    (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver = savedIO;
  }
});

function mount(el: ReactElement): HTMLDivElement {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return container;
}

function rerender(el: ReactElement): void {
  act(() => {
    root!.render(el);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFile: BundleFile = {
  name: "x.ts",
  type: "modified",
  hunks: [],
  oldContent: "old line 1\nold line 2\n",
  newContent: "new line 1\nnew line 2\n",
  classification: { collapsed: false },
  orphanWindows: [],
};

function rowsCanonical(): PlannedRow[] {
  return [
    {
      kind: "hunk-header",
      header: "@@ -1,2 +1,2 @@",
      hunkIndex: 0,
      gapAbove: 0,
    },
    {
      kind: "diff-row",
      type: "context",
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftText: "old line 1",
      rightText: "new line 1",
    },
    {
      kind: "diff-row",
      type: "addition",
      leftLineNumber: null,
      rightLineNumber: 2,
      leftText: "",
      rightText: "new line 2",
    },
  ];
}

function withAnnotation(rows: PlannedRow[], ann: Annotation): PlannedRow[] {
  return [
    ...rows,
    {
      kind: "annotation",
      annotation: ann,
      replies: [],
      id: ann.id,
    },
  ];
}

const ann1: Annotation = {
  id: "ann-1",
  file: "x.ts",
  side: "additions",
  line_start: 2,
  line_end: 2,
  body: "comment body",
  author: "human",
  author_kind: "human",
  created_at: "2026-05-11T00:00:00Z",
};

function defaultProps(overrides: Partial<Parameters<typeof FileBlock>[0]> = {}) {
  return {
    file: baseFile,
    rows: rowsCanonical(),
    layout: "split" as const,
    cursor: null as Cursor | null,
    onDispatchExpand: () => {},
    onRowClick: () => {},
    onCardClick: () => {},
    isCollapsed: false,
    onToggleCollapse: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Header + grid container
// ---------------------------------------------------------------------------

describe("<FileBlock> — header + grid container", () => {
  it("renders a sticky file header with the file name and classification reason", () => {
    const file: BundleFile = {
      ...baseFile,
      classification: { collapsed: false, reason: "generated" },
    };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const header = c.querySelector(".tour-file-header");
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain("x.ts");
    expect(header!.textContent).toContain("generated");
  });

  it("renders the grid container with the layout's data-layout attribute", () => {
    const c = mount(createElement(FileBlock, defaultProps({ layout: "split" })));
    const block = c.querySelector(".tour-file-block") as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.dataset.layout).toBe("split");
  });

  it("flips the data-layout attribute when layout changes to unified", () => {
    const c = mount(createElement(FileBlock, defaultProps({ layout: "unified" })));
    const block = c.querySelector(".tour-file-block") as HTMLElement;
    expect(block.dataset.layout).toBe("unified");
  });
});

// ---------------------------------------------------------------------------
// Collapsed state
// ---------------------------------------------------------------------------

describe("<FileBlock> — collapsed state", () => {
  it("renders the header but suppresses the grid body when collapsed", () => {
    const c = mount(
      createElement(FileBlock, defaultProps({ isCollapsed: true })),
    );
    expect(c.querySelector(".tour-file-header")).not.toBeNull();
    expect(c.querySelector(".tour-file-block")).toBeNull();
  });

  it("invokes onToggleCollapse when the header is clicked", () => {
    let toggled = 0;
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ onToggleCollapse: () => (toggled += 1) }),
      ),
    );
    const header = c.querySelector(".tour-file-header") as HTMLElement;
    act(() => {
      header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Planner walk + row dispatch
// ---------------------------------------------------------------------------

describe("<FileBlock> — planner walk + dispatch", () => {
  it("walks rows in order, emitting one .tour-row per planner row (plus cards)", () => {
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ A", hunkIndex: 0, gapAbove: 0 },
      {
        kind: "diff-row",
        type: "context",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "a",
        rightText: "a",
      },
      {
        kind: "diff-row",
        type: "addition",
        leftLineNumber: null,
        rightLineNumber: 2,
        leftText: "",
        rightText: "b",
      },
      {
        kind: "interactive",
        subKind: "boundary-bottom",
        boundaryRef: "bottom",
        gapAbove: 5,
        text: "··· 5 hidden ···",
      },
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const tourRows = Array.from(c.querySelectorAll(".tour-row"));
    // hunk-header + 2 diff-rows + interactive = 4 rows.
    expect(tourRows.length).toBe(4);
    // First row is the hunk-header (interactive).
    expect((tourRows[0] as HTMLElement).dataset.subkind).toBeTruthy();
    // Diff rows next.
    expect((tourRows[1] as HTMLElement).dataset.lineType).toBe("context");
    expect((tourRows[2] as HTMLElement).dataset.lineType).toBe("addition");
    // Interactive row last.
    expect((tourRows[3] as HTMLElement).dataset.subkind).toBe("boundary-bottom");
  });

  it("dispatches annotation rows to <CardRow>, anchored after the matching diff row", () => {
    const rows = withAnnotation(rowsCanonical(), ann1);
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const card = c.querySelector(".tour-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("comment body");
    // In split layout, additions cards anchor to cols 4 / -1 (#221).
    expect((card as HTMLElement).style.gridColumn).toMatch(/4\s*\/\s*-1/);
  });

  it("invokes onRowClick with file/side/lineNumber when a diff row is clicked", () => {
    const calls: Array<{ file: string; side: string; lineNumber: number }> = [];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          onRowClick: (anchor) => calls.push(anchor),
        }),
      ),
    );
    const additions = c.querySelector(
      '.tour-row[data-line-type="addition"] [data-side="additions"] .tour-row-code',
    ) as HTMLElement;
    expect(additions).not.toBeNull();
    act(() => {
      additions.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ file: "x.ts", side: "additions", lineNumber: 2 }]);
  });

  it("invokes onCardClick with the annotation id when a card is clicked", () => {
    const rows = withAnnotation(rowsCanonical(), ann1);
    const ids: string[] = [];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          rows,
          onCardClick: (id) => ids.push(id),
        }),
      ),
    );
    const card = c.querySelector(".annotation-block") as HTMLElement;
    act(() => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ids).toEqual(["ann-1"]);
  });
});

// ---------------------------------------------------------------------------
// Interactive row activation → onDispatchExpand
// ---------------------------------------------------------------------------

describe("<FileBlock> — interactive row activation", () => {
  it("forwards InteractiveRow click → onDispatchExpand with the row's boundaryRef + direction", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "boundary-bottom",
        boundaryRef: "bottom",
        gapAbove: 12,
        text: "··· 12 hidden ···",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector('.tour-row[data-subkind="boundary-bottom"]') as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions.length).toBe(1);
    expect(actions[0]).toMatchObject({
      kind: "expand",
      file: "x.ts",
      boundaryRef: "bottom",
      direction: "down",
    });
    expect(actions[0].kind === "expand" ? actions[0].count : 0).toBeGreaterThan(0);
  });

  it("forwards hunk-separator activation with direction 'both' and the hunk index", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@", hunkIndex: 2, gapAbove: 8 },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions[0]).toMatchObject({
      kind: "expand",
      file: "x.ts",
      boundaryRef: 2,
      direction: "both",
    });
  });

  it("collapsed-file activation dispatches a separate `expand-file` action", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "collapsed-file",
        boundaryRef: "top",
        text: "··· 200 lines hidden — Enter to expand ···",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector('.tour-row[data-subkind="collapsed-file"]') as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual([{ kind: "expand-file", file: "x.ts" }]);
  });
});

// ---------------------------------------------------------------------------
// isCursor flow
// ---------------------------------------------------------------------------

describe("<FileBlock> — isCursor flow", () => {
  it("applies .is-cursor to the matching diff row for a RowAnchor cursor", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor })));
    const additionRow = c.querySelector('.tour-row[data-line-type="addition"]') as HTMLElement;
    expect(additionRow.classList.contains("is-cursor")).toBe(true);
    // Context row above does NOT carry the class.
    const contextRow = c.querySelector('.tour-row[data-line-type="context"]') as HTMLElement;
    expect(contextRow.classList.contains("is-cursor")).toBe(false);
  });

  it("does NOT match a diff row when the cursor's file differs", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "y.ts",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor })));
    const additionRow = c.querySelector('.tour-row[data-line-type="addition"]') as HTMLElement;
    expect(additionRow.classList.contains("is-cursor")).toBe(false);
  });

  it("applies .is-cursor to the matching CardRow for a CardAnchor cursor", () => {
    const rows = withAnnotation(rowsCanonical(), ann1);
    const cursor: Cursor = {
      kind: "card",
      annotationId: "ann-1",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ rows, cursor })));
    // CardRow doesn't itself emit `.is-cursor`; the AnnotationCard's
    // `isCurrent` styling does. Probe AnnotationCard's "current" class.
    const card = c.querySelector(".annotation-block");
    expect(card!.className).toContain("current");
  });

  it("applies .is-cursor to an InteractiveRow when the cursor's interactive subKind/boundaryRef match", () => {
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "boundary-bottom",
        boundaryRef: "bottom",
        gapAbove: 12,
        text: "···",
      },
    ];
    const cursor: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "boundary-bottom", boundaryRef: "bottom" },
    };
    const c = mount(createElement(FileBlock, defaultProps({ rows, cursor })));
    const row = c.querySelector('.tour-row[data-subkind="boundary-bottom"]') as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(true);
  });

  it("removes .is-cursor when the cursor moves to a different row", () => {
    const cursor1: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };
    const cursor2: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor: cursor1 })));
    rerender(createElement(FileBlock, defaultProps({ cursor: cursor2 })));
    const additionRow = c.querySelector('.tour-row[data-line-type="addition"]') as HTMLElement;
    expect(additionRow.classList.contains("is-cursor")).toBe(false);
    const contextRow = c.querySelector('.tour-row[data-line-type="context"]') as HTMLElement;
    expect(contextRow.classList.contains("is-cursor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Composer slot
// ---------------------------------------------------------------------------

describe("<FileBlock> — composer slot", () => {
  it("renders the composerSlot inline at the anchor row's position when composerAnchor matches", () => {
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          composerAnchor: { side: "additions", line_end: 2 },
          composerSlot: createElement(
            "div",
            { className: "test-composer" },
            "composer here",
          ),
        }),
      ),
    );
    const composer = c.querySelector(".test-composer");
    expect(composer).not.toBeNull();
    expect(composer!.textContent).toBe("composer here");
    // The composer should be wrapped in a tour-card-style positioning div.
    const wrapper = composer!.closest(".tour-card") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.dataset.side).toBe("additions");
    // In split layout, additions composer anchors to cols 4 / -1 (#221).
    expect(wrapper.style.gridColumn).toMatch(/4\s*\/\s*-1/);
  });

  it("does not render the composer slot when composerAnchor is null", () => {
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          composerAnchor: null,
          composerSlot: createElement("div", { className: "test-composer" }),
        }),
      ),
    );
    expect(c.querySelector(".test-composer")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

describe("<FileBlock> — React.memo", () => {
  it("is wrapped in React.memo (component identity unaffected by re-renders)", () => {
    // Smoke test that re-rendering with identical props does not throw and
    // produces a stable DOM. Behavioural assertion of memo is checked by
    // the parent's render-count invariants (slice 6).
    const c = mount(createElement(FileBlock, defaultProps()));
    const before = c.querySelector(".tour-file-block")!.outerHTML;
    rerender(createElement(FileBlock, defaultProps()));
    const after = c.querySelector(".tour-file-block")!.outerHTML;
    expect(after).toBe(before);
  });
});
