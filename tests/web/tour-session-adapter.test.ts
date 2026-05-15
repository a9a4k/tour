// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWebTourSessionAdapter } from "../../src/web/client/tour-session-adapter.js";
import {
  TourSessionStore,
  initialTourSessionState,
  type ComposerTarget,
  type TourSessionState,
} from "../../src/core/tour-session.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import type { Comment, Tour } from "../../src/core/types.js";

// Issue #291. The TUI adapter's `requestReply` throws on transport-level
// failure (via core/reply-runner.ts); the web adapter previously resolved
// regardless of `res.ok`, so HTTP 4xx / 5xx responses silently succeeded.
// The runtime's fire-and-forget catch absorbs the rejection — but the
// adapter contract is now uniform: both surfaces reject on non-2xx, both
// pass through the runtime's `.catch(() => {})`.

let originalFetch: typeof fetch;

type AdapterCallbacks = {
  findFileBlock: (name: string) => HTMLElement | null;
  setSelectedFile: (file: string | null) => void;
  revealFileAncestors: (file: string) => void;
};

const noopCallbacks: AdapterCallbacks = {
  findFileBlock: () => document.createElement("div"),
  setSelectedFile: () => {},
  revealFileAncestors: () => {},
};

function makeAdapter(
  opts: {
    store?: TourSessionStore;
    commentRefs?: Map<string, HTMLDivElement>;
    callbacks?: AdapterCallbacks | null;
  } = {},
) {
  const store =
    opts.store ??
    ({ getState: () => ({ currentTourId: null }) } as unknown as TourSessionStore);
  return createWebTourSessionAdapter({
    store,
    commentRefs: { current: opts.commentRefs ?? new Map() },
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
    const adapter = makeAdapter({ commentRefs: new Map([["ann1", card]]) });

    adapter.scrollToCard("ann1", "nearest");
    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("scrolls instantly when placement is 'center' (fresh landing — initial / URL restore / stale fallback)", async () => {
    const card = document.createElement("div");
    const scrollSpy = vi.fn();
    card.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
    const adapter = makeAdapter({ commentRefs: new Map([["ann1", card]]) });

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
      adapter.requestReply({ tourId: "tour-a", commentId: "ann-1" }),
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
      adapter.requestReply({ tourId: "tour-a", commentId: "ann-1" }),
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
      adapter.requestReply({ tourId: "tour-a", commentId: "ann-1" }),
    ).resolves.toBeUndefined();
  });
});

// Issue #324. `composer.recall` (auto-recall on `+`-button click while a
// Composer is in flight) must reveal its anchor before scrolling. The
// fix dispatches `folds.setOverride { value: false }` for the anchor
// file iff its body is currently hidden, then defers the scroll a frame
// so React commits the unfolded body — mirrors `n`/`p`/URL `?ann=` restore.

function tour(id: string): Tour {
  return {
    id,
    title: `tour-${id}`,
    status: "open",
    created_at: "2026-05-14T00:00:00Z",
    closed_at: "",
    head_sha: "h",
    base_sha: "b",
    head_source: "h",
    base_source: "b",
    wip_snapshot: false,
  };
}

function bundleFile(
  name: string,
  classification: BundleFile["classification"] = { collapsed: false },
): BundleFile {
  return {
    name,
    type: "change",
    hunks: [],
    classification,
    orphanWindows: [],
  };
}

function okBundle(
  opts: { files?: BundleFile[]; comments?: Comment[] } = {},
): TourBundle {
  return {
    kind: "ok",
    tour: tour("tour-a"),
    comments: opts.comments ?? [],
    diff: "",
    files: opts.files ?? [],
  };
}

function ann(opts: { id: string; file: string; replies_to?: string }): Comment {
  const out: Comment = {
    id: opts.id,
    file: opts.file,
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "",
    author: "tester",
    author_kind: "human",
    created_at: "2026-05-14T00:00:00Z",
  };
  if (opts.replies_to !== undefined) out.replies_to = opts.replies_to;
  return out;
}

function storeWithState(partial: Partial<TourSessionState>): TourSessionStore {
  return new TourSessionStore({ ...initialTourSessionState(), ...partial });
}

function topLevelTarget(file: string, line = 1): ComposerTarget {
  return { kind: "top-level", file, side: "additions", line_start: line, line_end: line };
}

