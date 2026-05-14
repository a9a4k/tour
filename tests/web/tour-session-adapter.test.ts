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

function makeAdapter(
  opts: {
    annotationRefs?: Map<string, HTMLDivElement>;
    callbacks?: {
      findFileBlock: (name: string) => HTMLElement | null;
      setSelectedFile: (file: string | null) => void;
      revealFileAncestors: (file: string) => void;
    } | null;
  } = {},
) {
  const stubStore = {
    getState: () => ({ currentTourId: null }),
  } as unknown as TourSessionStore;
  return createWebTourSessionAdapter({
    store: stubStore,
    annotationRefs: { current: opts.annotationRefs ?? new Map() },
    callbacksRef: { current: opts.callbacks ?? null },
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Issue #293. Cursor-driven scroll behavior derives from the intent's
// `placement` discriminator. `nearest` (n/p/j/k/click-to-position) →
// `behavior: "smooth"` so travel distance is perceptible; `center`
// (cursor materialize / URL ?ann= restore / stale-fallback) →
// `behavior: "instant"` so fresh landings frame immediately.

function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function makeRowDom(): { fileBlock: HTMLElement; scrollSpy: ReturnType<typeof vi.fn> } {
  const fileBlock = document.createElement("div");
  const cell = document.createElement("div");
  cell.classList.add("tour-row-gutter");
  cell.setAttribute("data-side", "additions");
  cell.setAttribute("data-line-number", "7");
  fileBlock.appendChild(cell);
  const scrollSpy = vi.fn();
  cell.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
  return { fileBlock, scrollSpy };
}

describe("createWebTourSessionAdapter.scrollToCard — placement-driven behavior (Issue #293)", () => {
  it("scrolls smoothly when placement is 'nearest' (n/p/j/k in-flight navigation)", async () => {
    const card = document.createElement("div");
    const scrollSpy = vi.fn();
    card.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
    const adapter = makeAdapter({ annotationRefs: new Map([["ann1", card]]) });

    adapter.scrollToCard("ann1", "nearest");
    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("scrolls instantly when placement is 'center' (fresh landing — initial / URL restore / stale fallback)", async () => {
    const card = document.createElement("div");
    const scrollSpy = vi.fn();
    card.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
    const adapter = makeAdapter({ annotationRefs: new Map([["ann1", card]]) });

    adapter.scrollToCard("ann1", "center");
    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "instant", block: "center" });
  });
});

describe("createWebTourSessionAdapter.scrollToRow — placement-driven behavior (Issue #293)", () => {
  it("scrolls the gutter cell smoothly when placement is 'nearest' (j/k off-screen target)", async () => {
    const { fileBlock, scrollSpy } = makeRowDom();
    const adapter = makeAdapter({
      callbacks: {
        findFileBlock: () => fileBlock,
        setSelectedFile: () => {},
        revealFileAncestors: () => {},
      },
    });

    adapter.scrollToRow(
      { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
      "nearest",
    );
    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("scrolls the gutter cell instantly when placement is 'center'", async () => {
    const { fileBlock, scrollSpy } = makeRowDom();
    const adapter = makeAdapter({
      callbacks: {
        findFileBlock: () => fileBlock,
        setSelectedFile: () => {},
        revealFileAncestors: () => {},
      },
    });

    adapter.scrollToRow(
      { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
      "center",
    );
    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "instant", block: "center" });
  });
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
