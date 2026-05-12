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
