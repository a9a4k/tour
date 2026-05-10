// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { syncCursorOverlay } from "../../src/web/client/cursor-overlay.js";
import type { Cursor } from "../../src/core/cursor-state.js";

const cur = (over: Partial<Cursor> & Pick<Cursor, "file" | "lineNumber" | "side">): Cursor => ({
  file: over.file,
  lineNumber: over.lineNumber,
  side: over.side,
  preferredSide: over.preferredSide ?? over.side,
});

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

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("syncCursorOverlay: attribute placement", () => {
  it("sets data-tour-cursor + data-tour-cursor-side on the matching cell", () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 5, side: "additions" }));
    expect(c.getAttribute("data-tour-cursor")).toBe("true");
    expect(c.getAttribute("data-tour-cursor-side")).toBe("additions");
  });

  it("scopes to the cursor's file (no attributes on other files' cells)", () => {
    const a = cell({ line: 1, type: "addition" });
    const b = cell({ line: 1, type: "addition" });
    document.body.append(fileBlock("a.ts", [a]), fileBlock("b.ts", [b]));
    syncCursorOverlay(document.body, cur({ file: "a.ts", lineNumber: 1, side: "additions" }));
    expect(a.hasAttribute("data-tour-cursor")).toBe(true);
    expect(b.hasAttribute("data-tour-cursor")).toBe(false);
  });

  it("scopes to the cursor's side in a paired change row (split layout)", () => {
    const del = cell({ line: 4, type: "change-deletion" });
    const add = cell({ line: 4, type: "change-addition" });
    document.body.appendChild(fileBlock("x.ts", [del, add]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 4, side: "additions" }));
    expect(add.getAttribute("data-tour-cursor")).toBe("true");
    expect(add.getAttribute("data-tour-cursor-side")).toBe("additions");
    expect(del.hasAttribute("data-tour-cursor")).toBe(false);
  });

  it("paints on the deletions-side cell when cursor.side is deletions", () => {
    const del = cell({ line: 4, type: "change-deletion" });
    const add = cell({ line: 4, type: "change-addition" });
    document.body.appendChild(fileBlock("x.ts", [del, add]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 4, side: "deletions" }));
    expect(del.getAttribute("data-tour-cursor")).toBe("true");
    expect(del.getAttribute("data-tour-cursor-side")).toBe("deletions");
    expect(add.hasAttribute("data-tour-cursor")).toBe(false);
  });

  it("accepts context rows on either cursor side (annotatable both sides)", () => {
    const ctx = cell({ line: 1, type: "context" });
    document.body.appendChild(fileBlock("x.ts", [ctx]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 1, side: "deletions" }));
    expect(ctx.getAttribute("data-tour-cursor")).toBe("true");
    expect(ctx.getAttribute("data-tour-cursor-side")).toBe("deletions");
  });

  // Issue #134. In Pierre's split layout, each file's shadow root holds two
  // sibling <code> blocks: data-deletions first, then data-additions. When
  // the same line number appears as a context cell on BOTH columns (because
  // the two sides have diverged due to upstream additions/deletions), the
  // type filter alone ("context" accepts either side) plus document-order
  // traversal landed the outline on the deletions cell even when the cursor
  // was anchored on the additions side. Scoping by the column container
  // disambiguates.
  it("disambiguates by column when the same line number is a context cell on both columns (issue #134)", () => {
    const leftCtx = cell({ line: 60, type: "context" });
    const rightCtx = cell({ line: 60, type: "context" });
    const dels = el("code", { "data-deletions": "" }, [leftCtx]);
    const adds = el("code", { "data-additions": "" }, [rightCtx]);
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [dels, adds]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 60, side: "additions" }));
    expect(rightCtx.getAttribute("data-tour-cursor")).toBe("true");
    expect(rightCtx.getAttribute("data-tour-cursor-side")).toBe("additions");
    expect(leftCtx.hasAttribute("data-tour-cursor")).toBe(false);
  });

  it("disambiguates by column on the deletions side too (issue #134, mirror case)", () => {
    const leftCtx = cell({ line: 60, type: "context" });
    const rightCtx = cell({ line: 60, type: "context" });
    const dels = el("code", { "data-deletions": "" }, [leftCtx]);
    const adds = el("code", { "data-additions": "" }, [rightCtx]);
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [dels, adds]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 60, side: "deletions" }));
    expect(leftCtx.getAttribute("data-tour-cursor")).toBe("true");
    expect(leftCtx.getAttribute("data-tour-cursor-side")).toBe("deletions");
    expect(rightCtx.hasAttribute("data-tour-cursor")).toBe(false);
  });
});

