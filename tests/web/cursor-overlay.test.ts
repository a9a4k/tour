// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { syncCursorOverlay, scrollCursorIntoView } from "../../src/web/client/cursor-overlay.js";
import type { RowAnchor } from "../../src/core/cursor-state.js";

const cur = (over: Partial<RowAnchor> & Pick<RowAnchor, "file" | "lineNumber" | "side">): RowAnchor => ({
  kind: "row",
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
  // syncCursorOverlay holds module-level state for the pending one-shot
  // placement-scroll IO. Reset it via a null-cursor sync so each test
  // starts from a clean slate (disconnects any IO left over from a
  // previous test).
  syncCursorOverlay(document.body, null);
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

describe("syncCursorOverlay: does not auto-scroll", () => {
  // Scroll moved out to `scrollCursorIntoView` so the sync path (which
  // also runs on mouse-click cursor placement and on Pierre's worker
  // token re-renders) does not pay a layout flush per call. Auto-
  // scroll is a keyboard-only concern handled by the dispatch handler.
  it("does NOT call scrollIntoView when applying the cursor attrs", () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    syncCursorOverlay(document.body, cur({ file: "x.ts", lineNumber: 5, side: "additions" }));
    expect(scrolled).toBe(false);
  });
});

describe("scrollCursorIntoView", () => {
  // `scrollCursorIntoView` is the no-IO fallback path; in IO-capable
  // environments `syncCursorOverlay`'s one-shot observer handles
  // placement scroll without the synchronous layout flush. These tests
  // exercise the fallback by removing `IntersectionObserver` from the
  // global before each call.
  let savedIO: typeof IntersectionObserver | undefined;
  beforeEach(() => {
    savedIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
  });
  afterEach(() => {
    if (savedIO) {
      (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
        .IntersectionObserver = savedIO;
    }
  });

  it("scrolls the cursor's cell into view via scrollIntoView({ block: 'nearest' })", () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const calls: ScrollIntoViewOptions[] = [];
    c.scrollIntoView = (opts?: ScrollIntoViewOptions | boolean) => {
      calls.push(typeof opts === "object" && opts !== null ? opts : {});
    };
    // happy-dom's getBoundingClientRect returns zeros, so the cell is
    // treated as "above viewport top" (rect.top === 0 is fine, but the
    // viewport-height check below uses window.innerHeight which defaults
    // to 0 in happy-dom — meaning rect.bottom (0) > 0 is false, so the
    // visible-skip path would trigger. Force a non-zero rect.bottom to
    // simulate an off-screen cell.
    c.getBoundingClientRect = () => ({ top: 1000, bottom: 1020, left: 0, right: 100, width: 100, height: 20, x: 0, y: 1000, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    scrollCursorIntoView(document.body, cur({ file: "x.ts", lineNumber: 5, side: "additions" }));
    expect(calls).toEqual([{ block: "nearest" }]);
  });

  it("skips when the cell is already in viewport (no layout-thrashing scrollIntoView)", () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    c.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 0, right: 100, width: 100, height: 20, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    scrollCursorIntoView(document.body, cur({ file: "x.ts", lineNumber: 5, side: "additions" }));
    expect(scrolled).toBe(false);
  });

  it("does nothing when the cursor's file isn't in the DOM", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("a.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    scrollCursorIntoView(document.body, cur({ file: "missing.ts", lineNumber: 1, side: "additions" }));
    expect(scrolled).toBe(false);
  });

  it("does nothing when cursor is null", () => {
    const c = cell({ line: 1, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    scrollCursorIntoView(document.body, null);
    expect(scrolled).toBe(false);
  });
});

describe("scrollCursorIntoView: no-op when IntersectionObserver is available", () => {
  // The one-shot IO in syncCursorOverlay handles placement scroll
  // asynchronously off the synchronous hot path. scrollCursorIntoView
  // must NOT also do a synchronous scroll in IO-capable environments —
  // doing so would reintroduce the ~26% main-thread layout cost the IO
  // was built to avoid.
  it("returns without scrolling when IntersectionObserver is defined", () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    let scrolled = false;
    c.scrollIntoView = () => {
      scrolled = true;
    };
    c.getBoundingClientRect = () => ({ top: 1000, bottom: 1020, left: 0, right: 100, width: 100, height: 20, x: 0, y: 1000, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    // happy-dom defines IntersectionObserver — confirm it.
    expect(typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver).toBe(
      "function",
    );
    scrollCursorIntoView(document.body, cur({ file: "x.ts", lineNumber: 5, side: "additions" }));
    expect(scrolled).toBe(false);
  });
});
