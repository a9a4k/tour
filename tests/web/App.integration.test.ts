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

const annotation = {
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
  annotations: [annotation],
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
  // annotation nav and layout toggle follow. The reorder aligns with
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
});
