// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/client/App.js";

// Issue #179 reopen — the SPA reads tour-id from window.location.pathname
// with higher precedence than the baked `__INITIAL_TOUR_ID__`. This is
// the probe-reuse fix: when the server was started for tour A but the
// user clicks the deep URL `/<tour-B-id>` printed by a second
// `tour serve <B>`, the address bar's tour wins over whatever id the
// already-running server's HTML carries.

let root: Root | null = null;
let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn((input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    // /api/tours?status=all → empty list (App falls back to initialTourId).
    if (u.includes("/api/tours?")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    // /api/tours/<id> → 404 — we don't need a real bundle, only to
    // observe which id the App asked for.
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  originalEventSource = globalThis.EventSource;
  class StubEventSource {
    onmessage: ((e: MessageEvent) => void) | null = null;
    close(): void {}
  }
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
    StubEventSource as unknown as typeof EventSource;
  // Reset the URL to a known root state before each test so previous-test
  // replaceState calls don't leak.
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
  window.history.replaceState(null, "", "/");
});

function bundleUrls(): string[] {
  return fetchSpy.mock.calls
    .map((c) => (typeof c[0] === "string" ? c[0] : c[0].toString()))
    .filter((u) => /^\/api\/tours\/[^/?]+$/.test(u));
}

describe("App URL routing (Issue #179 reopen)", () => {
  it("reads tour-id from window.location.pathname over the baked initialTourId", () => {
    // Simulates probe-reuse: server baked `tour-A`, user clicks `/tour-B`.
    window.history.replaceState(null, "", "/tour-B");
    const container = document.getElementById("root")!;
    act(() => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: "tour-A" }));
    });
    expect(bundleUrls()).toEqual(["/api/tours/tour-B"]);
  });

  it("still honors the legacy `?tour=<id>` query when the path is empty", () => {
    window.history.replaceState(null, "", "/?tour=tour-Q");
    const container = document.getElementById("root")!;
    act(() => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: "tour-A" }));
    });
    expect(bundleUrls()).toEqual(["/api/tours/tour-Q"]);
  });

  it("falls back to initialTourId when neither path nor query has an id", () => {
    window.history.replaceState(null, "", "/");
    const container = document.getElementById("root")!;
    act(() => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: "tour-A" }));
    });
    expect(bundleUrls()).toEqual(["/api/tours/tour-A"]);
  });
});

// Issue #180 — when the SPA loads at bare `/` and state holds a
// tour-id (auto-picked or baked into `__INITIAL_TOUR_ID__`), the
// URL-writer's gate used to read the URL's tour-id with a `null`
// fallback. Bare URL → `null`, state has an id, gate sees "URL
// contradicts state" and skips forever. The fix: a bare URL must
// not be classified as contradicting state — only a URL that
// asserts a *different* tour-id should skip.
describe("App URL writer (Issue #180 — bare URL is consistent with state)", () => {
  const tourId = "2026-05-12-000000-test";
  const tourSummary = {
    id: tourId,
    title: "Test tour",
    status: "open" as const,
    created_at: "2026-05-12T00:00:00Z",
    closed_at: "",
    head_sha: "deadbeef",
    base_sha: "cafebabe",
    head_source: "feature/x",
    base_source: "main",
    wip_snapshot: false,
  };
  const annA = {
    id: "ann-a",
    file: "src/example.ts",
    side: "additions" as const,
    line_start: 1,
    line_end: 1,
    body: "first",
    author: "tester",
    author_kind: "human" as const,
    created_at: "2026-05-12T00:00:00Z",
  };
  const annB = { ...annA, id: "ann-b", body: "second" };
  const bundle = {
    kind: "ok" as const,
    tour: tourSummary,
    comments: [annA, annB],
    diff: "",
    files: [],
  };

  function installBundleFetch(): void {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
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
      // Unknown bundle ids (e.g., the in-flight-switch test asks for
      // `/api/tours/different-tour-id`) → 404 so the App's bundle-fetch
      // effect sets state.error rather than storing a malformed bundle.
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    });
  }

  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("bare `/` with tour auto-selected from the picker transitions to `/<tour-id>#<ann-id>` on first cursor anchor", async () => {
    installBundleFetch();
    window.history.replaceState(null, "", "/");
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      // initialTourId=null mirrors a fresh-cwd server hit at bare `/`:
      // the picker fetch returns one tour, App auto-selects it.
      root.render(createElement(App, { initialTourId: null }));
    });
    await flush();

    const path = window.location.pathname + window.location.hash;
    expect(path).toBe(`/${tourId}#${annA.id}`);
  });

  it("in-flight tour-switch window (URL points at a different tour-id) still skips the write", async () => {
    // URL asserts a different tour-id than state. Gate must skip so the
    // address bar isn't overwritten during the swap window.
    installBundleFetch();
    window.history.replaceState(null, "", "/different-tour-id");
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    // The path-reader wins, so tourId state ends up as
    // `different-tour-id` and the App fetches its bundle (404 from our
    // fallback). The URL must remain `/different-tour-id` — the writer
    // must not blast over a URL that asserts a tour-id different from
    // state's id, even transiently while the new bundle is loading.
    await flush();
    expect(window.location.pathname).toBe("/different-tour-id");
    expect(window.location.hash).toBe("");
  });

  // PRD #192 / ADR 0022 slice 2: `?ann=<id>` / `#<ann-id>` in the URL
  // materializes the cursor as a CardAnchor when the id matches a top-level
  // Comment; a stale id (deleted / Reply / hand-edited) falls back to
  // the first top-level Comment and the URL is rewritten to drop the
  // stale anchor.
  it("mount with URL fragment matching a top-level comment materializes a CardAnchor (URL preserved)", async () => {
    installBundleFetch();
    window.history.replaceState(null, "", `/${tourId}#${annB.id}`);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();
    // URL preserved (the cursor resolved to annB, replaceState is a no-op
    // when next === current).
    expect(window.location.pathname).toBe(`/${tourId}`);
    expect(window.location.hash).toBe(`#${annB.id}`);
  });

  it("mount with a stale fragment falls back to the first top-level comment (URL rewritten)", async () => {
    installBundleFetch();
    window.history.replaceState(null, "", `/${tourId}#missing-comment-id`);
    const container = document.getElementById("root")!;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(App, { initialTourId: tourId }));
    });
    await flush();
    // Cursor falls back to first top-level (annA); URL is rewritten via
    // replaceState to the first top-level's id.
    expect(window.location.pathname).toBe(`/${tourId}`);
    expect(window.location.hash).toBe(`#${annA.id}`);
  });
});
