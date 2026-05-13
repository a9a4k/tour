// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DiffRow,
  CardRow,
  InteractiveRow,
  EXPANSION_STEP,
} from "../../src/web/client/row-components.js";
import type { Annotation } from "../../src/web/client/types.js";

// `<DiffRow>`, `<CardRow>`, `<InteractiveRow>` are the row primitives the
// new web row renderer (PRD #212 slice 4) mounts. Each is `React.memo`'d
// and prop-driven (no internal state). Tests below cover the contract
// without booting App: render the component in happy-dom and assert the
// rendered DOM shape, attributes, and event-callback wiring.

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(el: React.ReactElement): HTMLDivElement {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return container;
}

function render(el: React.ReactElement): void {
  act(() => {
    root!.render(el);
  });
}

// ---------------------------------------------------------------------------
// DiffRow
// ---------------------------------------------------------------------------

describe("<DiffRow>", () => {
  it("renders a tour-row div with the line-type data attribute", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "split",
        leftLineNumber: null,
        rightLineNumber: 42,
        leftText: "",
        rightText: "const x = 1;",
        isCursor: false,
        isInRange: false,
      }),
    );
    const row = c.querySelector(".tour-row");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-line-type")).toBe("addition");
  });

  it("declares subgrid layout via inline style so columns inherit from the file grid", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 10,
        rightLineNumber: 10,
        leftText: "foo",
        rightText: "foo",
        isCursor: false,
        isInRange: false,
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.style.display).toBe("grid");
    expect(row.style.gridTemplateColumns).toContain("subgrid");
    expect(row.style.gridColumn).toMatch(/1\s*\/\s*-1/);
  });

  it("renders left + right line numbers in split layout", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 7,
        rightLineNumber: 9,
        leftText: "foo",
        rightText: "foo",
        isCursor: false,
        isInRange: false,
      }),
    );
    const gutters = c.querySelectorAll(".tour-row [data-line-number]");
    expect(gutters.length).toBe(2);
    expect(gutters[0]!.textContent).toBe("7");
    expect(gutters[1]!.textContent).toBe("9");
  });

  it("renders a single line number in unified layout", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "unified",
        leftLineNumber: null,
        rightLineNumber: 99,
        leftText: "",
        rightText: "x",
        isCursor: false,
        isInRange: false,
      }),
    );
    const gutters = c.querySelectorAll(".tour-row [data-line-number]");
    expect(gutters.length).toBe(1);
    expect(gutters[0]!.textContent).toBe("99");
  });

  it("paints token HTML via dangerouslySetInnerHTML when tokens are provided", () => {
    const tokensRight = new Map<number, string>([
      [42, '<span style="color:#abcdef">const</span>'],
    ]);
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "split",
        leftLineNumber: null,
        rightLineNumber: 42,
        leftText: "",
        rightText: "const x = 1;",
        tokensRight,
        isCursor: false,
        isInRange: false,
      }),
    );
    const code = c.querySelector('.tour-row [data-side="additions"] .tour-row-code');
    expect(code).not.toBeNull();
    expect(code!.innerHTML).toContain('color:#abcdef');
    expect(code!.innerHTML).toContain("const");
  });

  it("falls back to plain text when tokens are absent", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "unified",
        leftLineNumber: null,
        rightLineNumber: 1,
        leftText: "",
        rightText: "plain text",
        isCursor: false,
        isInRange: false,
      }),
    );
    const code = c.querySelector(".tour-row .tour-row-code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("plain text");
  });

  it("applies .is-cursor to the single code cell in unified layout when isCursor is true", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "unified",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "x",
        rightText: "x",
        isCursor: true,
        isInRange: false,
      }),
    );
    let cell = c.querySelector(".tour-row-cell") as HTMLElement;
    expect(cell.classList.contains("is-cursor")).toBe(true);
    // Row container does not carry .is-cursor — the outline is per-cell now (#222).
    let row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(false);

    render(
      createElement(DiffRow, {
        kind: "context",
        layout: "unified",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        isInRange: false,
      }),
    );
    cell = c.querySelector(".tour-row-cell") as HTMLElement;
    expect(cell.classList.contains("is-cursor")).toBe(false);
    row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(false);
  });

  it("scopes the cursor outline to the additions-side cell only in split layout (#222)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: true,
        cursorSide: "additions",
        isInRange: false,
      }),
    );
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    expect(additionsCell.classList.contains("is-cursor")).toBe(true);
    expect(deletionsCell.classList.contains("is-cursor")).toBe(false);
    // The row container itself stays clean — outline doesn't span both halves.
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(false);
  });

  it("scopes the cursor outline to the deletions-side cell only in split layout (#222)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: true,
        cursorSide: "deletions",
        isInRange: false,
      }),
    );
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    expect(deletionsCell.classList.contains("is-cursor")).toBe(true);
    expect(additionsCell.classList.contains("is-cursor")).toBe(false);
  });

  it("falls back to the side-with-content for addition-only rows when cursorSide disagrees (#222)", () => {
    // Edge case from the issue: an addition-only row in split layout has no
    // deletions content. If cursorSide somehow points at deletions, scope to
    // the side carrying content (additions).
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "split",
        leftLineNumber: null,
        rightLineNumber: 7,
        leftText: "",
        rightText: "new",
        isCursor: true,
        cursorSide: "deletions",
        isInRange: false,
      }),
    );
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    expect(additionsCell.classList.contains("is-cursor")).toBe(true);
    expect(deletionsCell.classList.contains("is-cursor")).toBe(false);
  });

  it("applies .in-range when isInRange is true", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "unified",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        isInRange: true,
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.classList.contains("in-range")).toBe(true);
  });

  it("calls onClick with the clicked column's side in split layout", () => {
    const calls: Array<"additions" | "deletions"> = [];
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        isInRange: false,
        onClick: (side: "additions" | "deletions") => calls.push(side),
      }),
    );
    const leftCode = c.querySelector('.tour-row [data-side="deletions"] .tour-row-code') as HTMLElement;
    const rightCode = c.querySelector('.tour-row [data-side="additions"] .tour-row-code') as HTMLElement;
    expect(leftCode).not.toBeNull();
    expect(rightCode).not.toBeNull();

    act(() => {
      leftCode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      rightCode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(calls).toEqual(["deletions", "additions"]);
  });

  it("calls onClick with preferredSide for addition rows in split layout", () => {
    // An `addition` row in split has no deletion content — the deletion
    // column may not even be clickable. The clicker still gets a useful
    // side; for kind-typed rows the side is implied by `kind`.
    const sides: string[] = [];
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "split",
        leftLineNumber: null,
        rightLineNumber: 1,
        leftText: "",
        rightText: "x",
        isCursor: false,
        isInRange: false,
        onClick: (side: string) => sides.push(side),
      }),
    );
    const code = c.querySelector('[data-side="additions"] .tour-row-code') as HTMLElement;
    act(() => {
      code.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sides).toEqual(["additions"]);
  });

  it("emits a tour-row-symbol cell with '+' on addition rows (#221)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "split",
        leftLineNumber: null,
        rightLineNumber: 42,
        leftText: "",
        rightText: "const x = 1;",
        isCursor: false,
        isInRange: false,
      }),
    );
    const symbols = c.querySelectorAll(".tour-row-symbol");
    expect(symbols.length).toBe(2);
    // Deletion column is blank (null lineNumber on addition).
    expect(symbols[0]!.textContent).toBe("");
    expect((symbols[0] as HTMLElement).dataset.side).toBe("deletions");
    // Additions column carries the '+'.
    expect(symbols[1]!.textContent).toBe("+");
    expect((symbols[1] as HTMLElement).dataset.side).toBe("additions");
  });

  it("emits a tour-row-symbol cell with '-' on deletion rows in split (#221)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "deletion",
        layout: "split",
        leftLineNumber: 7,
        rightLineNumber: null,
        leftText: "old line",
        rightText: "",
        isCursor: false,
        isInRange: false,
      }),
    );
    const symbols = c.querySelectorAll(".tour-row-symbol");
    expect(symbols.length).toBe(2);
    expect(symbols[0]!.textContent).toBe("-");
    expect(symbols[1]!.textContent).toBe("");
  });

  it("emits blank tour-row-symbol cells on context rows (#221)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        isInRange: false,
      }),
    );
    const symbols = c.querySelectorAll(".tour-row-symbol");
    // Cells still rendered to preserve column alignment.
    expect(symbols.length).toBe(2);
    expect(symbols[0]!.textContent).toBe("");
    expect(symbols[1]!.textContent).toBe("");
  });

  it("emits paired -/+ symbols on change rows in split layout (#221)", () => {
    // Planner emits split-mode change pairs as a single row with both
    // sides populated; <FileBlock> maps that to kind: "change-addition".
    const c = mount(
      createElement(DiffRow, {
        kind: "change-addition",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "old",
        rightText: "new",
        isCursor: false,
        isInRange: false,
      }),
    );
    const symbols = c.querySelectorAll(".tour-row-symbol");
    expect(symbols.length).toBe(2);
    expect(symbols[0]!.textContent).toBe("-");
    expect(symbols[1]!.textContent).toBe("+");
  });

  it("emits a single tour-row-symbol cell in unified layout (#221)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "unified",
        leftLineNumber: null,
        rightLineNumber: 99,
        leftText: "",
        rightText: "x",
        isCursor: false,
        isInRange: false,
      }),
    );
    const symbols = c.querySelectorAll(".tour-row-symbol");
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.textContent).toBe("+");
  });

  it("calls onMouseEnter when the row is hovered", () => {
    let hovered = 0;
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "unified",
        leftLineNumber: null,
        rightLineNumber: 1,
        leftText: "",
        rightText: "x",
        isCursor: false,
        isInRange: false,
        onMouseEnter: () => {
          hovered += 1;
        },
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    // React synthesises onMouseEnter from native mouseover events on
    // the delegation root; mouseenter itself doesn't bubble.
    act(() => {
      row.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(hovered).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CardRow
// ---------------------------------------------------------------------------

const baseAnnotation: Annotation = {
  id: "ann-1",
  file: "x.txt",
  side: "additions",
  line_start: 1,
  line_end: 1,
  body: "hello",
  author: "human",
  author_kind: "human",
  created_at: "2026-05-11T00:00:00Z",
};

describe("<CardRow>", () => {
  it("mounts the AnnotationCard and exposes the annotation body", () => {
    const c = mount(
      createElement(CardRow, {
        annotation: baseAnnotation,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        side: "additions",
        layout: "unified",
      }),
    );
    const card = c.querySelector(".tour-card .annotation-block");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("hello");
    expect(card!.getAttribute("data-annotation-id")).toBe("ann-1");
  });

  it("places the card row as full-width in unified layout", () => {
    const c = mount(
      createElement(CardRow, {
        annotation: baseAnnotation,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        side: "additions",
        layout: "unified",
      }),
    );
    const row = c.querySelector(".tour-card") as HTMLElement;
    expect(row.dataset.side).toBe("additions");
    expect(row.style.gridColumn).toMatch(/1\s*\/\s*-1/);
  });

  it("anchors deletion cards to the left columns (cols 1-3) in split layout (#221)", () => {
    const c = mount(
      createElement(CardRow, {
        annotation: { ...baseAnnotation, side: "deletions" },
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        side: "deletions",
        layout: "split",
      }),
    );
    const row = c.querySelector(".tour-card") as HTMLElement;
    expect(row.dataset.side).toBe("deletions");
    expect(row.style.gridColumn).toMatch(/1\s*\/\s*4/);
  });

  it("anchors addition cards to the right columns (cols 4 / -1) in split layout (#221)", () => {
    const c = mount(
      createElement(CardRow, {
        annotation: baseAnnotation,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        side: "additions",
        layout: "split",
      }),
    );
    const row = c.querySelector(".tour-card") as HTMLElement;
    expect(row.dataset.side).toBe("additions");
    expect(row.style.gridColumn).toMatch(/4\s*\/\s*-1/);
  });

  it("forwards registerRef so the App-level ref map is populated", () => {
    const calls: Array<{ id: string; el: HTMLDivElement | null }> = [];
    mount(
      createElement(CardRow, {
        annotation: baseAnnotation,
        isCurrent: false,
        navIndex: 1,
        navTotal: 1,
        side: "additions",
        layout: "unified",
        registerRef: (id, el) => calls.push({ id, el }),
      }),
    );
    expect(calls.some((c) => c.id === "ann-1" && c.el !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// InteractiveRow
// ---------------------------------------------------------------------------

describe("<InteractiveRow>", () => {
  it("renders a clickable tour-row with the subkind and direction data attributes", () => {
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "hunk-separator",
        boundaryRef: 1,
        direction: "both",
        gapAbove: 8,
        isCursor: false,
        onActivate: () => {},
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.dataset.subkind).toBe("hunk-separator");
    expect(row.dataset.direction).toBe("both");
  });

  it("renders the glyph when provided", () => {
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "gap-mid-top",
        boundaryRef: 2,
        direction: "up",
        gapAbove: 12,
        glyph: "↑",
        isCursor: false,
        onActivate: () => {},
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.textContent).toContain("↑");
  });

  it("calls onActivate(EXPANSION_STEP) on a plain click", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "hunk-separator",
        boundaryRef: 1,
        direction: "both",
        gapAbove: 8,
        isCursor: false,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([EXPANSION_STEP]);
  });

  it("expands the entire gap on shift-click (count = max(gapAbove, EXPANSION_STEP))", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "hunk-separator",
        boundaryRef: 1,
        direction: "both",
        gapAbove: 73,
        isCursor: false,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(calls).toEqual([Math.max(73, EXPANSION_STEP)]);
  });

  it("calls onActivate on Enter while isCursor is true", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "hunk-separator",
        boundaryRef: 1,
        direction: "both",
        gapAbove: 4,
        isCursor: true,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(calls).toEqual([EXPANSION_STEP]);
  });

  it("does NOT call onActivate on Enter when isCursor is false", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "hunk-separator",
        boundaryRef: 1,
        direction: "both",
        gapAbove: 4,
        isCursor: false,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(calls).toEqual([]);
  });

  it("Shift+Enter while isCursor expands the entire gap", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "gap-mid-top",
        boundaryRef: 2,
        direction: "up",
        gapAbove: 99,
        isCursor: true,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          shiftKey: true,
        }),
      );
    });
    expect(calls).toEqual([Math.max(99, EXPANSION_STEP)]);
  });

  it("applies .is-cursor when isCursor is true", () => {
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "boundary-bottom",
        boundaryRef: "bottom",
        direction: "down",
        gapAbove: 3,
        isCursor: true,
        onActivate: () => {},
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(true);
  });
});
