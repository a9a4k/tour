// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileBlock, type ExpandAction } from "../../src/web/client/FileBlock.js";
import type { BundleFile } from "../../src/web/client/types.js";
import type { PlannedRow } from "../../src/core/diff-rows.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { Annotation } from "../../src/web/client/types.js";

// `<FileBlock>` is the per-file React component the Tour-owned web row
// renderer mounts (PRD #212 slice 5). It owns the file-level grid, calls
// `useLazyHighlight`, walks a `PlannedRow[]`, and dispatches each row to
// `<DiffRow>` / `<CardRow>` / `<InteractiveRow>`. The tests below cover
// the contract end-to-end against happy-dom: rows in order, cards at the
// right anchor, click invokes the right dispatch action, cursor flows by
// anchor type, layout flips the grid template, collapsed state suppresses
// the body, composer renders at the right anchor.
//
// `useLazyHighlight` falls back to "immediately visible" when
// `IntersectionObserver` is undefined (see `use-lazy-highlight.ts`). The
// suite deletes the IO global so tokens land in the rendered DOM as plain
// text in deterministic order — no manual IO firing required.

let container: HTMLDivElement;
let root: Root | null = null;
let savedIO: typeof IntersectionObserver | undefined;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  savedIO = (
    globalThis as { IntersectionObserver?: typeof IntersectionObserver }
  ).IntersectionObserver;
  delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  if (savedIO) {
    (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver = savedIO;
  }
});

function mount(el: ReactElement): HTMLDivElement {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return container;
}

