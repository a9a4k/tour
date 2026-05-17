// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/client/App.js";

// App-level integration smoke test (Issue #235). The rest of the web suite
// covers pure helpers, row primitives, <FileBlock>, the reducer, and CSS
// emission in isolation — none of those layers mount the top-level <App>
// against a representative bundle. The #232↔#233 merge regression that
// motivated this test is a concrete example of what slips through that
// gap: the unit tests passed, `tsc --noEmit` was clean, and the live page
// rendered blank because App's first render threw on a missing import.
//
// This test mounts <App> once with a small bundle fixture, lets the mount
// effects settle (tour-list fetch, bundle fetch, reply-lock fetch), and
// asserts the major regions actually rendered: the tour title, a file
// header per file in the fixture, the tour-stats indicator, and at least
// one diff row. The regression assertion is implicit — the tour-stats
// indicator only renders when the `tourStats` useMemo runs without
// throwing, which exercises the `planRows(... { expansion: emptyExpansion(),
// ... })` call site that the merge regression broke.

let root: Root | null = null;
let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;
let savedIO: typeof IntersectionObserver | undefined;

const tourId = "2026-05-13-000000-integration-smoke";

const tourSummary = {
  id: tourId,
  title: "Integration smoke tour",
  status: "open" as const,
  created_at: "2026-05-13T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafebabe",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

// Two-file diff: src/foo.ts has a paired change (deletion + addition) +
// pure addition, src/bar.ts is pure additions. Each file has one hunk so
// the planner emits a hunk-header row + diff rows.
const diff = `diff --git a/src/foo.ts b/src/foo.ts
index 1..2 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 first line
-old line
+new line
+added line
diff --git a/src/bar.ts b/src/bar.ts
index 1..2 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,2 +1,3 @@
 line one
 line two
+added line
`;

const comment = {
  id: "ann-1",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 2,
  line_end: 2,
  body: "first comment",
  author: "human",
  author_kind: "human" as const,
  created_at: "2026-05-13T00:00:00Z",
};

const bundle = {
  kind: "ok" as const,
  tour: tourSummary,
  comments: [comment],
  diff,
  files: [
    {
      name: "src/foo.ts",
      type: "modified",
      hunks: [],
      // Non-empty old/newContent feeds the tourStats useMemo's planRows
      // call (the path broken by the #232↔#233 merge that motivated this
      // test).
      oldContent: "first line\nold line\n",
      newContent: "first line\nnew line\nadded line\n",
      classification: { collapsed: false },
      orphanWindows: [],
    },
    {
      name: "src/bar.ts",
      type: "modified",
      hunks: [],
      oldContent: "line one\nline two\n",
      newContent: "line one\nline two\nadded line\n",
      classification: { collapsed: false },
      orphanWindows: [],
    },
  ],
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';

  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    if (u.includes("/api/tours?")) {
      return Promise.resolve(
        new Response(JSON.stringify([tourSummary]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${tourId}`)) {
      return Promise.resolve(
        new Response(JSON.stringify(bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${tourId}/reply-lock`)) {
      return Promise.resolve(
        new Response(JSON.stringify(null), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;

  originalEventSource = globalThis.EventSource;
  class StubEventSource {
    onmessage: ((e: MessageEvent) => void) | null = null;
    close(): void {}
  }
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
    StubEventSource as unknown as typeof EventSource;

  // `useLazyHighlight` is a no-op (immediately visible) when
  // IntersectionObserver is absent — deleting it makes the row tokens
  // land synchronously so the `.tour-row` assertion doesn't race the
  // observer.
  savedIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;

  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  globalThis.fetch = originalFetch;
  if (originalEventSource === undefined) {
    delete (globalThis as Partial<typeof globalThis>).EventSource;
  } else {
    globalThis.EventSource = originalEventSource;
  }
  if (savedIO) {
    (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver = savedIO;
  }
  window.history.replaceState(null, "", "/");
});

async function flush(): Promise<void> {
  // Two microtask flushes: the bundle fetch resolves on the first, then
  // the reducer's `tour.switched` commit + downstream effects (orphan
  // windows seed, reply-lock fetch) settle on the second.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("App integration smoke (Issue #235)", () => {
  it("boots against a real bundle and renders the major regions", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    // #root has children — the React tree committed.
    expect(container.children.length).toBeGreaterThan(0);

    // Tour title from the bundle's tourMeta is in the rendered DOM.
    expect(document.body.textContent).toContain("Integration smoke tour");

    // One file header per file in the fixture.
    const fileHeaders = document.querySelectorAll(".tour-file-header");
    expect(fileHeaders.length).toBe(2);
    const headerText = Array.from(fileHeaders)
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(headerText).toContain("src/foo.ts");
    expect(headerText).toContain("src/bar.ts");

    // Tour-level diff-stats indicator is in the DOM (regression assertion
    // for the #232↔#233 merge — this path runs `planRows(... {
    // expansion: emptyExpansion(), ... })`).
    expect(document.querySelector(".tour-stats")).not.toBeNull();

    // At least one diff row rendered (proves the planner ran end-to-end
    // and the file blocks committed their bodies).
    const rows = document.querySelectorAll(".tour-row");
    expect(rows.length).toBeGreaterThan(0);
  });

  // Issue #277: tour-level diff-stats indicator leads the right cluster,
  // comment nav and layout toggle follow. The reorder aligns with
  // GitHub's PR header strip mental model — stats at the leading edge as a
  // navigational landmark, interactive controls grouped together after it.
  it("right cluster renders left-to-right: stats, nav pill, layout toggle (issue #277)", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const right = container.querySelector(".tour-header-right");
    expect(right).not.toBeNull();
    const directChildren = Array.from(right!.children) as HTMLElement[];
    // Three direct children — stats, sequence pill, layout toggle.
    // The stats indicator must be the first; the layout toggle the last.
    expect(directChildren.length).toBe(3);
    expect(directChildren[0]!.classList.contains("tour-stats")).toBe(true);
    expect(directChildren[1]!.classList.contains("sequence-pill")).toBe(true);
    expect(directChildren[2]!.classList.contains("layout-toggle")).toBe(true);
  });

  // Issue #323: the webapp sidebar now carries a drag-resize handle on
  // its right edge, and an auto-fit effect that runs once per tour
  // switch. The `<aside>` consumes its width from React state (inline
  // style) so the auto-fit / drag writes are visible on the DOM.
  it("renders the sidebar drag-resize handle and applies width via inline style (issue #323)", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const aside = container.querySelector<HTMLElement>(".app-sidebar");
    expect(aside).not.toBeNull();
    // Width is driven by React state — inline style wins over the
    // CSS fallback. Auto-fit has run (fixture has visible rows) so
    // the width is at least SIDEBAR_MIN_PX.
    const inlineWidth = aside!.style.width;
    expect(inlineWidth).toMatch(/\d+(\.\d+)?(px)?/);
    const parsed = parseFloat(inlineWidth);
    expect(parsed).toBeGreaterThanOrEqual(240);

    // The drag handle is mounted inside the sidebar.
    const handle = aside!.querySelector<HTMLElement>(".sidebar-resize-handle");
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("role")).toBe("separator");
    expect(handle!.getAttribute("aria-orientation")).toBe("vertical");
  });

  // Issue #308: the .tour-refs span used to render the user's typed
  // ref names (`${base_source} ← ${head_source}`). On a re-opened tour
  // those labels mis-read as "current main / current HEAD" — the fix
  // renders the stable 7-char short SHAs instead.
  it("header source pair renders as 7-char short SHAs, not ref names (issue #308)", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const refs = container.querySelector(".tour-refs");
    expect(refs).not.toBeNull();
    // Fixture SHAs are 8-char ("deadbeef" / "cafebabe"); the 7-char slice
    // gives "deadbee" / "cafebab".
    expect(refs!.textContent).toContain("cafebab ← deadbee");
    // The ref names must NOT leak — that would re-introduce the drift.
    expect(refs!.textContent).not.toContain("main");
    expect(refs!.textContent).not.toContain("feature/x");
  });
});

