// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { walkCursorRows } from "../../src/web/client/cursor-rows.js";

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
  line: number | string;
  type: "addition" | "deletion" | "change-addition" | "change-deletion" | "context";
  altLine?: number | string;
}): HTMLElement {
  const attrs: Record<string, string> = {
    "data-line": String(opts.line),
    "data-line-type": opts.type,
  };
  if (opts.altLine !== undefined) attrs["data-alt-line"] = String(opts.altLine);
  return el("div", attrs);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("walkCursorRows: file scoping", () => {
  it("emits zero rows when no [data-file] blocks are present", () => {
    document.body.appendChild(el("div", {}, [cell({ line: 1, type: "context" })]));
    expect(walkCursorRows(document.body)).toEqual([]);
  });

  it("scopes each cell to its parent [data-file] wrapper", () => {
    const f1 = fileBlock("a.ts", [cell({ line: 1, type: "addition" })]);
    const f2 = fileBlock("b.ts", [cell({ line: 5, type: "addition" })]);
    document.body.append(f1, f2);
    const rows = walkCursorRows(document.body);
    expect(rows.map((r) => r.file)).toEqual(["a.ts", "b.ts"]);
    expect(rows[0].lineNumber).toBe(1);
    expect(rows[1].lineNumber).toBe(5);
  });

  it("walks multiple [data-file] blocks in document order", () => {
    document.body.append(
      fileBlock("first", [cell({ line: 10, type: "addition" })]),
      fileBlock("second", [cell({ line: 20, type: "addition" })]),
      fileBlock("third", [cell({ line: 30, type: "addition" })]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows.map((r) => r.file)).toEqual(["first", "second", "third"]);
  });
});

describe("walkCursorRows: row shapes", () => {
  it("pure-addition cell → paired=false, side=additions, lineNumber from data-line", () => {
    document.body.appendChild(
      fileBlock("x.ts", [cell({ line: 7, type: "addition" })]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows).toEqual([
      {
        kind: "diff",
        file: "x.ts",
        lineNumber: 7,
        side: "additions",
        leftLineNumber: null,
        rightLineNumber: 7,
        paired: false,
      },
    ]);
  });

  it("pure-deletion cell → paired=false, side=deletions, lineNumber from data-line", () => {
    document.body.appendChild(
      fileBlock("x.ts", [cell({ line: 3, type: "deletion" })]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows).toEqual([
      {
        kind: "diff",
        file: "x.ts",
        lineNumber: 3,
        side: "deletions",
        leftLineNumber: 3,
        rightLineNumber: null,
        paired: false,
      },
    ]);
  });

  it("context cell with data-alt-line → paired=true with both line numbers", () => {
    document.body.appendChild(
      fileBlock("x.ts", [cell({ line: 5, type: "context", altLine: 7 })]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows[0]).toMatchObject({
      file: "x.ts",
      leftLineNumber: 5,
      rightLineNumber: 7,
      paired: true,
      side: "additions",
      lineNumber: 7,
    });
  });

  it("context cell without data-alt-line → both sides equal data-line (paired)", () => {
    document.body.appendChild(
      fileBlock("x.ts", [cell({ line: 1, type: "context" })]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows[0]).toMatchObject({
      leftLineNumber: 1,
      rightLineNumber: 1,
      paired: true,
    });
  });

  it("change-addition / change-deletion paired cells de-dupe to one FlatRow per side", () => {
    // Split layout paints a paired change as TWO sibling cells (no
    // data-alt-line on either). Both refer to the same logical row by
    // (file, line, side); the walker should still emit one entry per
    // side so the cursor can address either.
    document.body.appendChild(
      fileBlock("x.ts", [
        cell({ line: 4, type: "change-deletion" }),
        cell({ line: 4, type: "change-addition" }),
      ]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ side: "deletions", lineNumber: 4 });
    expect(rows[1]).toMatchObject({ side: "additions", lineNumber: 4 });
  });

  it("ignores cells without data-line-type (unrecognized rows)", () => {
    document.body.appendChild(
      fileBlock("x.ts", [
        el("div", { "data-line": "1" }),
        cell({ line: 2, type: "addition" }),
      ]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows).toHaveLength(1);
    expect(rows[0].lineNumber).toBe(2);
  });
});

describe("walkCursorRows: collapsed file (zero cells)", () => {
  it("collapsed file (file-block with no [data-line] descendants) contributes zero rows", () => {
    document.body.append(
      fileBlock("a.ts", []),
      fileBlock("b.ts", [cell({ line: 1, type: "addition" })]),
    );
    const rows = walkCursorRows(document.body);
    expect(rows.map((r) => r.file)).toEqual(["b.ts"]);
  });
});

describe("walkCursorRows: shadow DOM", () => {
  it("descends into open shadow roots (Pierre's per-file scope)", () => {
    const block = el("div", { "data-file": "x.ts" });
    const shadow = block.attachShadow({ mode: "open" });
    shadow.appendChild(cell({ line: 9, type: "addition" }));
    document.body.appendChild(block);
    const rows = walkCursorRows(document.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ file: "x.ts", lineNumber: 9 });
  });
});