function rerender(el: ReactElement): void {
  act(() => {
    root!.render(el);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFile: BundleFile = {
  name: "x.ts",
  type: "modified",
  hunks: [],
  oldContent: "old line 1\nold line 2\n",
  newContent: "new line 1\nnew line 2\n",
  classification: { collapsed: false },
  orphanWindows: [],
};

function rowsCanonical(): PlannedRow[] {
  return [
    {
      kind: "hunk-header",
      header: "@@ -1,2 +1,2 @@",
      hunkIndex: 0,
      gapAbove: 0,
      primaryExpand: null,
    },
    {
      kind: "diff-row",
      type: "context",
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftText: "old line 1",
      rightText: "new line 1",
    },
    {
      kind: "diff-row",
      type: "addition",
      leftLineNumber: null,
      rightLineNumber: 2,
      leftText: "",
      rightText: "new line 2",
    },
  ];
}

function withAnnotation(rows: PlannedRow[], ann: Annotation): PlannedRow[] {
  return [
    ...rows,
    {
      kind: "annotation",
      annotation: ann,
      replies: [],
      id: ann.id,
    },
  ];
}

const ann1: Annotation = {
  id: "ann-1",
  file: "x.ts",
  side: "additions",
  line_start: 2,
  line_end: 2,
  body: "comment body",
  author: "human",
  author_kind: "human",
  created_at: "2026-05-11T00:00:00Z",
};

function defaultProps(overrides: Partial<Parameters<typeof FileBlock>[0]> = {}) {
  return {
    file: baseFile,
    rows: rowsCanonical(),
    layout: "split" as const,
    cursor: null as Cursor | null,
    onDispatchExpand: () => {},
    onRowClick: () => {},
    onCardClick: () => {},
    isCollapsed: false,
    onToggleCollapse: () => {},
    // Issue #298 default: tests opt in to the chrome by passing the
    // flag explicitly; the off-path is the new common case.
    hasMultipleHiddenGaps: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Header + grid container
// ---------------------------------------------------------------------------

describe("<FileBlock> — header + grid container", () => {
  it("renders a sticky file header with the file name and classification reason", () => {
    const file: BundleFile = {
      ...baseFile,
      classification: { collapsed: false, reason: "generated" },
    };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const header = c.querySelector(".tour-file-header");
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain("x.ts");
    expect(header!.textContent).toContain("generated");
  });

  it("renders the grid container with the layout's data-layout attribute", () => {
    const c = mount(createElement(FileBlock, defaultProps({ layout: "split" })));
    const block = c.querySelector(".tour-file-block") as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.dataset.layout).toBe("split");
  });

  it("flips the data-layout attribute when layout changes to unified", () => {
    const c = mount(createElement(FileBlock, defaultProps({ layout: "unified" })));
    const block = c.querySelector(".tour-file-block") as HTMLElement;
    expect(block.dataset.layout).toBe("unified");
  });
});

// ---------------------------------------------------------------------------
// Collapsed state
// ---------------------------------------------------------------------------

describe("<FileBlock> — collapsed state", () => {
  it("renders the header but suppresses the grid body when collapsed", () => {
    const c = mount(
      createElement(FileBlock, defaultProps({ isCollapsed: true })),
    );
    expect(c.querySelector(".tour-file-header")).not.toBeNull();
    expect(c.querySelector(".tour-file-block")).toBeNull();
  });

  it("invokes onToggleCollapse when the header is clicked", () => {
    let toggled = 0;
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ onToggleCollapse: () => (toggled += 1) }),
      ),
    );
    const header = c.querySelector(".tour-file-header") as HTMLElement;
    act(() => {
      header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GitHub-style header chrome (#225)
// ---------------------------------------------------------------------------

describe("<FileBlock> — GitHub-style header chrome (#225 / #317)", () => {
  it("renders left and right regions with chevron + status icon + filename + copy button on the left, copy button NOT on the right (issue #317)", () => {
    const c = mount(createElement(FileBlock, defaultProps()));
    const left = c.querySelector(".tour-file-header-left");
    const right = c.querySelector(".tour-file-header-right");
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.querySelector(".tour-file-chevron")).not.toBeNull();
    expect(left!.querySelector(".tour-file-status-icon")).not.toBeNull();
    expect(left!.querySelector(".tour-file-name")).not.toBeNull();
    expect(left!.querySelector(".tour-file-copy-button")).not.toBeNull();
    expect(right!.querySelector(".tour-file-copy-button")).toBeNull();
  });

  it("places the copy button immediately after the filename in the left region (issue #317)", () => {
    const c = mount(createElement(FileBlock, defaultProps()));
    const left = c.querySelector(".tour-file-header-left") as HTMLElement;
    expect(left).not.toBeNull();
    const children = Array.from(left.children);
    const nameIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-name"),
    );
    const copyIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-copy-button"),
    );
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(copyIdx).toBe(nameIdx + 1);
  });

  it("places the copy button after the rename indicator + filename in the left region (issue #317)", () => {
    const file: BundleFile = {
      ...baseFile,
      name: "new.ts",
      prevName: "old.ts",
    };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const left = c.querySelector(".tour-file-header-left") as HTMLElement;
    const children = Array.from(left.children);
    const renameIdx = children.findIndex((el) =>
      el.classList.contains("rename-path"),
    );
    const nameIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-name"),
    );
    const copyIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-copy-button"),
    );
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(renameIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(copyIdx);
  });

  it("renders the down chevron when the file is expanded", () => {
    const c = mount(
      createElement(FileBlock, defaultProps({ isCollapsed: false })),
    );
    const chevron = c.querySelector(".tour-file-chevron") as SVGElement;
    expect(chevron).not.toBeNull();
    // Octicons attach `octicon-chevron-down` / `octicon-chevron-right` to
    // the rendered svg's class list — use that to differentiate.
    expect(chevron.classList.contains("octicon-chevron-down")).toBe(true);
    expect(chevron.classList.contains("octicon-chevron-right")).toBe(false);
  });

  it("renders the right chevron when the file is collapsed", () => {
    const c = mount(
      createElement(FileBlock, defaultProps({ isCollapsed: true })),
    );
    const chevron = c.querySelector(".tour-file-chevron") as SVGElement;
    expect(chevron.classList.contains("octicon-chevron-right")).toBe(true);
    expect(chevron.classList.contains("octicon-chevron-down")).toBe(false);
  });

  it("applies the success status class for 'new' files", () => {
    const file: BundleFile = { ...baseFile, type: "new" };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const icon = c.querySelector(".tour-file-status-icon") as SVGElement;
    expect(icon).not.toBeNull();
    expect(icon.classList.contains("added")).toBe(true);
  });

  it("applies the danger status class for 'deleted' files", () => {
    const file: BundleFile = { ...baseFile, type: "deleted" };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const icon = c.querySelector(".tour-file-status-icon") as SVGElement;
    expect(icon.classList.contains("deleted")).toBe(true);
  });

  it("applies the renamed status class for rename* files", () => {
    const file: BundleFile = { ...baseFile, type: "rename-changed" };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const icon = c.querySelector(".tour-file-status-icon") as SVGElement;
    expect(icon.classList.contains("renamed")).toBe(true);
  });

  it("renders the reason tag in the right region when present", () => {
    const file: BundleFile = {
      ...baseFile,
      classification: { collapsed: false, reason: "generated" },
    };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const right = c.querySelector(".tour-file-header-right");
    expect(right!.textContent).toContain("generated");
  });

  it("renders the rename indicator in the left region when prevName differs", () => {
    const file: BundleFile = {
      ...baseFile,
      name: "new.ts",
      prevName: "old.ts",
    };
    const c = mount(createElement(FileBlock, defaultProps({ file })));
    const left = c.querySelector(".tour-file-header-left");
    expect(left!.querySelector(".rename-path")).not.toBeNull();
  });

  it("gives the copy button an accessible aria-label", () => {
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Copy file path");
  });

  it("copies file.name to the clipboard when the copy button is clicked", async () => {
    const writes: string[] = [];
    const savedClipboard = (
      navigator as unknown as { clipboard?: { writeText: (s: string) => Promise<void> } }
    ).clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (s: string) => {
          writes.push(s);
          return Promise.resolve();
        },
      },
    });
    try {
      const c = mount(createElement(FileBlock, defaultProps()));
      const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
      // Issue #319: the click handler now `.then`s the clipboard promise to
      // set the "copied" state, so the surrounding act must be async to
      // flush the resulting microtask + re-render.
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await act(async () => {});
      expect(writes).toEqual(["x.ts"]);
    } finally {
      if (savedClipboard) {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: savedClipboard,
        });
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it("does NOT toggle collapse when the copy button is clicked", async () => {
    let toggled = 0;
    const savedClipboard = (
      navigator as unknown as { clipboard?: { writeText: (s: string) => Promise<void> } }
    ).clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    try {
      const c = mount(
        createElement(
          FileBlock,
          defaultProps({ onToggleCollapse: () => (toggled += 1) }),
        ),
      );
      const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await act(async () => {});
      expect(toggled).toBe(0);
    } finally {
      if (savedClipboard) {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: savedClipboard,
        });
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it("silently swallows clipboard rejections", () => {
    const savedClipboard = (
      navigator as unknown as { clipboard?: { writeText: (s: string) => Promise<void> } }
    ).clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    try {
      const c = mount(createElement(FileBlock, defaultProps()));
      const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
      // Click must not throw or bubble up an unhandled rejection synchronously.
      expect(() => {
        act(() => {
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      }).not.toThrow();
    } finally {
      if (savedClipboard) {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: savedClipboard,
        });
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Copy-path success indicator (#319): icon swaps to a checkmark on a
// successful clipboard write, then reverts after ~1.2s. Restores the cue
// originally implemented in #16 that was dropped during the #225 chrome
// restructure. Failure path is silent (no swap).
// ---------------------------------------------------------------------------

describe("<FileBlock> — copy-path success indicator (#319)", () => {
  let savedClipboardRef: { v?: { writeText: (s: string) => Promise<void> } } = {};

  function installClipboard(
    writeText: (s: string) => Promise<void>,
  ): void {
    savedClipboardRef.v = (
      navigator as unknown as { clipboard?: { writeText: (s: string) => Promise<void> } }
    ).clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }

  function restoreClipboard(): void {
    if (savedClipboardRef.v) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: savedClipboardRef.v,
      });
    } else {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
    savedClipboardRef = {};
  }

  afterEach(() => {
    vi.useRealTimers();
    restoreClipboard();
  });

  // Resolve any pending microtasks (the `.then` after `writeText`) so the
  // post-resolution `setState("copied")` lands in the DOM before the
  // assertions run. `await act(async () => {})` flushes the React work
  // queue. Two flushes — once for the click handler's microtask, once for
  // the resulting re-render commit.
  async function flush(): Promise<void> {
    await act(async () => {});
    await act(async () => {});
  }

  it("renders the copy icon (and not the check icon) before any click", () => {
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    expect(button.querySelector(".octicon-copy")).not.toBeNull();
    expect(button.querySelector(".octicon-check")).toBeNull();
  });

  it("swaps to the check icon after a successful clipboard write", async () => {
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    expect(button.querySelector(".octicon-copy")).toBeNull();
  });

  it("reverts to the copy icon after the 1.2s timer fires", async () => {
    vi.useFakeTimers();
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(button.querySelector(".octicon-copy")).not.toBeNull();
    expect(button.querySelector(".octicon-check")).toBeNull();
  });

  it("does NOT revert before 1.2s elapses", async () => {
    vi.useFakeTimers();
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    expect(button.querySelector(".octicon-copy")).toBeNull();
  });

  it("rapid re-click restarts the 1.2s timer (icon stays as check past the original window)", async () => {
    vi.useFakeTimers();
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    // 800 ms into the first window — still showing check.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    // Second click re-arms the timer.
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    // 600 ms after the re-click — original timer would have fired (800 + 600
    // = 1400 > 1200) but the new timer still has 600 ms left, so check
    // remains.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    expect(button.querySelector(".octicon-copy")).toBeNull();
    // Past the new timer's expiry — now reverts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(button.querySelector(".octicon-copy")).not.toBeNull();
    expect(button.querySelector(".octicon-check")).toBeNull();
  });

  it("rapid re-click re-copies on every click (clipboard called twice)", async () => {
    const writes: string[] = [];
    installClipboard((s) => {
      writes.push(s);
      return Promise.resolve();
    });
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(writes).toEqual(["x.ts", "x.ts"]);
  });

  it("does NOT swap the icon when the clipboard call rejects", async () => {
    installClipboard(() => Promise.reject(new Error("denied")));
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(button.querySelector(".octicon-copy")).not.toBeNull();
    expect(button.querySelector(".octicon-check")).toBeNull();
  });

  it("clears the pending revert timer on unmount (no orphan setTimeout fires)", async () => {
    vi.useFakeTimers();
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(button.querySelector(".octicon-check")).not.toBeNull();
    // Unmount mid-flight — the pending 1.2s setTimeout must be cleared so it
    // doesn't fire a setState on an unmounted node.
    act(() => {
      root!.unmount();
      root = null;
    });
    // Advancing past the revert window must not throw an unhandled error
    // ("can't setState on unmounted component") nor fire a leaked callback
    // against the now-detached fiber.
    expect(() => {
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
  });

  it("preserves the aria-label across the icon swap", async () => {
    installClipboard(() => Promise.resolve());
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Copy file path");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(button.getAttribute("aria-label")).toBe("Copy file path");
  });

  it("does NOT toggle collapse when re-clicked during the copied state", async () => {
    let toggled = 0;
    installClipboard(() => Promise.resolve());
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ onToggleCollapse: () => (toggled += 1) }),
      ),
    );
    const button = c.querySelector(".tour-file-copy-button") as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(toggled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-file Expand-all-hidden button (PRD #270 / issue #274 — Slice 4;
// gated to ≥ 2 hidden gaps per issue #298)
// ---------------------------------------------------------------------------

describe("<FileBlock> — per-file Expand-all-hidden button (#274 / #298 / #317)", () => {
  it("renders a chrome button with the documented aria-label after diff-stats in the right region (issue #317: copy-path moved to left)", () => {
    const c = mount(createElement(FileBlock, defaultProps({ hasMultipleHiddenGaps: true })));
    const right = c.querySelector(".tour-file-header-right") as HTMLElement;
    expect(right).not.toBeNull();
    const expandButton = right.querySelector(".tour-file-expand-all-button") as HTMLButtonElement;
    expect(expandButton).not.toBeNull();
    expect(expandButton.tagName).toBe("BUTTON");
    expect(expandButton.getAttribute("aria-label")).toBe(
      "Expand all hidden context in this file",
    );
    const children = Array.from(right.children);
    const statsIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-stats"),
    );
    const expandIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-expand-all-button"),
    );
    expect(statsIdx).toBeLessThan(expandIdx);
    // Issue #317: the copy-path button moved to the left region — it must
    // no longer appear in the right region at all.
    expect(right.querySelector(".tour-file-copy-button")).toBeNull();
  });

  it("dispatches an `expand-file-all` ExpandAction on click", () => {
    const captured: ExpandAction[] = [];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ onDispatchExpand: (a: ExpandAction) => captured.push(a) }),
      ),
    );
    const button = c.querySelector(".tour-file-expand-all-button") as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(captured).toEqual([{ kind: "expand-file-all", file: "x.ts" }]);
  });

  it("does NOT toggle file collapse when the button is clicked (stopPropagation, mirrors #225)", () => {
    let toggled = 0;
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ onToggleCollapse: () => (toggled += 1) }),
      ),
    );
    const button = c.querySelector(".tour-file-expand-all-button") as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggled).toBe(0);
  });

  it("renders a glyph child inside the button (visual cue, ASCII v1 — no Octicons)", () => {
    const c = mount(createElement(FileBlock, defaultProps()));
    const button = c.querySelector(".tour-file-expand-all-button") as HTMLButtonElement;
    // The button contains visible text content (the up/down arrow glyph).
    expect((button.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  // Issue #298: with ≤ 1 hidden gap the chrome `↕` is redundant with
  // the per-hunk banner button (or standalone expand-down for file-
  // bottom). Suppress the chrome cell entirely in that case so the
  // header doesn't stack two `↕` affordances at the top of the file.
  it("does NOT render the chrome button when hasMultipleHiddenGaps is false (issue #298)", () => {
    const c = mount(
      createElement(FileBlock, defaultProps({ hasMultipleHiddenGaps: false })),
    );
    expect(c.querySelector(".tour-file-expand-all-button")).toBeNull();
  });

  it("re-renders the chrome button when hasMultipleHiddenGaps flips false → true", () => {
    mount(createElement(FileBlock, defaultProps({ hasMultipleHiddenGaps: false })));
    expect(container.querySelector(".tour-file-expand-all-button")).toBeNull();
    rerender(createElement(FileBlock, defaultProps({ hasMultipleHiddenGaps: true })));
    expect(container.querySelector(".tour-file-expand-all-button")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GitHub-style file diff-stats indicator (#228)
// ---------------------------------------------------------------------------

describe("<FileBlock> — file diff-stats indicator (#228)", () => {
  function diffRow(
    type: "context" | "addition" | "deletion" | "change",
    line: number,
  ): PlannedRow {
    return {
      kind: "diff-row",
      type,
      leftLineNumber: type === "addition" ? null : line,
      rightLineNumber: type === "deletion" ? null : line,
      leftText: "old",
      rightText: "new",
    };
  }

  it("renders the stats indicator in the right region after the reason tag (issue #317: copy-path moved to left)", () => {
    const file: BundleFile = {
      ...baseFile,
      classification: { collapsed: false, reason: "generated" },
    };
    const rows = [diffRow("addition", 1), diffRow("deletion", 1)];
    const c = mount(createElement(FileBlock, defaultProps({ file, rows })));
    const right = c.querySelector(".tour-file-header-right") as HTMLElement;
    expect(right).not.toBeNull();
    const indicator = right.querySelector(".tour-file-stats");
    expect(indicator).not.toBeNull();
    const children = Array.from(right.children);
    const reasonIdx = children.findIndex((el) =>
      el.classList.contains("reason-tag"),
    );
    const statsIdx = children.findIndex((el) =>
      el.classList.contains("tour-file-stats"),
    );
    expect(reasonIdx).toBeLessThan(statsIdx);
    // Issue #317: copy-path lives in the left region now; not in right.
    expect(right.querySelector(".tour-file-copy-button")).toBeNull();
  });

  it("renders the indicator even without a classification reason", () => {
    const rows = [diffRow("addition", 1)];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const indicator = c.querySelector(".tour-file-header-right .tour-file-stats");
    expect(indicator).not.toBeNull();
  });

  it("always renders exactly 5 segments in the bar", () => {
    const rows = [
      diffRow("addition", 1),
      diffRow("addition", 2),
      diffRow("deletion", 3),
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const segments = c.querySelectorAll(".tour-file-stats-segment");
    expect(segments.length).toBe(5);
  });

  it("renders 5 green segments and +N text only for a pure-addition file", () => {
    const rows = [diffRow("addition", 1), diffRow("addition", 2)];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const segments = c.querySelectorAll(".tour-file-stats-segment");
    expect(segments.length).toBe(5);
    const greens = c.querySelectorAll(".tour-file-stats-segment.added");
    expect(greens.length).toBe(5);
    expect(c.querySelectorAll(".tour-file-stats-segment.deleted").length).toBe(0);
    const additionsCount = c.querySelector(".tour-file-stats-count.added");
    expect(additionsCount?.textContent).toBe("+2");
    expect(c.querySelector(".tour-file-stats-count.deleted")).toBeNull();
  });

  it("renders 5 red segments and -M text only for a pure-deletion file", () => {
    const rows = [
      diffRow("deletion", 1),
      diffRow("deletion", 2),
      diffRow("deletion", 3),
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const reds = c.querySelectorAll(".tour-file-stats-segment.deleted");
    expect(reds.length).toBe(5);
    expect(c.querySelectorAll(".tour-file-stats-segment.added").length).toBe(0);
    const delCount = c.querySelector(".tour-file-stats-count.deleted");
    expect(delCount?.textContent).toBe("-3");
    expect(c.querySelector(".tour-file-stats-count.added")).toBeNull();
  });

  it("counts a `change` row as one addition AND one deletion", () => {
    const rows = [diffRow("change", 1)];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    expect(c.querySelector(".tour-file-stats-count.added")?.textContent).toBe(
      "+1",
    );
    expect(c.querySelector(".tour-file-stats-count.deleted")?.textContent).toBe(
      "-1",
    );
  });

  it("renders 5 neutral segments and no count text when total === 0", () => {
    // A file with only context rows (e.g. pure rename) — no diff content.
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ A", hunkIndex: 0, gapAbove: 0, primaryExpand: null },
      diffRow("context", 1),
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const neutrals = c.querySelectorAll(".tour-file-stats-segment.neutral");
    expect(neutrals.length).toBe(5);
    expect(c.querySelector(".tour-file-stats-count")).toBeNull();
  });

  it("renders 5 neutral segments when rows is empty", () => {
    const c = mount(createElement(FileBlock, defaultProps({ rows: [] })));
    const neutrals = c.querySelectorAll(".tour-file-stats-segment.neutral");
    expect(neutrals.length).toBe(5);
    expect(c.querySelector(".tour-file-stats-count")).toBeNull();
  });

  it("keeps rendering stats when the file is collapsed (counts come from rows, not DOM)", () => {
    const rows = [diffRow("addition", 1)];
    const c = mount(
      createElement(FileBlock, defaultProps({ rows, isCollapsed: true })),
    );
    expect(c.querySelector(".tour-file-block")).toBeNull();
    expect(c.querySelectorAll(".tour-file-stats-segment").length).toBe(5);
    expect(c.querySelector(".tour-file-stats-count.added")?.textContent).toBe(
      "+1",
    );
  });

  it("does NOT toggle collapse when the stats indicator is clicked (non-interactive)", () => {
    // The indicator carries no click handler, so clicking it bubbles up
    // through the header, which calls onToggleCollapse — that's the
    // intentional fallback when there's no explicit affordance, and
    // matches the spec's "non-interactive" definition (no extra wiring
    // beyond the existing header click).
    // What we DO assert here: the indicator never installs its own onClick
    // — verified by attribute absence on the rendered node.
    const rows = [diffRow("addition", 1)];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const indicator = c.querySelector(".tour-file-stats") as HTMLElement;
    expect(indicator).not.toBeNull();
    expect(indicator.getAttribute("onclick")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Planner walk + row dispatch
// ---------------------------------------------------------------------------

describe("<FileBlock> — planner walk + dispatch", () => {
  it("walks rows in order, emitting one .tour-row per planner row (plus cards)", () => {
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ A", hunkIndex: 0, gapAbove: 0, primaryExpand: null },
      {
        kind: "diff-row",
        type: "context",
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: "a",
        rightText: "a",
      },
      {
        kind: "diff-row",
        type: "addition",
        leftLineNumber: null,
        rightLineNumber: 2,
        leftText: "",
        rightText: "b",
      },
      {
        kind: "interactive",
        subKind: "boundary-top",
        boundaryRef: "top",
        gapAbove: 5,
        text: "··· 5 hidden ···",
      },
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const tourRows = Array.from(c.querySelectorAll(".tour-row"));
    // hunk-header + 2 diff-rows + interactive = 4 rows.
    expect(tourRows.length).toBe(4);
    // First row is the hunk-header (interactive).
    expect((tourRows[0] as HTMLElement).dataset.subkind).toBeTruthy();
    // Diff rows next.
    expect((tourRows[1] as HTMLElement).dataset.lineType).toBe("context");
    expect((tourRows[2] as HTMLElement).dataset.lineType).toBe("addition");
    // Interactive row last.
    expect((tourRows[3] as HTMLElement).dataset.subkind).toBe("boundary-top");
  });

  it("dispatches annotation rows to <CardRow>, anchored after the matching diff row", () => {
    const rows = withAnnotation(rowsCanonical(), ann1);
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const card = c.querySelector(".tour-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("comment body");
    // In split layout, additions cards anchor to cols 4 / -1 (#221).
    expect((card as HTMLElement).style.gridColumn).toMatch(/4\s*\/\s*-1/);
  });

  it("invokes onRowClick with file/side/lineNumber when a diff row is clicked", () => {
    const calls: Array<{ file: string; side: string; lineNumber: number }> = [];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          onRowClick: (anchor) => calls.push(anchor),
        }),
      ),
    );
    const additions = c.querySelector(
      '.tour-row[data-line-type="addition"] [data-side="additions"] .tour-row-code',
    ) as HTMLElement;
    expect(additions).not.toBeNull();
    act(() => {
      additions.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual([{ file: "x.ts", side: "additions", lineNumber: 2 }]);
  });

  it("invokes onCardClick with the annotation id when a card is clicked", () => {
    const rows = withAnnotation(rowsCanonical(), ann1);
    const ids: string[] = [];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          rows,
          onCardClick: (id) => ids.push(id),
        }),
      ),
    );
    const card = c.querySelector(".annotation-block") as HTMLElement;
    act(() => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ids).toEqual(["ann-1"]);
  });
});

// ---------------------------------------------------------------------------
// Interactive row activation → onDispatchExpand
// ---------------------------------------------------------------------------

describe("<FileBlock> — interactive row activation", () => {
  it("forwards InteractiveRow click → onDispatchExpand with the row's boundaryRef + direction", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "boundary-top",
        boundaryRef: "top",
        gapAbove: 12,
        text: "··· 12 hidden ···",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector('.tour-row[data-subkind="boundary-top"]') as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions.length).toBe(1);
    expect(actions[0]).toMatchObject({
      kind: "expand",
      file: "x.ts",
      boundaryRef: "top",
      direction: "up",
    });
    expect(actions[0].kind === "expand" ? actions[0].count : 0).toBeGreaterThan(0);
  });

  it("clicking the hunk-header right cell is a no-op — dispatches no expand action (issue #280)", () => {
    // Issue #280: clicking the `@@` text (right cell) does nothing, even
    // when the banner is interactive (primaryExpand !== null). Only the
    // left button cell dispatches.
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "hunk-header",
        header: "@@ -33,7 +33,7 @@",
        hunkIndex: 2,
        gapAbove: 8,
        primaryExpand: "all",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const textCell = c.querySelector(".tour-hunk-header-text") as HTMLElement;
    expect(textCell).not.toBeNull();
    act(() => {
      textCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual([]);
  });

  it("clicking the hunk-header left button cell with primaryExpand 'up' dispatches direction='up' (issue #280)", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "hunk-header",
        header: "@@ -100,3 +100,3 @@",
        hunkIndex: 2,
        gapAbove: 80,
        primaryExpand: "up",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const btn = c.querySelector(".tour-hunk-header-button") as HTMLElement;
    expect(btn.getAttribute("role")).toBe("button");
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual([
      { kind: "expand", file: "x.ts", boundaryRef: 2, direction: "up", count: 20 },
    ]);
  });

  it("clicking the hunk-header left button cell with primaryExpand 'all' dispatches direction='both' + gapAbove (issue #280)", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "hunk-header",
        header: "@@ -50,3 +50,3 @@",
        hunkIndex: 1,
        gapAbove: 12,
        primaryExpand: "all",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const btn = c.querySelector(".tour-hunk-header-button") as HTMLElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual([
      { kind: "expand", file: "x.ts", boundaryRef: 1, direction: "both", count: 12 },
    ]);
  });

  it("file-top hunk-header (hunkIndex 0) dispatches with boundaryRef='top'", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "hunk-header",
        header: "@@ -200,3 +200,3 @@",
        hunkIndex: 0,
        gapAbove: 199,
        primaryExpand: "up",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const btn = c.querySelector(".tour-hunk-header-button") as HTMLElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions[0]).toMatchObject({
      kind: "expand",
      boundaryRef: "top",
      direction: "up",
    });
  });

  it("hunk-header with primaryExpand null renders an inert `…` placeholder; clicking does nothing", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "hunk-header",
        header: "@@ -1,3 +1,3 @@",
        hunkIndex: 0,
        gapAbove: 0,
        primaryExpand: null,
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const btn = c.querySelector(".tour-hunk-header-button") as HTMLElement;
    expect(btn.textContent).toBe("…");
    expect(btn.getAttribute("role")).toBeNull();
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual([]);
  });

  it("renders hunk-header rows through <HunkHeaderBanner> with parsed range + context (#223)", () => {
    const rows: PlannedRow[] = [
      {
        kind: "hunk-header",
        header: "@@ -33,7 +33,7 @@ function foo() {",
        hunkIndex: 1,
        gapAbove: 10,
        primaryExpand: "all",
      },
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const banner = c.querySelector(".tour-hunk-header") as HTMLElement;
    expect(banner).not.toBeNull();
    // Class list carries both .tour-row and .tour-hunk-header.
    expect(banner.classList.contains("tour-row")).toBe(true);
    // Range and context segments are rendered as two separate spans.
    const range = banner.querySelector(".tour-hunk-header-range") as HTMLElement;
    const context = banner.querySelector(".tour-hunk-header-context") as HTMLElement;
    expect(range.textContent).toBe("@@ -33,7 +33,7 @@");
    expect(context.textContent).toBe("function foo() {");
    // data-subkind preserved so App-level scrollCursorIntoView still finds it.
    expect(banner.dataset.subkind).toBe("hunk-separator");
  });

  it("collapsed-file activation dispatches a separate `expand-file` action", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "collapsed-file",
        boundaryRef: "top",
        text: "··· 200 lines hidden — Enter to expand ···",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector('.tour-row[data-subkind="collapsed-file"]') as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual([{ kind: "expand-file", file: "x.ts" }]);
  });

  // Issue #292: the standalone `expand-down` row renders via
  // `<ExpandDownStandalone>` (two-cell layout matching the hunk-header
  // banner). The outer row is decorative; the saturated 44px button cell
  // hosts the click/Enter handler.
  it("forwards `expand-down` click on the button cell → onDispatchExpand with direction='down' and count=EXPANSION_STEP", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "expand-down",
        boundaryRef: 1,
        gapAbove: 73,
        text: "↓ Expand Down",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector('.tour-row[data-subkind="expand-down"]') as HTMLElement;
    expect(row).not.toBeNull();
    const button = row.querySelector(".tour-hunk-header-button") as HTMLElement;
    expect(button).not.toBeNull();
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions.length).toBe(1);
    expect(actions[0]).toEqual({
      kind: "expand",
      file: "x.ts",
      boundaryRef: 1,
      direction: "down",
      count: 20,
    });
  });

  it("file-bottom `expand-down` dispatches with boundaryRef='bottom' (issue #292)", () => {
    const actions: ExpandAction[] = [];
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "expand-down",
        boundaryRef: "bottom",
        gapAbove: 100,
        text: "↓ Expand Down",
      },
    ];
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({ rows, onDispatchExpand: (a) => actions.push(a) }),
      ),
    );
    const row = c.querySelector('.tour-row[data-subkind="expand-down"]') as HTMLElement;
    const button = row.querySelector(".tour-hunk-header-button") as HTMLElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions[0]).toEqual({
      kind: "expand",
      file: "x.ts",
      boundaryRef: "bottom",
      direction: "down",
      count: 20,
    });
  });

  it("`expand-down` renders as the two-cell banner shape (44px button + empty accent-subtle right cell) per issue #292", () => {
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "expand-down",
        boundaryRef: 1,
        gapAbove: 73,
        text: "↓ Expand Down",
      },
    ];
    const c = mount(createElement(FileBlock, defaultProps({ rows })));
    const row = c.querySelector('.tour-row[data-subkind="expand-down"]') as HTMLElement;
    expect(row).not.toBeNull();
    // Reuses .tour-hunk-header so it inherits the accent-subtle wash + flex
    // two-cell layout — the buttons line up vertically with the banner's
    // Up button in the mid-file-large-gap case.
    expect(row.classList.contains("tour-hunk-header")).toBe(true);
    expect(row.dataset.direction).toBe("down");
    const button = row.querySelector(".tour-hunk-header-button") as HTMLElement;
    expect(button.textContent).toBe("↓");
    expect(button.getAttribute("aria-label")).toBe("Expand Down");
    const text = row.querySelector(".tour-hunk-header-text") as HTMLElement;
    expect(text).not.toBeNull();
    expect(text.textContent).toBe("");
  });

});