// Issue #304: web per-file Expand-all `↕` chrome stays visible when the
// file body is collapsed. The TUI's chrome already gates on
// `!collapsed`; the web didn't. The fixture below has a single file with
// two hunks separated by enough hidden context to yield ≥ 2 expandable
// gaps (file-top + mid-file + file-bottom = 3), so the chrome qualifies
// for the #298 `gapCount >= 2` gate. Clicking the file-header bar
// dispatches `folds.setOverride` (toggleCollapsed); the chrome must
// disappear in the same render and reappear on un-collapse.

const gapTourId = "2026-05-14-000000-collapse-gate";

const gapTourSummary = {
  id: gapTourId,
  title: "Collapse gate fixture",
  status: "open" as const,
  created_at: "2026-05-14T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafebabe",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

const gapDiff = `diff --git a/src/gap.ts b/src/gap.ts
index 1..2 100644
--- a/src/gap.ts
+++ b/src/gap.ts
@@ -5,3 +5,3 @@
 line 5
-old line 6
+new line 6
 line 7
@@ -25,3 +25,3 @@
 line 25
-old line 26
+new line 26
 line 27
`;

const gapNewContent =
  "line 1\nline 2\nline 3\nline 4\nline 5\nnew line 6\nline 7\nline 8\nline 9\n" +
  "line 10\nline 11\nline 12\nline 13\nline 14\nline 15\nline 16\nline 17\nline 18\n" +
  "line 19\nline 20\nline 21\nline 22\nline 23\nline 24\nline 25\nnew line 26\nline 27\n" +
  "line 28\nline 29\nline 30\n";

const gapOldContent =
  "line 1\nline 2\nline 3\nline 4\nline 5\nold line 6\nline 7\nline 8\nline 9\n" +
  "line 10\nline 11\nline 12\nline 13\nline 14\nline 15\nline 16\nline 17\nline 18\n" +
  "line 19\nline 20\nline 21\nline 22\nline 23\nline 24\nline 25\nold line 26\nline 27\n" +
  "line 28\nline 29\nline 30\n";

const gapBundle = {
  kind: "ok" as const,
  tour: gapTourSummary,
  comments: [],
  diff: gapDiff,
  files: [
    {
      name: "src/gap.ts",
      type: "modified",
      hunks: [],
      oldContent: gapOldContent,
      newContent: gapNewContent,
      classification: { collapsed: false },
      orphanWindows: [],
    },
  ],
};

describe("App per-file Expand-all chrome — collapse gate (Issue #304)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/tours?")) {
        return Promise.resolve(
          new Response(JSON.stringify([gapTourSummary]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${gapTourId}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(gapBundle), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${gapTourId}/reply-lock`)) {
        return Promise.resolve(
          new Response(JSON.stringify(null), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  it("hides the chrome `↕` button when the file body is collapsed and restores it on un-collapse", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: gapTourId }));
    });
    await flush();

    const header = container.querySelector(
      '.tour-file-outer[data-file="src/gap.ts"] .tour-file-header',
    ) as HTMLElement;
    expect(header).not.toBeNull();

    // Pre-collapse: file has ≥ 2 hidden gaps, so the chrome qualifies and
    // is visible.
    expect(
      header.querySelector(".tour-file-expand-all-button"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '.tour-file-outer[data-file="src/gap.ts"] .tour-file-block',
      ),
    ).not.toBeNull();

    // Collapse: click the file-header bar.
    await act(async () => {
      header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Body is gone (collapsed) AND chrome `↕` is gone in the same render.
    expect(
      container.querySelector(
        '.tour-file-outer[data-file="src/gap.ts"] .tour-file-block',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '.tour-file-outer[data-file="src/gap.ts"] .tour-file-expand-all-button',
      ),
    ).toBeNull();

    // Un-collapse: click again. Chrome reappears alongside the body.
    const headerAfter = container.querySelector(
      '.tour-file-outer[data-file="src/gap.ts"] .tour-file-header',
    ) as HTMLElement;
    await act(async () => {
      headerAfter.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector(
        '.tour-file-outer[data-file="src/gap.ts"] .tour-file-block',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '.tour-file-outer[data-file="src/gap.ts"] .tour-file-expand-all-button',
      ),
    ).not.toBeNull();
  });
});

// Issue #308: WIP-tour special case. The head SHA on a wip_snapshot tour
// is a synthetic working-tree commit the user can't `git show`; rendering
// its short SHA in the header would be misleading. The fix prints the
// literal word "WIP" on the head side; the base side still renders as a
// real short SHA. The discriminator is the `wip_snapshot` boolean —
// NOT a string match against `head_source === "WIP"`.

const wipTourId = "2026-05-14-000000-wip-header";

const wipTourSummary = {
  id: wipTourId,
  title: "WIP header fixture",
  status: "open" as const,
  created_at: "2026-05-14T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  base_sha: "cafebabecafebabecafebabecafebabecafebabe",
  // head_source is intentionally "HEAD" (a real ref the user might have
  // typed) — the WIP literal must come from wip_snapshot, not from
  // matching head_source against "WIP".
  head_source: "HEAD",
  base_source: "main",
  wip_snapshot: true,
};

const wipBundle = {
  kind: "ok" as const,
  tour: wipTourSummary,
  comments: [],
  diff: "",
  files: [],
};

describe("App header source pair — WIP tour (Issue #308)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/tours?")) {
        return Promise.resolve(
          new Response(JSON.stringify([wipTourSummary]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${wipTourId}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(wipBundle), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${wipTourId}/reply-lock`)) {
        return Promise.resolve(
          new Response(JSON.stringify(null), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  it("renders `<base[:7]> ← WIP` for a tour with wip_snapshot === true", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: wipTourId }));
    });
    await flush();

    const refs = container.querySelector(".tour-refs");
    expect(refs).not.toBeNull();
    expect(refs!.textContent).toContain("cafebab ← WIP");
    // The head SHA prefix is "deadbee"; it must NOT appear (the WIP
    // synthetic snapshot SHA is meaningless to a human and rendering it
    // would be the precise mis-cue the special case avoids).
    expect(refs!.textContent).not.toContain("deadbee");
    // Ref names must not leak either.
    expect(refs!.textContent).not.toContain("HEAD");
    expect(refs!.textContent).not.toContain("main");
  });
});

