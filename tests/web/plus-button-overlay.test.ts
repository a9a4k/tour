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

// "Visible" plus button = mounted in DOM AND its parent cell carries
// data-tour-cursor. Under the persistent-mount optimization the button is
// kept in the DOM after the attribute clears (CSS hides it via the
// cursor-attribute show rule in PLUS_BUTTON_CSS); from the user's POV
// it's gone. Tests assert on visibility, not raw DOM presence — that
// keeps the contract surface-level and lets the persistent-mount detail
// be exercised separately by `mountedPlusButtons` below.
function plusButtons(scope: ParentNode = document.body): HTMLButtonElement[] {
  return Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button.tour-plus-button"),
  ).filter((btn) => {
    const p = btn.parentElement;
    return !!p && p.hasAttribute("data-tour-cursor");
  });
}

function mountedPlusButtons(scope: ParentNode = document.body): HTMLButtonElement[] {
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

describe("syncPlusButtonOverlay: mount on cursor", () => {
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

  it("mounts buttons for cells that already carry data-tour-cursor at attach time", () => {
    const c = cell({ line: 5, type: "addition" });
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    expect(plusButtons()).toHaveLength(1);
  });

  it("does NOT mount on data-tour-hover (hover-driven path removed)", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-hover", "true");
    await flushObservers();
    expect(mountedPlusButtons()).toHaveLength(0);
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
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
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
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    const [btn] = plusButtons();
    btn.click();
    expect(rowClicked).not.toHaveBeenCalled();
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
    expect(buttons[0].closest("[data-tour-cursor]")).toBe(rightCtx);
    buttons[0].click();
    expect(onClick).toHaveBeenCalledWith({ file: "x.ts", side: "additions", line: 60 });
  });
});

describe("syncPlusButtonOverlay: visibility on cursor clear", () => {
  it("hides the button (no visible buttons) when data-tour-cursor is cleared", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    expect(plusButtons()).toHaveLength(1);
    c.removeAttribute("data-tour-cursor");
    await flushObservers();
    expect(plusButtons()).toHaveLength(0);
  });

  // Persistent-mount optimization: the button stays in the DOM after the
  // cursor moves off (avoids compositor-layer churn on cursor motion).
  // CSS handles show/hide via the parent attribute.
  it("keeps the button in the DOM after data-tour-cursor is cleared", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    attach(document.body, () => {}, false);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    expect(mountedPlusButtons()).toHaveLength(1);
    c.removeAttribute("data-tour-cursor");
    await flushObservers();
    expect(mountedPlusButtons()).toHaveLength(1);
  });
});

describe("syncPlusButtonOverlay: cleanup", () => {
  it("returned cleanup removes all mounted buttons", async () => {
    const c = cell({ line: 5, type: "addition" });
    document.body.appendChild(fileBlock("x.ts", [c]));
    const cleanup = syncPlusButtonOverlay(document.body, () => {}, false);
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
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
    c.setAttribute("data-tour-cursor", "true");
    c.setAttribute("data-tour-cursor-side", "additions");
    await flushObservers();
    expect(plusButtons()).toHaveLength(0);
  });
});