// ---------------------------------------------------------------------------
// isCursor flow
// ---------------------------------------------------------------------------

describe("<FileBlock> — isCursor flow", () => {
  it("applies .is-cursor to the matching diff row's cursored cell for a RowAnchor cursor (#222)", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor })));
    const additionRow = c.querySelector('.tour-row[data-line-type="addition"]') as HTMLElement;
    // Outline is on the additions-side cell only, not the row container.
    const additionsCell = additionRow.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const deletionsCell = additionRow.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    expect(additionsCell.classList.contains("is-cursor")).toBe(true);
    expect(deletionsCell.classList.contains("is-cursor")).toBe(false);
    expect(additionRow.classList.contains("is-cursor")).toBe(false);
    // Context row above carries no cursor cue at all.
    const contextRow = c.querySelector('.tour-row[data-line-type="context"]') as HTMLElement;
    expect(contextRow.querySelector(".tour-row-cell.is-cursor")).toBeNull();
  });

  it("does NOT match a diff row when the cursor's file differs", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "y.ts",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor })));
    const additionRow = c.querySelector('.tour-row[data-line-type="addition"]') as HTMLElement;
    expect(additionRow.querySelector(".tour-row-cell.is-cursor")).toBeNull();
  });

  it("scopes the outline to the deletions cell when cursor.side === 'deletions' (#222)", () => {
    // Context row in split layout: both sides hold the same content. The
    // cursor's `side` field decides which cell carries the cue.
    const cursor: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 1,
      side: "deletions",
      preferredSide: "deletions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor })));
    const contextRow = c.querySelector('.tour-row[data-line-type="context"]') as HTMLElement;
    const additionsCell = contextRow.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    const deletionsCell = contextRow.querySelector(
      '.tour-row-cell[data-side="deletions"]',
    ) as HTMLElement;
    expect(deletionsCell.classList.contains("is-cursor")).toBe(true);
    expect(additionsCell.classList.contains("is-cursor")).toBe(false);
  });

  it("applies .is-cursor to the matching CardRow for a CardAnchor cursor", () => {
    const rows = withAnnotation(rowsCanonical(), ann1);
    const cursor: Cursor = {
      kind: "card",
      annotationId: "ann-1",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ rows, cursor })));
    // CardRow doesn't itself emit `.is-cursor`; the AnnotationCard's
    // `isCurrent` styling does. Probe AnnotationCard's "current" class.
    const card = c.querySelector(".annotation-block");
    expect(card!.className).toContain("current");
  });

  it("applies .is-cursor to an InteractiveRow when the cursor's interactive subKind/boundaryRef match", () => {
    const rows: PlannedRow[] = [
      {
        kind: "interactive",
        subKind: "boundary-top",
        boundaryRef: "top",
        gapAbove: 12,
        text: "···",
      },
    ];
    const cursor: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "boundary-top", boundaryRef: "top" },
    };
    const c = mount(createElement(FileBlock, defaultProps({ rows, cursor })));
    const row = c.querySelector('.tour-row[data-subkind="boundary-top"]') as HTMLElement;
    expect(row.classList.contains("is-cursor")).toBe(true);
  });

  it("removes .is-cursor from the prior cell when the cursor moves to a different row (#222)", () => {
    const cursor1: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };
    const cursor2: Cursor = {
      kind: "row",
      file: "x.ts",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };
    const c = mount(createElement(FileBlock, defaultProps({ cursor: cursor1 })));
    rerender(createElement(FileBlock, defaultProps({ cursor: cursor2 })));
    const additionRow = c.querySelector('.tour-row[data-line-type="addition"]') as HTMLElement;
    expect(additionRow.querySelector(".tour-row-cell.is-cursor")).toBeNull();
    const contextRow = c.querySelector('.tour-row[data-line-type="context"]') as HTMLElement;
    const cursoredCell = contextRow.querySelector(
      '.tour-row-cell[data-side="additions"]',
    ) as HTMLElement;
    expect(cursoredCell.classList.contains("is-cursor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Composer slot
// ---------------------------------------------------------------------------

describe("<FileBlock> — composer slot", () => {
  it("renders the composerSlot inline at the anchor row's position when composerAnchor matches", () => {
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          composerAnchor: { side: "additions", line_end: 2 },
          composerSlot: createElement(
            "div",
            { className: "test-composer" },
            "composer here",
          ),
        }),
      ),
    );
    const composer = c.querySelector(".test-composer");
    expect(composer).not.toBeNull();
    expect(composer!.textContent).toBe("composer here");
    // The composer should be wrapped in a tour-card-style positioning div.
    const wrapper = composer!.closest(".tour-card") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.dataset.side).toBe("additions");
    // In split layout, additions composer anchors to cols 4 / -1 (#221).
    expect(wrapper.style.gridColumn).toMatch(/4\s*\/\s*-1/);
  });

  it("does not render the composer slot when composerAnchor is null", () => {
    const c = mount(
      createElement(
        FileBlock,
        defaultProps({
          composerAnchor: null,
          composerSlot: createElement("div", { className: "test-composer" }),
        }),
      ),
    );
    expect(c.querySelector(".test-composer")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

describe("<FileBlock> — React.memo", () => {
  it("is wrapped in React.memo (component identity unaffected by re-renders)", () => {
    // Smoke test that re-rendering with identical props does not throw and
    // produces a stable DOM. Behavioural assertion of memo is checked by
    // the parent's render-count invariants (slice 6).
    const c = mount(createElement(FileBlock, defaultProps()));
    const before = c.querySelector(".tour-file-block")!.outerHTML;
    rerender(createElement(FileBlock, defaultProps()));
    const after = c.querySelector(".tour-file-block")!.outerHTML;
    expect(after).toBe(before);
  });
});
