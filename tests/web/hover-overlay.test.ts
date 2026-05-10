// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncHoverOverlay } from "../../src/web/client/hover-overlay.js";

function el(tag: string, attrs: Record<string, string> = {}, children: Node[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
}

function fileBlock(name: string, cells: HTMLElement[]): HTMLElement {
  return el("div", { "data-file": name, class: "file-block" }, cells);
}

function cell(opts: {
  line: number;
  type: "addition" | "deletion" | "change-addition" | "change-deletion" | "context";
}): HTMLElement {
  return el("div", {
    "data-line": String(opts.line),
    "data-line-type": opts.type,
  });
}

function fire(target: EventTarget, type: "mouseover" | "mouseout"): void {
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

// MouseEvent variant so the `relatedTarget`-based intra-cell filter can be
// exercised — plain `Event` doesn't carry relatedTarget.
function fireMouse(
  target: EventTarget,
  type: "mouseover" | "mouseout",
  relatedTarget: EventTarget | null,
): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, relatedTarget }));
}

const cleanups: Array<() => void> = [];
function attach(root: ParentNode, composerOpen: boolean): void {
  cleanups.push(syncHoverOverlay(root, composerOpen));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("syncHoverOverlay: attribute placement", () => {
  it("mouseover on an addition cell sets data-tour-hover='true'", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });

  it("mouseover on a deletion cell sets data-tour-hover='true'", () => {
    const c = cell({ line: 2, type: "deletion" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });

  it("mouseover on a change-addition cell sets data-tour-hover='true'", () => {
    const c = cell({ line: 3, type: "change-addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });

  it("mouseover on a context cell sets data-tour-hover='true' (context is annotatable)", () => {
    const c = cell({ line: 4, type: "context" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });
});

describe("syncHoverOverlay: non-annotatable rows", () => {
  it("mouseover on a hunk header row (no data-line-type) does NOT set data-tour-hover", () => {
    const hunk = el("div", { "data-line": "5" });
    document.body.appendChild(fileBlock("x.ts", [hunk]));
    attach(document.body, false);
    fire(hunk, "mouseover");
    expect(hunk.hasAttribute("data-tour-hover")).toBe(false);
  });

  it("mouseover on a row with no data-line attribute does NOT set data-tour-hover", () => {
    const non = el("div", {});
    document.body.appendChild(fileBlock("x.ts", [non]));
    attach(document.body, false);
    fire(non, "mouseover");
    expect(non.hasAttribute("data-tour-hover")).toBe(false);
  });
});

describe("syncHoverOverlay: mouseout cleanup", () => {
  it("mouseout clears data-tour-hover from the previously hovered cell", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.hasAttribute("data-tour-hover")).toBe(true);
    fire(c, "mouseout");
    expect(c.hasAttribute("data-tour-hover")).toBe(false);
  });

  it("moving from cell A to cell B leaves only B marked", () => {
    const a = cell({ line: 1, type: "addition" });
    const b = cell({ line: 2, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [a, b]));
    attach(document.body, false);
    fire(a, "mouseover");
    fire(a, "mouseout");
    fire(b, "mouseover");
    expect(a.hasAttribute("data-tour-hover")).toBe(false);
    expect(b.getAttribute("data-tour-hover")).toBe("true");
  });
});

// Defensive single-hover invariant. The previous design relied on mouseout
// always firing to clear `data-tour-hover` — but rapid motion, virtualizer
// scroll-out, or leaving the window all reliably drop mouseouts, stranding
// attributes on every visited cell. The diff ends up dotted with `+`
// buttons that never disappear. The fix: every onOver clears the previously
// hovered cell, regardless of whether its mouseout fired.
describe("syncHoverOverlay: single-hover invariant (regression)", () => {
  it("missed mouseout: onOver on cell B still clears stale data-tour-hover on cell A", () => {
    const a = cell({ line: 1, type: "addition" });
    const b = cell({ line: 2, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [a, b]));
    attach(document.body, false);
    fire(a, "mouseover");
    // Skip mouseout on A — simulates the dropped-event case.
    fire(b, "mouseover");
    expect(a.hasAttribute("data-tour-hover")).toBe(false);
    expect(b.getAttribute("data-tour-hover")).toBe("true");
  });

  it("hovering ten cells in sequence leaves at most one marked", () => {
    const cells = Array.from({ length: 10 }, (_, i) =>
      cell({ line: i + 1, type: "addition" }),
    );
    document.body.appendChild(fileBlock("x.ts", cells));
    attach(document.body, false);
    for (const c of cells) fire(c, "mouseover");
    const marked = cells.filter((c) => c.hasAttribute("data-tour-hover"));
    expect(marked.length).toBe(1);
    expect(marked[0]).toBe(cells[cells.length - 1]);
  });

  it("intra-cell mouseout (relatedTarget inside same cell) does NOT clear the hover", () => {
    const c = cell({ line: 1, type: "addition" });
    const innerA = el("span");
    const innerB = el("span");
    c.append(innerA, innerB);
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
    // Mouse moves from innerA to innerB — both children of the same cell.
    fireMouse(innerA, "mouseout", innerB);
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });

  it("mouseout onto the cell's own appended `+` button is treated as intra-cell", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    // Simulate plus-button-overlay appending its real-DOM button.
    const plus = el("button", { class: "tour-plus-button" });
    c.appendChild(plus);
    fireMouse(c, "mouseout", plus);
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });

  it("mouseout with no relatedTarget (mouse leaves window) clears the hover", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    fireMouse(c, "mouseout", null);
    expect(c.hasAttribute("data-tour-hover")).toBe(false);
  });
});

describe("syncHoverOverlay: composer-open suppression", () => {
  it("composer-open: mouseover does NOT set data-tour-hover", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, true);
    fire(c, "mouseover");
    expect(c.hasAttribute("data-tour-hover")).toBe(false);
  });

  it("a fresh attach with composerOpen=true clears any in-flight data-tour-hover attributes", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
    // Detach the previous (composer-closed) listener pair before
    // re-attaching with composerOpen=true so this models the App.tsx
    // useEffect re-run on composerOpen change.
    cleanups.pop()!();
    attach(document.body, true);
    expect(c.hasAttribute("data-tour-hover")).toBe(false);
  });
});

describe("syncHoverOverlay: cleanup", () => {
  it("returned cleanup detaches listeners (no further updates after cleanup)", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const cleanup = syncHoverOverlay(document.body, false);
    cleanup();
    fire(c, "mouseover");
    expect(c.hasAttribute("data-tour-hover")).toBe(false);
  });

  it("cleanup also strips any in-flight data-tour-hover attributes", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const cleanup = syncHoverOverlay(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
    cleanup();
    expect(c.hasAttribute("data-tour-hover")).toBe(false);
  });
});

describe("syncHoverOverlay: shadow DOM", () => {
  it("delegated listener fires for cells inside Pierre's open shadow root", () => {
    const block = el("div", { "data-file": "x.ts" });
    const shadow = block.attachShadow({ mode: "open" });
    const c = cell({ line: 1, type: "addition" });
    shadow.appendChild(c);
    document.body.appendChild(block);
    attach(document.body, false);
    fire(c, "mouseover");
    expect(c.getAttribute("data-tour-hover")).toBe("true");
  });
});
