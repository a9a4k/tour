// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWebTourSessionAdapter } from "../../src/web/client/tour-session-adapter.js";
import type { TourSessionStore } from "../../src/core/tour-session.js";

// Issue #291. The TUI adapter's `requestReply` throws on transport-level
// failure (via core/reply-runner.ts); the web adapter previously resolved
// regardless of `res.ok`, so HTTP 4xx / 5xx responses silently succeeded.
// The runtime's fire-and-forget catch absorbs the rejection — but the
// adapter contract is now uniform: both surfaces reject on non-2xx, both
// pass through the runtime's `.catch(() => {})`.

let originalFetch: typeof fetch;

function makeAdapter() {
  const stubStore = {
    getState: () => ({ currentTourId: null }),
  } as unknown as TourSessionStore;
  return createWebTourSessionAdapter({
    store: stubStore,
    annotationRefs: { current: new Map() },
    callbacksRef: { current: null },
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createWebTourSessionAdapter.requestReply — non-2xx rejection (Issue #291)", () => {
  it("rejects with the parsed error body when the server returns 409 lock-held", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "reply lock held" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const adapter = makeAdapter();
    await expect(
      adapter.requestReply({ tourId: "tour-a", annotationId: "ann-1" }),
    ).rejects.toThrow("reply lock held");
  });

  it("rejects with `HTTP <status>` when the response body lacks an error field", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("", {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const adapter = makeAdapter();
    await expect(
      adapter.requestReply({ tourId: "tour-a", annotationId: "ann-1" }),
    ).rejects.toThrow("HTTP 500");
  });

  it("resolves on 2xx without throwing — the watcher drives the in-flight pill", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("", {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const adapter = makeAdapter();
    await expect(
      adapter.requestReply({ tourId: "tour-a", annotationId: "ann-1" }),
    ).resolves.toBeUndefined();
  });
});
