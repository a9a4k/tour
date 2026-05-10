// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/client/App.js";

// Smoke test for the webapp root component (Issue #131). The bug — TDZ
// ReferenceError on `flatRowsList` — fired during the FIRST render of
// <App />, leaving the SPA blank. Webapp unit tests prior to this one
// imported cursor helpers directly and never mounted <App />, so the
// TDZ slipped through CI. Mounting and rendering once is sufficient
// to catch any future regression where a binding referenced in the
// render path (deps array, JSX expression, useMemo body, …) is read
// before its declaration.

let root: Root | null = null;
let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  // React's `act` checks this global to opt the test environment in to
  // batched effect flushing. happy-dom doesn't set it; vitest doesn't
  // set it either. Without it React logs "not configured to support
  // act(...)" warnings for every state transition under the test.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  // App's mount-time effects fire fetch + EventSource against the API.
  // Stub both so the test is hermetic and no unhandled-rejection chatter
  // bleeds into the assertion.
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  ) as unknown as typeof fetch;
  originalEventSource = globalThis.EventSource;
  class StubEventSource {
    onmessage: ((e: MessageEvent) => void) | null = null;
    close(): void {}
  }
  // happy-dom does not ship EventSource by default.
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
    StubEventSource as unknown as typeof EventSource;
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
});

describe("App: first-render smoke (Issue #131 — TDZ ReferenceError regression)", () => {
  it("mounts without throwing on the initial render", () => {
    const container = document.getElementById("root")!;
    expect(() => {
      act(() => {
        root = createRoot(container);
        root.render(createElement(App, { initialTourId: null }));
      });
    }).not.toThrow();
    // And produced SOMETHING in the DOM (i.e., the render actually
    // committed; a TDZ would have aborted with the container empty).
    expect(container.children.length).toBeGreaterThan(0);
  });

  it("mounts without throwing when an initialTourId is supplied", () => {
    const container = document.getElementById("root")!;
    expect(() => {
      act(() => {
        root = createRoot(container);
        root.render(createElement(App, { initialTourId: "tour-abc" }));
      });
    }).not.toThrow();
    expect(container.children.length).toBeGreaterThan(0);
  });
});
