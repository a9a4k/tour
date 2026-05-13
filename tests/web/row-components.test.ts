// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DiffRow,
  CardRow,
  InteractiveRow,
  HunkHeaderBanner,
  EXPANSION_STEP,
  parseHunkHeader,
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

  it("paints the per-cell range cue when rightInRange is true in unified layout (#226)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "unified",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        rightInRange: true,
      }),
    );
    const gutter = c.querySelector(".tour-row-gutter") as HTMLElement;
    const symbol = c.querySelector(".tour-row-symbol") as HTMLElement;
    const cell = c.querySelector(".tour-row-cell") as HTMLElement;
    expect(gutter.classList.contains("in-range")).toBe(true);
    expect(symbol.classList.contains("in-range")).toBe(true);
    expect(cell.classList.contains("in-range")).toBe(true);
    // Stripe sits on the single gutter — leftmost edge of the row.
    expect(gutter.classList.contains("in-range-stripe")).toBe(true);
    // Row container itself does NOT carry .in-range — the cue is per-cell now.
    const row = c.querySelector(".tour-row") as HTMLElement;
    expect(row.classList.contains("in-range")).toBe(false);
  });

  it("paints the per-cell range cue in unified layout when leftInRange is the only flag set (#226)", () => {
    // Pre-#226, the planner emitted `rightTinted` for all unified annotations,
    // but the renderer should still light up when only `leftInRange` is set.
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "unified",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        leftInRange: true,
      }),
    );
    const cell = c.querySelector(".tour-row-cell") as HTMLElement;
    expect(cell.classList.contains("in-range")).toBe(true);
  });

  it("scopes the range tint to the additions cells only when rightInRange is true in split layout (#226)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        rightInRange: true,
      }),
    );
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    const additionsSymbol = c.querySelector(
      '.tour-row-symbol[data-side="additions"]',
    ) as HTMLElement;
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const deletionsSymbol = c.querySelector(
      '.tour-row-symbol[data-side="deletions"]',
    ) as HTMLElement;
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    expect(additionsGutter.classList.contains("in-range")).toBe(true);
    expect(additionsSymbol.classList.contains("in-range")).toBe(true);
    expect(additionsCell.classList.contains("in-range")).toBe(true);
    expect(deletionsGutter.classList.contains("in-range")).toBe(false);
    expect(deletionsSymbol.classList.contains("in-range")).toBe(false);
    expect(deletionsCell.classList.contains("in-range")).toBe(false);
    // Stripe sits at the left edge of the additions gutter (boundary
    // between the halves) — never on the deletions gutter.
    expect(additionsGutter.classList.contains("in-range-stripe")).toBe(true);
    expect(deletionsGutter.classList.contains("in-range-stripe")).toBe(false);
  });

  it("scopes the range tint to the deletions cells only when leftInRange is true in split layout (#226)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        leftInRange: true,
      }),
    );
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsCell.classList.contains("in-range")).toBe(true);
    expect(additionsCell.classList.contains("in-range")).toBe(false);
    // Stripe sits at the left edge of the deletions gutter (row's
    // leftmost edge).
    expect(deletionsGutter.classList.contains("in-range-stripe")).toBe(true);
    expect(additionsGutter.classList.contains("in-range-stripe")).toBe(false);
  });

  it("tints both sides but anchors the stripe to deletions gutter only in the both-sides fallback (#226)", () => {
    // Rare multi-line annotation with anchors on both sides: both
    // `leftInRange` and `rightInRange` are true. Both sides get the tint;
    // only one stripe — at the row's leftmost edge (the deletions gutter).
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: false,
        leftInRange: true,
        rightInRange: true,
      }),
    );
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsCell.classList.contains("in-range")).toBe(true);
    expect(additionsCell.classList.contains("in-range")).toBe(true);
    // Exactly one gutter wears the stripe class — and it's the leftmost
    // (deletions) gutter so the visual stripe stays at the row's left edge.
    expect(deletionsGutter.classList.contains("in-range-stripe")).toBe(true);
    expect(additionsGutter.classList.contains("in-range-stripe")).toBe(false);
  });

  it("re-routes a right-only flag to deletions on a deletion-only split-layout row when content lives on the left (#226)", () => {
    // Defensive fallback: if the flag points at the side with no
    // content, scope the cue to the side that actually carries a line
    // number. Mirror of the cursor side-scoping fallback in #222.
    const c = mount(
      createElement(DiffRow, {
        kind: "deletion",
        layout: "split",
        leftLineNumber: 7,
        rightLineNumber: null,
        leftText: "old",
        rightText: "",
        isCursor: false,
        rightInRange: true,
      }),
    );
    const deletionsCell = c.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsCell.classList.contains("in-range")).toBe(true);
    expect(additionsCell.classList.contains("in-range")).toBe(false);
  });

  it("emits data-line-number=\"\" on the empty-side gutter so file-grid-css can paint the neutral fill (#227)", () => {
    // Pure-addition split-layout row: deletions-side gutter has no line
    // number. The empty signal is `data-line-number=""` (already required
    // for column alignment); the neutral-fill CSS keys on it.
    const c = mount(
      createElement(DiffRow, {
        kind: "addition",
        layout: "split",
        leftLineNumber: null,
        rightLineNumber: 42,
        leftText: "",
        rightText: "const x = 1;",
        isCursor: false,
      }),
    );
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsGutter.getAttribute("data-line-number")).toBe("");
    expect(additionsGutter.getAttribute("data-line-number")).toBe("42");
  });

  it("emits data-line-number=\"\" on the empty-side gutter for pure-deletion rows (#227)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "deletion",
        layout: "split",
        leftLineNumber: 7,
        rightLineNumber: null,
        leftText: "old line",
        rightText: "",
        isCursor: false,
      }),
    );
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsGutter.getAttribute("data-line-number")).toBe("7");
    expect(additionsGutter.getAttribute("data-line-number")).toBe("");
  });

  it("both gutters carry non-empty data-line-number on context rows so neither side reads as empty (#227)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "context",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "x",
        rightText: "x",
        isCursor: false,
      }),
    );
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsGutter.getAttribute("data-line-number")).toBe("5");
    expect(additionsGutter.getAttribute("data-line-number")).toBe("5");
  });

  it("both gutters carry non-empty data-line-number on paired change rows (#227)", () => {
    const c = mount(
      createElement(DiffRow, {
        kind: "change-addition",
        layout: "split",
        leftLineNumber: 5,
        rightLineNumber: 5,
        leftText: "old",
        rightText: "new",
        isCursor: false,
      }),
    );
    const deletionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="deletions"]',
    ) as HTMLElement;
    const additionsGutter = c.querySelector(
      '.tour-row-gutter[data-side="additions"]',
    ) as HTMLElement;
    expect(deletionsGutter.getAttribute("data-line-number")).toBe("5");
    expect(additionsGutter.getAttribute("data-line-number")).toBe("5");
  });

  it("composes per-cell range tint with the cursor outline scoped to the cursored cell (#226)", () => {
    // Decorations are independent: the cursored cell carries .is-cursor,
    // the tinted side carries .in-range, both can land on the same
    // .tour-row-cell without one overriding the other.
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
        rightInRange: true,
      }),
    );
    const additionsCell = c.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    expect(additionsCell.classList.contains("is-cursor")).toBe(true);
    expect(additionsCell.classList.contains("in-range")).toBe(true);
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
        subKind: "expand-up",
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
        subKind: "expand-up",
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

  it("renders as a full-width banner without declaring subgrid inline (#224)", () => {
    // The banner overrides .tour-row's `display: grid` + subgrid template
    // via CSS so the glyph centers as a block, not slots into the narrow
    // gutter track. The inline style should set gridColumn only — no
    // display:grid, no grid-template-columns — mirroring <HunkHeaderBanner>.
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "expand-up",
        boundaryRef: 1,
        direction: "up",
        gapAbove: 12,
        glyph: "↑ Expand Up",
        isCursor: false,
        onActivate: () => {},
      }),
    );
    const row = c.querySelector(".tour-row.tour-row-interactive") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.gridColumn).toMatch(/1\s*\/\s*-1/);
    expect(row.style.display).not.toBe("grid");
    expect(row.style.gridTemplateColumns).toBe("");
  });

  // PRD #270 / issue #271: `expand-all` always reveals the entire
  // remaining gap in one Enter — the button's label IS the contract.
  // Click + Enter (with or without Shift) dispatches `count = gapAbove`,
  // never EXPANSION_STEP.
  it("`expand-all` click always dispatches count = gapAbove regardless of Shift (PRD #270)", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "expand-all",
        boundaryRef: 1,
        direction: "both",
        gapAbove: 12,
        glyph: "↕ Expand All 12 lines",
        isCursor: false,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(calls).toEqual([12, 12]);
  });

  it("`expand-all` Enter while isCursor dispatches count = gapAbove (PRD #270)", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "expand-all",
        boundaryRef: 2,
        direction: "both",
        gapAbove: 37,
        glyph: "↕ Expand All 37 lines",
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
    expect(calls).toEqual([37]);
  });

  it("`expand-up` click dispatches count = EXPANSION_STEP (not the full gap) on a plain click (PRD #270)", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "expand-up",
        boundaryRef: 1,
        direction: "up",
        gapAbove: 100,
        glyph: "↑ Expand Up",
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

  it("`expand-down` Shift+click dispatches the full gap (max(gapAbove, EXPANSION_STEP)) (PRD #270)", () => {
    const calls: number[] = [];
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "expand-down",
        boundaryRef: 1,
        direction: "down",
        gapAbove: 100,
        glyph: "↓ Expand Down",
        isCursor: false,
        onActivate: (count: number) => calls.push(count),
      }),
    );
    const row = c.querySelector(".tour-row") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(calls).toEqual([100]);
  });

  it("carries role=button + tabindex=0 for keyboard activation (#224)", () => {
    const c = mount(
      createElement(InteractiveRow, {
        subKind: "collapsed-file",
        boundaryRef: "top",
        direction: "down",
        gapAbove: 0,
        glyph: "··· 200 hidden ···",
        isCursor: false,
        onActivate: () => {},
      }),
    );
    const row = c.querySelector(".tour-row-interactive") as HTMLElement;
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// parseHunkHeader
// ---------------------------------------------------------------------------

describe("parseHunkHeader (#223)", () => {
  it("splits a header with function-context into range + context", () => {
    expect(parseHunkHeader("@@ -33,7 +33,7 @@ import {")).toEqual({
      range: "@@ -33,7 +33,7 @@",
      context: "import {",
    });
  });

  it("returns an empty context when the header has no function-context tail", () => {
    expect(parseHunkHeader("@@ -1,4 +1,4 @@")).toEqual({
      range: "@@ -1,4 +1,4 @@",
      context: "",
    });
  });

  it("handles single-line hunks (no `,b` count after the start lines)", () => {
    expect(parseHunkHeader("@@ -7 +7 @@ fn foo()")).toEqual({
      range: "@@ -7 +7 @@",
      context: "fn foo()",
    });
  });

  it("falls through with the full string in `range` when the regex doesn't match", () => {
    expect(parseHunkHeader("definitely not a hunk header")).toEqual({
      range: "definitely not a hunk header",
      context: "",
    });
  });

  it("strips trailing whitespace before matching so planner output with \\n parses correctly", () => {
    // Pierre's parser preserves git's trailing newline on the hunk-header
    // line. Without trimming, the `$` anchor wouldn't match after the `\n`
    // and the full string would land in `range`, leaving `context` empty.
    expect(parseHunkHeader("@@ -33,7 +33,7 @@ import {\n")).toEqual({
      range: "@@ -33,7 +33,7 @@",
      context: "import {",
    });
    expect(parseHunkHeader("@@ -1,4 +1,4 @@\n")).toEqual({
      range: "@@ -1,4 +1,4 @@",
      context: "",
    });
  });
});

// ---------------------------------------------------------------------------
// HunkHeaderBanner (#223; display-only per #272 / PRD #270 Slice 2)
// ---------------------------------------------------------------------------

describe("<HunkHeaderBanner> (#223; display-only per #272)", () => {
  it("renders a full-width tour-row with the tour-hunk-header class", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -33,7 +33,7 @@ import {",
        boundaryRef: 1,
        direction: "both",
        isCursor: false,
      }),
    );
    const row = c.querySelector(".tour-row.tour-hunk-header") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.gridColumn).toMatch(/1\s*\/\s*-1/);
  });

  it("renders two text segments: muted range + default-color context", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -33,7 +33,7 @@ import {",
        boundaryRef: 1,
        direction: "both",
        isCursor: false,
      }),
    );
    const range = c.querySelector(".tour-hunk-header-range") as HTMLElement;
    const context = c.querySelector(".tour-hunk-header-context") as HTMLElement;
    expect(range).not.toBeNull();
    expect(context).not.toBeNull();
    expect(range.textContent).toBe("@@ -33,7 +33,7 @@");
    expect(context.textContent).toBe("import {");
  });

  it("omits the context span when the header carries no function-context tail", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -1,4 +1,4 @@",
        boundaryRef: "top",
        direction: "up",
        isCursor: false,
      }),
    );
    const range = c.querySelector(".tour-hunk-header-range") as HTMLElement;
    const context = c.querySelector(".tour-hunk-header-context");
    expect(range.textContent).toBe("@@ -1,4 +1,4 @@");
    expect(context).toBeNull();
  });

  it("falls through to a single muted range span when the header is malformed", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "garbled header",
        boundaryRef: 1,
        direction: "both",
        isCursor: false,
      }),
    );
    const range = c.querySelector(".tour-hunk-header-range") as HTMLElement;
    const context = c.querySelector(".tour-hunk-header-context");
    expect(range.textContent).toBe("garbled header");
    expect(context).toBeNull();
  });

  it("emits data-subkind / data-direction / data-boundary-ref decorative attributes", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -1,4 +1,4 @@",
        boundaryRef: "top",
        direction: "up",
        isCursor: false,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect(row.dataset.subkind).toBe("boundary-top");
    expect(row.dataset.direction).toBe("up");
    expect(row.dataset.boundaryRef).toBe("top");
  });

  it("emits subkind=hunk-separator for numeric boundaryRef", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -33,7 +33,7 @@",
        boundaryRef: 2,
        direction: "both",
        isCursor: false,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect(row.dataset.subkind).toBe("hunk-separator");
    expect(row.dataset.boundaryRef).toBe("2");
  });

  // PRD #270 Slice 2 / issue #272: the banner is a pure display
  // component — no click handler, no keyboard handler, no role,
  // no tabIndex. The directional expand buttons emitted by
  // `expandRowsForGap` (Slice 1) are the only affordance.
  it("carries no role='button' attribute (display-only per #272)", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -1,4 +1,4 @@",
        boundaryRef: "top",
        direction: "up",
        isCursor: false,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect(row.getAttribute("role")).toBeNull();
  });

  it("carries no tabindex attribute (display-only per #272)", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -1,4 +1,4 @@",
        boundaryRef: "top",
        direction: "up",
        isCursor: false,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect(row.getAttribute("tabindex")).toBeNull();
  });

  it("clicking the banner is a no-op — does not bubble through to a handler nor dispatch (#272)", () => {
    // Wrap the banner in a div that records clicks; the banner's own
    // click handler is gone, so any synthetic click only registers via
    // bubbling. We don't intercept it (no e.stopPropagation), but no
    // dispatch happens because there is no onActivate prop.
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -33,7 +33,7 @@",
        boundaryRef: 1,
        direction: "both",
        isCursor: false,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    // No throw; no listener attached on the banner element. We verify
    // shape (no onclick prop) rather than absence-of-effect (which
    // would require a parent recorder — banner has no side-effect
    // contract anymore).
    expect((row as unknown as { onclick: unknown }).onclick).toBeNull();
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  });

  it("pressing Enter on the banner is a no-op (#272 — no keyboard handler)", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -1,4 +1,4 @@",
        boundaryRef: "top",
        direction: "up",
        isCursor: true,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect((row as unknown as { onkeydown: unknown }).onkeydown).toBeNull();
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  });

  it("applies .is-cursor on the row when isCursor is true (structural; cursor no longer walks here)", () => {
    const c = mount(
      createElement(HunkHeaderBanner, {
        header: "@@ -1,4 +1,4 @@",
        boundaryRef: "top",
        direction: "up",
        isCursor: true,
      }),
    );
    const row = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(true);
  });
});
