// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { resolveClickAnchor } from "../../src/web/client/click-anchor.js";

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

function cell(opts: {
  line: number | string;
  type: "addition" | "deletion" | "change-addition" | "change-deletion" | "context";
}): HTMLElement {
  return el("div", {
    "data-line": String(opts.line),
    "data-line-type": opts.type,
  });
}

// Compose the composedPath() array as the browser would: target first,
// then each ancestor up to document/window. We only need the elements
// the helper actually walks, so we stop at <body>.
function pathFrom(target: HTMLElement): EventTarget[] {
  const out: EventTarget[] = [];
  let node: HTMLElement | null = target;
  while (node) {
    out.push(node);
    node = node.parentElement;
  }
  return out;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("resolveClickAnchor: one-sided diff rows", () => {
  it("addition row → side=additions", () => {
    const c = cell({ line: 7, type: "addition" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toEqual({
      lineNumber: 7,
      side: "additions",
    });
  });

  it("deletion row → side=deletions", () => {
    const c = cell({ line: 3, type: "deletion" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toEqual({
      lineNumber: 3,
      side: "deletions",
    });
  });

  it("change-addition row → side=additions", () => {
    const c = cell({ line: 12, type: "change-addition" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toEqual({
      lineNumber: 12,
      side: "additions",
    });
  });

  it("change-deletion row → side=deletions", () => {
    const c = cell({ line: 12, type: "change-deletion" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toEqual({
      lineNumber: 12,
      side: "deletions",
    });
  });
});

describe("resolveClickAnchor: context rows (the bug fix)", () => {
  it("left column (inside [data-deletions]) → side=deletions", () => {
    const leftCtx = cell({ line: 60, type: "context" });
    const rightCtx = cell({ line: 60, type: "context" });
    const dels = el("code", { "data-deletions": "" }, [leftCtx]);
    const adds = el("code", { "data-additions": "" }, [rightCtx]);
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [dels, adds]));
    expect(resolveClickAnchor(pathFrom(leftCtx))).toEqual({
      lineNumber: 60,
      side: "deletions",
    });
  });

  it("right column (inside [data-additions]) → side=additions", () => {
    const leftCtx = cell({ line: 60, type: "context" });
    const rightCtx = cell({ line: 60, type: "context" });
    const dels = el("code", { "data-deletions": "" }, [leftCtx]);
    const adds = el("code", { "data-additions": "" }, [rightCtx]);
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [dels, adds]));
    expect(resolveClickAnchor(pathFrom(rightCtx))).toEqual({
      lineNumber: 60,
      side: "additions",
    });
  });

  it("unified layout (no Pierre column ancestor) → fallback side=additions", () => {
    const c = cell({ line: 9, type: "context" });
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [c]));
    expect(resolveClickAnchor(pathFrom(c))).toEqual({
      lineNumber: 9,
      side: "additions",
    });
  });
});

describe("resolveClickAnchor: misses and edge cases", () => {
  it("buffer / spacer row (no data-line ancestor) → null", () => {
    const spacer = el("div", { class: "buffer" });
    document.body.appendChild(spacer);
    expect(resolveClickAnchor(pathFrom(spacer))).toBeNull();
  });

  it("empty path → null", () => {
    expect(resolveClickAnchor([])).toBeNull();
  });

  it("non-Element path entries are skipped → null when nothing matches", () => {
    expect(resolveClickAnchor([window, document])).toBeNull();
  });

  it("non-numeric data-line → null", () => {
    const c = el("div", { "data-line": "not-a-number", "data-line-type": "addition" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toBeNull();
  });

  it("unrecognized data-line-type → null", () => {
    const c = el("div", { "data-line": "1", "data-line-type": "weird" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toBeNull();
  });

  it("data-line without data-line-type → null", () => {
    const c = el("div", { "data-line": "1" });
    document.body.appendChild(c);
    expect(resolveClickAnchor(pathFrom(c))).toBeNull();
  });
});