// Issue #313: sidebar click on a classifier-collapsed file is a navigation
// gesture, not an explicit-reveal — same rule as `j`/`k` after #310. The
// click scrolls the file into view, updates sidebar selection, and lands
// the cursor on the synthetic `··· N hidden — Enter to expand ···` row,
// but does NOT clear the classifier-collapse override. The synthetic row's
// Enter affordance is the explicit-reveal path.
// Fixture: a classifier-collapsed lockfile-style entry. Sidebar click pins
// the no-auto-expand rule; an Enter keydown after the click pins the
// explicit-reveal escape hatch.

const lockTourId = "2026-05-14-100000-sidebar-click-collapsed";

const lockTourSummary = {
  id: lockTourId,
  title: "Sidebar reveal on collapsed file",
  status: "open" as const,
  created_at: "2026-05-14T10:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafebabe",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

const lockDiff = `diff --git a/bun.lock b/bun.lock
index 1..2 100644
--- a/bun.lock
+++ b/bun.lock
@@ -1,1 +1,2 @@
 keep
+added
`;

const lockBundle = {
  kind: "ok" as const,
  tour: lockTourSummary,
  comments: [],
  diff: lockDiff,
  files: [
    {
      name: "bun.lock",
      type: "modified",
      hunks: [],
      oldContent: "keep\n",
      newContent: "keep\nadded\n",
      // Classifier-collapsed — planner emits the synthetic CollapsedFileRow
      // in place of the file's body unless the user explicitly reveals.
      classification: { collapsed: true, reason: "generated" },
      orphanWindows: [],
    },
  ],
};

describe("App sidebar click on a classifier-collapsed file (issue #313)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/tours?")) {
        return Promise.resolve(
          new Response(JSON.stringify([lockTourSummary]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${lockTourId}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(lockBundle), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${lockTourId}/reply-lock`)) {
        return Promise.resolve(
          new Response(JSON.stringify(null), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  it("clicking the sidebar file-entry for a classifier-collapsed file does NOT expand its body (#313); Enter on the cursored synthetic row still does", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: lockTourId }));
    });
    await flush();

    // Pre-click: file is classifier-collapsed — only the synthetic
    // `··· N lines hidden — Enter to expand ···` row renders for bun.lock.
    // The file's diff body (DiffRow children) is NOT present.
    const fileOuter = container.querySelector(
      '.tour-file-outer[data-file="bun.lock"]',
    );
    expect(fileOuter).not.toBeNull();
    const preNonInteractive = Array.from(
      fileOuter!.querySelectorAll(".tour-row"),
    ).filter((el) => !el.classList.contains("tour-row-interactive"));
    expect(preNonInteractive.length).toBe(0);

    // Find the sidebar row button. <FileRow> renders `<button.file-entry
    // title="bun.lock">`. Title is the path key — uniquely addressable.
    const sidebarEntry = container.querySelector(
      'button.file-entry[title="bun.lock"]',
    ) as HTMLButtonElement | null;
    expect(sidebarEntry).not.toBeNull();

    await act(async () => {
      sidebarEntry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    // Post-click: sidebar click is a navigation gesture — it must NOT
    // clear the classifier-collapse override. The file's diff body stays
    // hidden; only the synthetic CollapsedFileRow remains.
    const postFileOuter = container.querySelector(
      '.tour-file-outer[data-file="bun.lock"]',
    );
    expect(postFileOuter).not.toBeNull();
    const postNonInteractive = Array.from(
      postFileOuter!.querySelectorAll(".tour-row"),
    ).filter((el) => !el.classList.contains("tour-row-interactive"));
    expect(postNonInteractive.length).toBe(0);
    // The synthetic banner is still present (it's the cursor landing).
    const postInteractive = postFileOuter!.querySelectorAll(
      ".tour-row.tour-row-interactive",
    );
    expect(postInteractive.length).toBeGreaterThan(0);

    // Enter on the cursored collapsed-file synthetic row is the explicit-
    // reveal escape hatch (issue #280 / #306 / #310 wiring). Pressing Enter
    // dispatches `expansion.expandFile`, which materialises the diff body.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush();

    const afterEnterOuter = container.querySelector(
      '.tour-file-outer[data-file="bun.lock"]',
    );
    expect(afterEnterOuter).not.toBeNull();
    const afterEnterNonInteractive = Array.from(
      afterEnterOuter!.querySelectorAll(".tour-row"),
    ).filter((el) => !el.classList.contains("tour-row-interactive"));
    expect(afterEnterNonInteractive.length).toBeGreaterThan(0);
  });
});

// Issue #316: fold then unfold on a classifier-collapsed file must return
// to the classifier-default (synthetic-summary) view, not the full body.
// The fold-toggle's unfold direction is now `folds.clearOverride` (deletes
// the override entry), so `isClassifierCollapsed`'s fallback re-applies
// the classifier verdict. Folding (visible -> collapsed) is unchanged:
// `setOverride(true)`. Binary files keep `setOverride(false)` on unfold
// since their "collapsed" default is anchored in classification, not in
// the override map.

describe("App fold-unfold restores classifier-default (issue #316)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/tours?")) {
        return Promise.resolve(
          new Response(JSON.stringify([lockTourSummary]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${lockTourId}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(lockBundle), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (u.endsWith(`/api/tours/${lockTourId}/reply-lock`)) {
        return Promise.resolve(
          new Response(JSON.stringify(null), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  it("folding then unfolding a classifier-collapsed file returns to the synthetic-summary view (not the full body)", async () => {
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: lockTourId }));
    });
    await flush();

    const fileOuter = () =>
      container.querySelector('.tour-file-outer[data-file="bun.lock"]');
    const nonInteractiveRows = () =>
      Array.from(fileOuter()!.querySelectorAll(".tour-row")).filter(
        (el) => !el.classList.contains("tour-row-interactive"),
      );
    const interactiveRows = () =>
      fileOuter()!.querySelectorAll(".tour-row.tour-row-interactive");

    // Pre-fold (state A: override === undefined): classifier-collapsed —
    // synthetic row only, no body rows.
    expect(fileOuter()).not.toBeNull();
    expect(nonInteractiveRows().length).toBe(0);
    expect(interactiveRows().length).toBeGreaterThan(0);

    // Fold (A -> B): click the file-header bar. Body fully hidden,
    // synthetic row also gone (file-header only).
    const header = container.querySelector(
      '.tour-file-outer[data-file="bun.lock"] .tour-file-header',
    ) as HTMLElement;
    expect(header).not.toBeNull();
    await act(async () => {
      header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(nonInteractiveRows().length).toBe(0);
    expect(interactiveRows().length).toBe(0);

    // Unfold (B -> A, NOT C): click the file-header again. The override is
    // CLEARED, so `isClassifierCollapsed` falls back to the classifier
    // verdict — the synthetic row reappears, the diff body does NOT.
    const headerAfter = container.querySelector(
      '.tour-file-outer[data-file="bun.lock"] .tour-file-header',
    ) as HTMLElement;
    await act(async () => {
      headerAfter.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(nonInteractiveRows().length).toBe(0);
    expect(interactiveRows().length).toBeGreaterThan(0);
  });
});

// Issue #332: dynamic send-hint matrix at the App's footer call site.
// The fixture's first top-level comment is human-authored, so the
// bundle-load re-anchor (re-anchor-policy.ts) seats the cursor on a
// human card by default — the lock/agent/cursor permutations below
// then exercise each leg of the predicate without manual `j` walking.

const sendHintTourId = "2026-05-15-000000-footer-send-hint";

const sendHintTourSummary = {
  id: sendHintTourId,
  title: "Footer send-hint fixture",
  status: "open" as const,
  created_at: "2026-05-15T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafebabe",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

const sendHintDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 1..2 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,3 @@
 first line
-old line
+new line
+added line
`;

const humanComment = {
  id: "ann-human",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 2,
  line_end: 2,
  body: "human comment",
  author: "alice",
  author_kind: "human" as const,
  created_at: "2026-05-15T00:00:00Z",
};

const agentComment = {
  id: "ann-agent",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 3,
  line_end: 3,
  body: "agent comment",
  author: "claude",
  author_kind: "agent" as const,
  created_at: "2026-05-15T00:00:01Z",
};

const sendHintBundle = {
  kind: "ok" as const,
  tour: sendHintTourSummary,
  comments: [humanComment, agentComment],
  diff: sendHintDiff,
  files: [
    {
      name: "src/foo.ts",
      type: "modified",
      hunks: [],
      oldContent: "first line\nold line\n",
      newContent: "first line\nnew line\nadded line\n",
      classification: { collapsed: false },
      orphanWindows: [],
    },
  ],
};

function stubFetch(replyLock: unknown): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    if (u.includes("/api/tours?")) {
      return Promise.resolve(
        new Response(JSON.stringify([sendHintTourSummary]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${sendHintTourId}`)) {
      return Promise.resolve(
        new Response(JSON.stringify(sendHintBundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${sendHintTourId}/reply-lock`)) {
      return Promise.resolve(
        new Response(JSON.stringify(replyLock), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

describe("App footer dynamic send-hint (Issue #332)", () => {
  it("renders `R: request reply` when reply-agent is configured and cursor is on a human card (issue #390 relabel)", async () => {
    globalThis.fetch = stubFetch(null);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(App, {
          initialTourId: sendHintTourId,
          replyAgent: "claude",
        }),
      );
    });
    await flush();

    const footer = container.querySelector("footer.app-footer");
    expect(footer).not.toBeNull();
    // Issue #390 / ADR 0021 addendum: the hint label is `R: request reply`
    // (no agent name interpolated) — the agent name lives on the header
    // chip + button tooltip, not the legend.
    expect(footer!.textContent).toContain("R: request reply");
    expect(footer!.textContent).not.toContain("s: send to");
  });

  it("omits the send-hint segment when reply-agent is unset, even on a human card", async () => {
    globalThis.fetch = stubFetch(null);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(App, { initialTourId: sendHintTourId }),
      );
    });
    await flush();

    const footer = container.querySelector("footer.app-footer");
    expect(footer).not.toBeNull();
    expect(footer!.textContent).not.toContain("R: request reply");
    expect(footer!.textContent).not.toContain("send to");
  });

  it("omits the send-hint segment when the reply-lock is held tour-wide", async () => {
    globalThis.fetch = stubFetch({
      agent: "claude",
      tour_id: sendHintTourId,
      comment_id: "ann-human",
      acquired_at: "2026-05-15T00:00:02Z",
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(App, {
          initialTourId: sendHintTourId,
          replyAgent: "claude",
        }),
      );
    });
    await flush();

    const footer = container.querySelector("footer.app-footer");
    expect(footer).not.toBeNull();
    expect(footer!.textContent).not.toContain("R: request reply");
  });

  it("omits the send-hint segment when the cursor moves to an agent card", async () => {
    globalThis.fetch = stubFetch(null);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(App, {
          initialTourId: sendHintTourId,
          replyAgent: "claude",
        }),
      );
    });
    await flush();

    // Bundle-load re-anchor lands on the first top-level (human) — segment present.
    const footer = container.querySelector("footer.app-footer");
    expect(footer!.textContent).toContain("R: request reply");

    // `n` walks top-level forward — lands on the agent comment. Segment must drop.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", bubbles: true }),
      );
    });
    await flush();

    expect(footer!.textContent).not.toContain("R: request reply");
  });
});

const failTourId = "2026-05-15-000000-footer-fail-status";

const failTourSummary = {
  id: failTourId,
  title: "Failure status fixture",
  status: "open" as const,
  created_at: "2026-05-15T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafebabe",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

const failDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 1..2 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,3 @@
 first line
-old line
+new line
+added line
`;

const failHumanAnn = {
  id: "ann-human-fail",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 2,
  line_end: 2,
  body: "human comment",
  author: "alice",
  author_kind: "human" as const,
  created_at: "2026-05-15T00:00:00Z",
};

const failBundleWithAnn = {
  kind: "ok" as const,
  tour: failTourSummary,
  comments: [failHumanAnn],
  diff: failDiff,
  files: [
    {
      name: "src/foo.ts",
      type: "modified",
      hunks: [],
      oldContent: "first line\nold line\n",
      newContent: "first line\nnew line\nadded line\n",
      classification: { collapsed: false },
      orphanWindows: [],
    },
  ],
};

const failBundleEmpty = {
  ...failBundleWithAnn,
  comments: [],
};

interface FailFetchOpts {
  bundle: typeof failBundleWithAnn | typeof failBundleEmpty;
  postResponder: () => Promise<Response>;
}

function stubFailFetch(opts: FailFetchOpts): typeof fetch {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (u.includes("/api/tours?")) {
      return Promise.resolve(
        new Response(JSON.stringify([failTourSummary]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${failTourId}`) && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(opts.bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${failTourId}/reply-lock`)) {
      return Promise.resolve(
        new Response(JSON.stringify(null), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (
      u.endsWith(`/api/tours/${failTourId}/comments`) &&
      method === "POST"
    ) {
      return opts.postResponder();
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

// Set the textarea value through React's controlled-input contract.
// React monkey-patches the element-level value setter to track the
// "last seen" value; calling the prototype setter bypasses the track
// so the input-event listener treats the change as new and fires
// `onChange`.
function setTextareaValue(ta: HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(ta) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(ta, value);
  } else {
    ta.value = value;
  }
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("App comment-create failure status (Issue #334)", () => {
  it("non-2xx response on reply submit flashes `Reply failed: <reason>` in the footer status slot", async () => {
    globalThis.fetch = stubFailFetch({
      bundle: failBundleWithAnn,
      postResponder: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "validation failed" }), {
            status: 422,
            headers: { "content-type": "application/json" },
          }),
        ),
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: failTourId }));
    });
    await flush();

    // Bundle-load re-anchor seats the cursor on the human card. `r` opens
    // the reply composer for that card's thread.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "r", bubbles: true }),
      );
    });
    await flush();

    const ta = container.querySelector<HTMLTextAreaElement>(
      "textarea.composer-textarea",
    );
    expect(ta).not.toBeNull();
    await act(async () => {
      setTextareaValue(ta!, "reply body");
    });

    const submitBtn = container.querySelector<HTMLButtonElement>(
      "button.composer-submit",
    );
    expect(submitBtn).not.toBeNull();
    await act(async () => {
      submitBtn!.click();
    });
    await flush();

    const status = container.querySelector(
      "footer.app-footer .app-footer-status",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Reply failed: validation failed");
  });

  it("non-2xx response on top-level comment submit flashes `Comment failed: <reason>` in the footer status slot", async () => {
    globalThis.fetch = stubFailFetch({
      bundle: failBundleEmpty,
      postResponder: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "server is busy" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        ),
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: failTourId }));
    });
    await flush();

    // PRD #343 / ADR 0031 / issue #346: empty-tour seed lands
    // paneFocus = sidebar, where `c` is a silent no-op. Esc first
    // flips paneFocus to diff so the subsequent `c` press
    // materializes the cursor and opens the top-level composer
    // (today's pre-#346 behavior, just one keypress earlier in the
    // sequence).
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
    });
    await flush();

    const ta = container.querySelector<HTMLTextAreaElement>(
      "textarea.composer-textarea",
    );
    expect(ta).not.toBeNull();
    await act(async () => {
      setTextareaValue(ta!, "first comment");
    });

    const submitBtn = container.querySelector<HTMLButtonElement>(
      "button.composer-submit",
    );
    expect(submitBtn).not.toBeNull();
    await act(async () => {
      submitBtn!.click();
    });
    await flush();

    const status = container.querySelector(
      "footer.app-footer .app-footer-status",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Comment failed: server is busy");
  });

  it("network error on reply submit flashes `Reply failed: <fallback>` in the footer status slot", async () => {
    globalThis.fetch = stubFailFetch({
      bundle: failBundleWithAnn,
      postResponder: () => Promise.reject(new TypeError("network failure")),
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: failTourId }));
    });
    await flush();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "r", bubbles: true }),
      );
    });
    await flush();

    const ta = container.querySelector<HTMLTextAreaElement>(
      "textarea.composer-textarea",
    );
    expect(ta).not.toBeNull();
    await act(async () => {
      setTextareaValue(ta!, "reply body");
    });

    const submitBtn = container.querySelector<HTMLButtonElement>(
      "button.composer-submit",
    );
    await act(async () => {
      submitBtn!.click();
    });
    await flush();

    const status = container.querySelector(
      "footer.app-footer .app-footer-status",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Reply failed: network failure");
  });

  it("successful reply submit does NOT flash any footer status", async () => {
    globalThis.fetch = stubFailFetch({
      bundle: failBundleWithAnn,
      postResponder: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "ann-reply-success",
              file: "src/foo.ts",
              side: "additions",
              line_start: 2,
              line_end: 2,
              body: "reply body",
              author: "human",
              author_kind: "human",
              replies_to: "ann-human-fail",
              created_at: "2026-05-15T00:00:01Z",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: failTourId }));
    });
    await flush();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "r", bubbles: true }),
      );
    });
    await flush();

    const ta = container.querySelector<HTMLTextAreaElement>(
      "textarea.composer-textarea",
    );
    expect(ta).not.toBeNull();
    await act(async () => {
      setTextareaValue(ta!, "reply body");
    });

    const submitBtn = container.querySelector<HTMLButtonElement>(
      "button.composer-submit",
    );
    await act(async () => {
      submitBtn!.click();
    });
    await flush();

    const status = container.querySelector(
      "footer.app-footer .app-footer-status",
    );
    expect(status).not.toBeNull();
    // The live region always renders an empty prefix when status is
    // null (the legend follows in a sibling span). No failure prefix.
    expect(status!.textContent ?? "").not.toContain("failed:");
  });
});