describe("syncCursorOverlay: cleanup on cursor change", () => {
  it("strips attributes from a previously-marked cell when the cursor moves", () => {
    const a = cell({ line: 1, type: "addition" });
    const b = cell({ line: 2, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [a, b]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 1, side: "additions" }));
    expect(a.hasAttribute("data-tour-cursor")).toBe(true);
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 2, side: "additions" }));
    expect(a.hasAttribute("data-tour-cursor")).toBe(false);
    expect(b.getAttribute("data-tour-cursor")).toBe("true");
  });

  it("strips attributes when cursor goes null (e.g., tour switch resets)", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 1, side: "additions" }));
    expect(c.hasAttribute("data-tour-cursor")).toBe(true);
    syncCursorOverlay(document.body, null);
    expect(c.hasAttribute("data-tour-cursor")).toBe(false);
    expect(c.hasAttribute("data-tour-cursor-side")).toBe(false);
  });

  it("returned cleanup strips attributes (effect teardown contract)", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const cleanup = syncCursorOverlay(
      document.body,
      cur({ file: "x.ts", lineNumber: 1, side: "additions" }),
    );
    expect(c.hasAttribute("data-tour-cursor")).toBe(true);
    cleanup();
    expect(c.hasAttribute("data-tour-cursor")).toBe(false);
  });

  it("idempotent: calling twice with the same cursor leaves a single marked cell", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 1, side: "additions" }));
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 1, side: "additions" }));
    const marked = document.body.querySelectorAll("[data-tour-cursor]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(c);
  });
});

describe("syncCursorOverlay: missing target", () => {
  it("does nothing when the cursor's file isn't in the DOM", () => {
    document.body.appendChild(fileBlock("a.ts", [cell({ line: 1, type: "addition" })]));
    syncCursorOverlay(
      document.body,
      cur({ file: "missing.ts", lineNumber: 1, side: "additions" }),
    );
    expect(document.body.querySelector("[data-tour-cursor]")).toBeNull();
  });

  it("does nothing when the line number isn't rendered (orphan / collapsed)", () => {
    document.body.appendChild(fileBlock("x.ts", [cell({ line: 1, type: "addition" })]));
    syncCursorOverlay(
      document.body,
      cur({ file: "x.ts", lineNumber: 99, side: "additions" }),
    );
    expect(document.body.querySelector("[data-tour-cursor]")).toBeNull();
  });
});

describe("syncCursorOverlay: shadow DOM", () => {
  it("crosses Pierre's open shadow root (per-file scope)", () => {
    const block = el("div", { "data-file": "x.ts" });
    const shadow = block.attachShadow({ mode: "open" });
    const c = cell({ line: 7, type: "addition" });
    shadow.appendChild(c);
    document.body.appendChild(block);
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 7, side: "additions" }));
    expect(c.getAttribute("data-tour-cursor")).toBe("true");
  });
});

describe("syncCursorOverlay: auto-scroll", () => {
  it("scrollIntoView({ block: 'nearest' }) on the cursor's cell after a move", () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const calls: ScrollIntoViewOptions[] = [];
    c.scrollIntoView = (opts?: ScrollIntoViewOptions | boolean) => {
      calls.push(typeof opts === "object" && opts !== null ? opts : {});
    };
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 5, side: "additions" }));
    expect(calls).toEqual([{ block: "nearest" }]);
  });

  it("does not scroll when the cursor's file isn't in the DOM", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("a.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    syncCursorOverlay(document.body, cur({ file: "missing.ts", lineNumber: 1, side: "additions" }));
    expect(scrolled).toBe(false);
  });

  it("does not scroll when the cursor goes null (e.g., tour switch)", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    syncCursorOverlay(document.body, null);
    expect(scrolled).toBe(false);
  });
});