describe("createWebTourSessionAdapter.scrollToComposer — unfold before scroll (Issue #324)", () => {
  it("dispatches folds.setOverride{false} when the anchor file is classifier-collapsed (no override)", async () => {
    const file = "bun.lock";
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: {
        kind: "ok",
        value: okBundle({
          files: [bundleFile(file, { collapsed: true, reason: "generated" })],
        }),
      },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer(topLevelTarget(file, 7));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: "folds.setOverride",
      file,
      value: false,
    });
    await flushRaf();
  });

  it("dispatches folds.setOverride{false} when the anchor file is binary (no override)", async () => {
    const file = "image.png";
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: {
        kind: "ok",
        value: okBundle({
          files: [bundleFile(file, { collapsed: true, reason: "binary" })],
        }),
      },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer(topLevelTarget(file, 3));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: "folds.setOverride",
      file,
      value: false,
    });
    await flushRaf();
  });

  it("dispatches folds.setOverride{false} when the anchor file has a manual user-fold override (true)", async () => {
    const file = "src/a.ts";
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: { kind: "ok", value: okBundle({ files: [bundleFile(file)] }) },
      collapsedOverrides: { [file]: true },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer(topLevelTarget(file, 2));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: "folds.setOverride",
      file,
      value: false,
    });
    await flushRaf();
  });

  it("does NOT dispatch folds.setOverride when the anchor file is already visible", async () => {
    const file = "src/a.ts";
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: { kind: "ok", value: okBundle({ files: [bundleFile(file)] }) },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer(topLevelTarget(file, 5));
    expect(dispatchSpy).not.toHaveBeenCalled();
    await flushRaf();
  });

  it("does NOT dispatch folds.setOverride when the anchor file has an explicit-false override (already visible)", async () => {
    const file = "bun.lock";
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: {
        kind: "ok",
        value: okBundle({
          files: [bundleFile(file, { collapsed: true, reason: "generated" })],
        }),
      },
      collapsedOverrides: { [file]: false },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer(topLevelTarget(file, 1));
    expect(dispatchSpy).not.toHaveBeenCalled();
    await flushRaf();
  });

  it("reply target: dispatches folds.setOverride{false} on the parent comment's file when that file is folded", async () => {
    const parentFile = "src/parent.ts";
    const parent = ann({ id: "ann-parent", file: parentFile });
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: {
        kind: "ok",
        value: okBundle({ files: [bundleFile(parentFile)], comments: [parent] }),
      },
      collapsedOverrides: { [parentFile]: true },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer({ kind: "reply", replies_to: parent.id });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: "folds.setOverride",
      file: parentFile,
      value: false,
    });
    await flushRaf();
  });

  it("reply target: does NOT dispatch when the parent file is already visible", async () => {
    const parentFile = "src/parent.ts";
    const parent = ann({ id: "ann-parent", file: parentFile });
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: {
        kind: "ok",
        value: okBundle({ files: [bundleFile(parentFile)], comments: [parent] }),
      },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({ store, callbacks: noopCallbacks });

    adapter.scrollToComposer({ kind: "reply", replies_to: parent.id });
    expect(dispatchSpy).not.toHaveBeenCalled();
    await flushRaf();
  });

  it("scroll + textarea focus still fire after the unfold dispatch (deferred via rAF)", async () => {
    const file = "bun.lock";
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: {
        kind: "ok",
        value: okBundle({
          files: [bundleFile(file, { collapsed: true, reason: "generated" })],
        }),
      },
    });

    // DOM mimics what React would render AFTER the unfold: file block now
    // contains the anchor row's gutter cell and a Composer card with a textarea.
    const { fileBlock, scrollSpy } = makeRowDom();
    const composerCard = document.createElement("div");
    composerCard.classList.add("tour-card");
    composerCard.setAttribute("data-composer", "true");
    const textarea = document.createElement("textarea");
    composerCard.appendChild(textarea);
    fileBlock.appendChild(composerCard);
    const focusSpy = vi.spyOn(textarea, "focus");

    const adapter = makeAdapter({
      store,
      callbacks: { ...noopCallbacks, findFileBlock: () => fileBlock },
    });

    adapter.scrollToComposer(topLevelTarget(file, 7));
    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "instant", block: "center" });
    expect(focusSpy).toHaveBeenCalled();
  });

  it("does not throw and does not loop when the parent comment is missing from the bundle (honest unreachable)", async () => {
    const store = storeWithState({
      currentTourId: "tour-a",
      bundle: { kind: "ok", value: okBundle() },
    });
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const adapter = makeAdapter({
      store,
      callbacks: { ...noopCallbacks, findFileBlock: () => null },
    });

    expect(() =>
      adapter.scrollToComposer({ kind: "reply", replies_to: "missing-id" }),
    ).not.toThrow();
    expect(dispatchSpy).not.toHaveBeenCalled();
    await flushRaf();
  });
});