// PRD #343 / ADR 0031 / issue #346: cross-surface pane-focus. The
// webapp gains keyboard sidebar navigation (Esc/Enter, j/k/h/l) plus
// ARIA tree-widget semantics (role=tree / role=treeitem / aria-
// expanded) and roving tabindex (exactly one row holds tabindex=0).
// These tests mount <App> against the standard smoke fixture (with
// one top-level Comment so the seed lands paneFocus=diff) AND a
// no-Comment fixture (so the seed lands paneFocus=sidebar).

const noCommentTourId = "2026-05-15-000000-pane-focus-no-comments";

const noCommentBundle = {
  kind: "ok" as const,
  tour: {
    ...tourSummary,
    id: noCommentTourId,
    title: "No-comments pane-focus tour",
  },
  comments: [],
  diff,
  files: bundle.files,
};

function stubPaneFocusFetch(id: string, b: typeof bundle) {
  return vi.fn((input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    if (u.includes("/api/tours?")) {
      return Promise.resolve(
        new Response(JSON.stringify([b.tour]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${id}`)) {
      return Promise.resolve(
        new Response(JSON.stringify(b), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${id}/reply-lock`)) {
      return Promise.resolve(
        new Response(JSON.stringify(null), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

describe("App cross-surface pane focus (PRD #343 / issue #346)", () => {
  it("sidebar carries role=tree and rows carry role=treeitem with aria-expanded on folders", async () => {
    globalThis.fetch = stubPaneFocusFetch(tourId, bundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const tree = container.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();

    const treeitems = container.querySelectorAll('[role="treeitem"]');
    expect(treeitems.length).toBeGreaterThan(0);

    // The two-file fixture has a `src/` folder collapse — at least one
    // folder treeitem is in the DOM and has aria-expanded set.
    const folderItems = container.querySelectorAll(
      '.folder-entry[role="treeitem"]',
    );
    expect(folderItems.length).toBeGreaterThan(0);
    for (const f of Array.from(folderItems)) {
      expect(f.getAttribute("aria-expanded")).not.toBeNull();
    }
  });

  it("exactly one sidebar row carries tabindex=0 at any time (roving-tabindex)", async () => {
    globalThis.fetch = stubPaneFocusFetch(tourId, bundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const treeitems = container.querySelectorAll('[role="treeitem"]');
    const tabStops = Array.from(treeitems).filter(
      (el) => el.getAttribute("tabindex") === "0",
    );
    expect(tabStops.length).toBe(1);
    const others = Array.from(treeitems).filter(
      (el) => el.getAttribute("tabindex") !== "0",
    );
    for (const el of others) {
      expect(el.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("mounting with top-level Comments lands paneFocus = diff (no accent border on sidebar)", async () => {
    globalThis.fetch = stubPaneFocusFetch(tourId, bundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const aside = container.querySelector(".app-sidebar");
    expect(aside).not.toBeNull();
    // paneFocus=diff → data-pane-focus attribute absent or != "sidebar"
    expect(aside!.getAttribute("data-pane-focus")).not.toBe("sidebar");
  });

  it("mounting without top-level Comments lands paneFocus = sidebar (accent border + first file selected)", async () => {
    globalThis.fetch = stubPaneFocusFetch(noCommentTourId, noCommentBundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: noCommentTourId }));
    });
    await flush();

    const aside = container.querySelector(".app-sidebar");
    expect(aside).not.toBeNull();
    expect(aside!.getAttribute("data-pane-focus")).toBe("sidebar");

    // First file row holds the tab stop (roving-tabindex starting
    // position on empty tours).
    const tabStops = container.querySelectorAll('[role="treeitem"][tabindex="0"]');
    expect(tabStops.length).toBe(1);
  });

  it("Esc from diff flips paneFocus to sidebar (accent border appears)", async () => {
    globalThis.fetch = stubPaneFocusFetch(tourId, bundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    // Start state: paneFocus = diff (Tour with Comments).
    let aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).not.toBe("sidebar");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).toBe("sidebar");
  });

  it("Esc from sidebar flips paneFocus back to diff (accent border disappears)", async () => {
    globalThis.fetch = stubPaneFocusFetch(noCommentTourId, noCommentBundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: noCommentTourId }));
    });
    await flush();

    // Start state: paneFocus = sidebar (empty tour).
    let aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).toBe("sidebar");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).not.toBe("sidebar");
  });

  it("sidebar j moves the roving tabindex to the next visible row", async () => {
    globalThis.fetch = stubPaneFocusFetch(noCommentTourId, noCommentBundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: noCommentTourId }));
    });
    await flush();

    // Initial tab stop is on the first visible row.
    const initialStops = container.querySelectorAll(
      '[role="treeitem"][tabindex="0"]',
    );
    expect(initialStops.length).toBe(1);
    const initialKey = (initialStops[0] as HTMLElement).getAttribute("title");

    // j advances to the next row.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();

    const nextStops = container.querySelectorAll(
      '[role="treeitem"][tabindex="0"]',
    );
    expect(nextStops.length).toBe(1);
    const nextKey = (nextStops[0] as HTMLElement).getAttribute("title");
    expect(nextKey).not.toBe(initialKey);
  });

  it("footer legend swaps to the sidebar string when paneFocus = sidebar", async () => {
    globalThis.fetch = stubPaneFocusFetch(noCommentTourId, noCommentBundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: noCommentTourId }));
    });
    await flush();

    // Empty-tour seed → paneFocus = sidebar → sidebar legend.
    const legend = container.querySelector("footer.app-footer");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("Esc: diff");
    expect(legend!.textContent).not.toContain("n/p: nav");
  });

  it("footer legend keeps the diff form (with Esc: sidebar) when paneFocus = diff", async () => {
    globalThis.fetch = stubPaneFocusFetch(tourId, bundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    const legend = container.querySelector("footer.app-footer");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("Esc: sidebar");
    expect(legend!.textContent).toContain("n/p: nav");
  });

  it("clicking a sidebar file row sets paneFocus = sidebar AND moves the roving tabindex", async () => {
    globalThis.fetch = stubPaneFocusFetch(tourId, bundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();

    // Start: paneFocus = diff (with-comments seed).
    let aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).not.toBe("sidebar");

    const fileEntry = container.querySelector(
      '.file-entry[role="treeitem"]',
    ) as HTMLButtonElement;
    expect(fileEntry).not.toBeNull();
    await act(async () => {
      fileEntry.click();
    });
    await flush();

    aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).toBe("sidebar");
  });

  it("Esc with the composer open closes the composer (paneFocus unchanged)", async () => {
    globalThis.fetch = stubPaneFocusFetch(noCommentTourId, noCommentBundle);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: noCommentTourId }));
    });
    await flush();

    // Empty-tour seed → paneFocus = sidebar. Esc flips to diff.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();
    let aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).not.toBe("sidebar");

    // `c` lazy-materializes the cursor and opens the top-level
    // composer on the first annotatable row.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
    });
    await flush();
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea.composer-textarea"),
    ).not.toBeNull();

    // Press Escape — modal-unwind precedence kicks in: composer
    // closes, paneFocus stays on diff.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(
      container.querySelector<HTMLTextAreaElement>("textarea.composer-textarea"),
    ).toBeNull();
    aside = container.querySelector(".app-sidebar");
    expect(aside!.getAttribute("data-pane-focus")).not.toBe("sidebar");
  });
});

