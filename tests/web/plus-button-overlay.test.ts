// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncPlusButtonOverlay } from "../../src/web/client/plus-button-overlay.js";

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

const cleanups: Array<() => void> = [];
function attach(
  root: ParentNode,
  onClick: (anchor: { file: string; side: "additions" | "deletions"; line: number }) => void,
  composerOpen: boolean,
): void {
  cleanups.push(syncPlusButtonOverlay(root, onClick, composerOpen));
}

function plusButtons(scope: ParentNode = document.body): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button.tour-plus-button"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

// Wait one microtask + macrotask so MutationObserver callbacks fire.
async function flushObservers(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("syncPlusButtonOverlay: mount on attribute flip", () => {
  it("mounts a button next to a cell that gains data-tour-cursor='true'", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    expect(plusButtons()).toHaveLength(0);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
  });

  it("mounts a button next to a cell that gains data-tour-hover='true'", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
  });

  it("mounts buttons for cells that already carry the keying attribute at attach time", () => {
    const c = cell({ line: 5, type: "addition" });
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    expect(plusButtons()).toHaveLength(1);
  });
});

describe("syncPlusButtonOverlay: coexistence", () => {
  it("two buttons coexist when cursor + hover land on different rows", async () => {
    const a = cell({ line: 5, type: "addition" });
    const b = cell({ line: 10, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [a, b]));
    attach(document.body, () => {}, false);
    a.setAttribute("data-tour-cursor", "true");
    a.setAttribute("data-tour-cursor-side", "additions");
    b.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(2);
  });

  it("a single cell carrying both attributes still has a single button", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
  });
});

describe("syncPlusButtonOverlay: composer-open suppression", () => {
  it("clears all buttons when attached with composerOpen=true", () => {
    const c = cell({ line: 5, type: "addition" });
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, true);
    expect(plusButtons()).toHaveLength(0);
  });

  it("composerOpen=true: subsequent attribute flips do NOT mount a button", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, true);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(0);
  });
});

describe("syncPlusButtonOverlay: click anchor", () => {
  it("clicking the button invokes onClick with {file, side, line}", async () => {
    const c = cell({ line: 7, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const onClick = vi.fn();
    attach(document.body, onClick, false);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    const [btn] = plusButtons();
    btn.click();
    expect(onClick).toHaveBeenCalledWith({ file: "x.ts", side: "additions", line: 7 });
  });

  it("click does not bubble to row-click handlers (preserves two-step contract)", async () => {
    const c = cell({ line: 7, type: "addition" });
    const block = fileBlock("x.ts", [c]);
    document.body.appendChild(block);
    const rowClicked = vi.fn();
    block.addEventListener("click", rowClicked);
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    const [btn] = plusButtons();
    btn.click();
    expect(rowClicked).not.toHaveBeenCalled();
  });

  it("derives the click side from data-line-type for hover cells (context → additions)", async () => {
    const c = cell({ line: 4, type: "context" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const onClick = vi.fn();
    attach(document.body, onClick, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    plusButtons()[0].click();
    expect(onClick).toHaveBeenCalledWith({ file: "x.ts", side: "additions", line: 4 });
  });

  it("derives the click side from data-line-type for hover cells (deletion → deletions)", async () => {
    const c = cell({ line: 4, type: "deletion" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const onClick = vi.fn();
    attach(document.body, onClick, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    plusButtons()[0].click();
    expect(onClick).toHaveBeenCalledWith({ file: "x.ts", side: "deletions", line: 4 });
  });
});

describe("syncPlusButtonOverlay: side scoping in split layout", () => {
  it("cursor button takes side from data-tour-cursor-side (split layout, paired context)", async () => {
    // Same line on both columns; cursor pinned to additions side.
    const leftCtx = cell({ line: 60, type: "context" });
    const rightCtx = cell({ line: 60, type: "context" });
    const dels = el("code", { "data-deletions": "" }, [leftCtx]);
    const adds = el("code", { "data-additions": "" }, [rightCtx]);
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [dels, adds]));
    const onClick = vi.fn();
    attach(document.body, onClick, false);
    rightCtx.setAttribute("data-tour-cursor", "true");
    rightCtx.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    const buttons = plusButtons();
    expect(buttons).toHaveLength(1);
    // Button anchors on the additions-side cell (its parent is the cursor cell).
    expect(buttons[0].closest("[data-tour-cursor]")).toBe(rightCtx);
    buttons[0].click();
    expect(onClick).toHaveBeenCalledWith({ file: "x.ts", side: "additions", line: 60 });
  });

  it("hover button takes side from the hovered cell's data-line-type", async () => {
    const leftDel = cell({ line: 4, type: "change-deletion" });
    const rightAdd = cell({ line: 4, type: "change-addition" });
    const dels = el("code", { "data-deletions": "" }, [leftDel]);
    const adds = el("code", { "data-additions": "" }, [rightAdd]);
    document.body.appendChild(el("div", { "data-file": "x.ts" }, [dels, adds]));
    const onClick = vi.fn();
    attach(document.body, onClick, false);
    leftDel.setAttribute("data-tour-hover", "true");
    await flushObservers();
    const buttons = plusButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest("[data-tour-hover]")).toBe(leftDel);
    buttons[0].click();
    expect(onClick).toHaveBeenCalledWith({ file: "x.ts", side: "deletions", line: 4 });
  });
});

describe("syncPlusButtonOverlay: removal on attribute clear", () => {
  it("removes the button when the keying attribute is cleared", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
    c.removeAttribute("data-tour-hover");
    await flushObservers();
    expect(plusButtons()).toHaveLength(0);
  });

  it("keeps the button when one of two keying attributes is cleared", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    c.removeAttribute("data-tour-hover");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
  });
});

describe("syncPlusButtonOverlay: cleanup", () => {
  it("returned cleanup removes all mounted buttons", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const cleanup = syncPlusButtonOverlay(document.body, () => {}, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
    cleanup();
    expect(plusButtons()).toHaveLength(0);
  });

  it("returned cleanup detaches the observer (no further mounts after cleanup)", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const cleanup = syncPlusButtonOverlay(document.body, () => {}, false);
    cleanup();
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(plusButtons()).toHaveLength(0);
  });
});
