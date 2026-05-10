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