// Issue #404: ADR 0037's in-Card walker is gated on `moveCursor` receiving
// `threads` + `collapsedThreads`. The TUI passes both; the webapp's
// `case "move-down" / "move-up"` reducer branches did not, so `j`/`k`
// on a parent Card skipped past the entire Thread to the next diff row
// instead of descending into the reply nodes. These tests pin that the
// webapp now walks: parent → replies → next-row on `j`, and the mirror
// on `k`. A collapsed-Thread variant pins that the in-Card walker is
// skipped when the Thread's root id is in `collapsedThreads`.

const replyWalkTourId = "2026-05-17-000000-issue-404-reply-walk";

const replyWalkTourSummary = {
  id: replyWalkTourId,
  title: "Reply walk fixture",
  status: "open" as const,
  created_at: "2026-05-17T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafebabe",
  head_source: "feature/x",
  base_source: "main",
  wip_snapshot: false,
};

const replyWalkDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 1..2 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,4 @@
 first line
-old line
+new line
+added line
+third added
`;

const replyWalkParent = {
  id: "ann-parent",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 2,
  line_end: 2,
  body: "parent",
  author: "alice",
  author_kind: "human" as const,
  created_at: "2026-05-17T00:00:00Z",
};

const replyWalkReply1 = {
  id: "ann-reply-1",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 2,
  line_end: 2,
  body: "reply 1",
  author: "alice",
  author_kind: "human" as const,
  replies_to: "ann-parent",
  created_at: "2026-05-17T00:00:01Z",
};

const replyWalkReply2 = {
  id: "ann-reply-2",
  file: "src/foo.ts",
  side: "additions" as const,
  line_start: 2,
  line_end: 2,
  body: "reply 2",
  author: "alice",
  author_kind: "human" as const,
  replies_to: "ann-parent",
  created_at: "2026-05-17T00:00:02Z",
};

const replyWalkBundle = {
  kind: "ok" as const,
  tour: replyWalkTourSummary,
  comments: [replyWalkParent, replyWalkReply1, replyWalkReply2],
  diff: replyWalkDiff,
  files: [
    {
      name: "src/foo.ts",
      type: "modified",
      hunks: [],
      oldContent: "first line\nold line\n",
      newContent: "first line\nnew line\nadded line\nthird added\n",
      classification: { collapsed: false },
      orphanWindows: [],
    },
  ],
};

function stubReplyWalkFetch(): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    if (u.includes("/api/tours?")) {
      return Promise.resolve(
        new Response(JSON.stringify([replyWalkTourSummary]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${replyWalkTourId}`)) {
      return Promise.resolve(
        new Response(JSON.stringify(replyWalkBundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.endsWith(`/api/tours/${replyWalkTourId}/reply-lock`)) {
      return Promise.resolve(
        new Response(JSON.stringify(null), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

function annFromHash(): string | null {
  if (window.location.hash === "") return null;
  return decodeURIComponent(window.location.hash.slice(1));
}

describe("App j/k descends into Card replies (issue #404 — ADR 0037 wiring)", () => {
  it("j on a parent Card with replies lands the cursor on the first reply id", async () => {
    globalThis.fetch = stubReplyWalkFetch();
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: replyWalkTourId }));
    });
    await flush();

    // Bundle-load re-anchor (re-anchor-policy.ts) seats the cursor on the
    // first top-level Comment — the parent. The mirrorAnnUrl intent writes
    // the parent id into window.location.hash.
    expect(annFromHash()).toBe("ann-parent");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();

    // ADR 0037 in-Card walker: parent → first reply.
    expect(annFromHash()).toBe("ann-reply-1");

    // Card chrome stays lit while the cursor walks into a reply node
    // (Thread-level `isCurrent` is true when the cursor sits on any
    // Thread node, matching TUI behaviour).
    const parentBlock = container.querySelector(
      `[data-comment-id="ann-parent"]`,
    );
    expect(parentBlock).not.toBeNull();
    expect(parentBlock!.classList.contains("current")).toBe(true);
  });

  it("j twice walks parent → reply-1 → reply-2; one more j exits the Thread to the next diff row", async () => {
    globalThis.fetch = stubReplyWalkFetch();
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: replyWalkTourId }));
    });
    await flush();

    expect(annFromHash()).toBe("ann-parent");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBe("ann-reply-1");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBe("ann-reply-2");

    // Past the last reply: the next `j` exits the Card to a diff row.
    // mirrorAnnUrl fires with null, clearing the URL's `#<id>` fragment.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBeNull();
  });

  it("k from a reply walks back up the Thread (reply-2 → reply-1 → parent)", async () => {
    globalThis.fetch = stubReplyWalkFetch();
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: replyWalkTourId }));
    });
    await flush();

    // Walk down twice so the cursor sits on reply-2.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBe("ann-reply-2");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBe("ann-reply-1");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBe("ann-parent");
  });

  it("j on a Card whose Thread is collapsed (Shift+C) skips the Thread to the next diff row", async () => {
    globalThis.fetch = stubReplyWalkFetch();
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: replyWalkTourId }));
    });
    await flush();

    expect(annFromHash()).toBe("ann-parent");

    // PRD #397 / ADR 0038: Shift+C collapses the Thread under the cursor.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "C",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    await flush();

    // With the Thread collapsed, the in-Card walker is skipped. `j`
    // exits straight to the diff row past the Card — cursor becomes a
    // RowAnchor, mirrorAnnUrl fires with null, hash clears.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true }),
      );
    });
    await flush();
    expect(annFromHash()).toBeNull();
  });
});

// Issue #405: the post-submit cursor must land on the freshly-created
// Reply (or top-level Comment) once the deferred bundle fold runs.
// Pre-fix the synchronous cursor re-anchor in `composer.submitted`
// pointed at a Comment id that wasn't yet in `bundle.comments` — the
// cursor-reconcile useEffect saw the orphan CardAnchor and dispatched
// `cursor.clear`, so by the time the user saw the post-submit screen,
// `state.cursor` was null. The fix unifies the bundle fold and cursor
// landing in one atomic action (`bundle.commentInsertedWithLanding`)
// dispatched by the runtime after the same 50 ms timer that decouples
// the composer-overlay unmount from the heightful CommentRow add.
//
// Acceptance criterion from issue #405:
//   "[ ] New integration test on App-rendered tree (TUI and/or webapp):
//    submit a reply via dispatch chain, await the full timer + render
//    cycle, assert that the DOM / virtual tree shows the Card with
//    isCurrent=true and the new Reply's byline carrying the active-
//    node indicator."
//
// The webapp's cursor-on-card indicator is the `mirrorAnnUrl` write to
// `window.location.hash` plus the `.current` className on the Thread's
// outer block. Pre-fix the hash cleared; post-fix the hash is the new
// Reply id and the parent block stays `.current`.
describe("App post-submit cursor lands on the new Reply (issue #405 race with #392's deferred fold)", () => {
  const submittedReply = {
    id: "ann-reply-success-405",
    file: "src/foo.ts",
    side: "additions" as const,
    line_start: 2,
    line_end: 2,
    body: "pushback",
    author: "human",
    author_kind: "human" as const,
    replies_to: "ann-human-fail",
    created_at: "2026-05-17T00:00:00Z",
  };

  it("after a successful reply submit, window.location.hash is the new Reply id (not cleared)", async () => {
    globalThis.fetch = stubFailFetch({
      bundle: failBundleWithAnn,
      postResponder: () =>
        Promise.resolve(
          new Response(JSON.stringify(submittedReply), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: failTourId }));
    });
    await flush();

    // Bundle-load re-anchor seats the cursor on the parent Comment;
    // its id is mirrored to the URL hash.
    expect(annFromHash()).toBe("ann-human-fail");

    // `r` opens the reply composer for the Thread under the cursor.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "r", bubbles: true }),
      );
    });
    await flush();

    const ta = container.querySelector<HTMLTextAreaElement>(
      "textarea.composer-textarea",
    );
    expect(ta).not.toBeNull();
    await act(async () => {
      setTextareaValue(ta!, "pushback");
    });

    const submitBtn = container.querySelector<HTMLButtonElement>(
      "button.composer-submit",
    );
    expect(submitBtn).not.toBeNull();
    await act(async () => {
      submitBtn!.click();
    });
    await flush();

    // Wait past the runtime's 50 ms deferred-landing timer + the
    // dispatch/render cycle it triggers. Pre-fix, by this point the
    // cursor had been cleared by App.tsx's cursor-reconcile useEffect
    // (orphan CardAnchor against a not-yet-folded bundle).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await flush();

    // Post-fix: hash is the new Reply id. Pre-fix this was empty
    // (cursor.clear had fired during the orphan window).
    expect(annFromHash()).toBe("ann-reply-success-405");
  });

  it("after a successful reply submit, the parent Thread block stays .current (Thread-wide isCurrent)", async () => {
    globalThis.fetch = stubFailFetch({
      bundle: failBundleWithAnn,
      postResponder: () =>
        Promise.resolve(
          new Response(JSON.stringify(submittedReply), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    });
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: failTourId }));
    });
    await flush();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "r", bubbles: true }),
      );
    });
    await flush();

    const ta = container.querySelector<HTMLTextAreaElement>(
      "textarea.composer-textarea",
    );
    await act(async () => {
      setTextareaValue(ta!, "pushback");
    });
    const submitBtn = container.querySelector<HTMLButtonElement>(
      "button.composer-submit",
    );
    await act(async () => {
      submitBtn!.click();
    });
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await flush();

    // The parent Card stays lit while the cursor sits on its reply node
    // (Thread-level isCurrent — same rule as issue #404). Pre-fix the
    // cursor was null, so this block had `.current` go false.
    const parentBlock = container.querySelector(
      `[data-comment-id="ann-human-fail"]`,
    );
    expect(parentBlock).not.toBeNull();
    expect(parentBlock!.classList.contains("current")).toBe(true);
  });
});
