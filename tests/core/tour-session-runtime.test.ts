import { describe, it, expect } from "vitest";
import {
  TourSessionStore,
  initialTourSessionState,
  isBundleResolved,
  type ComposerTarget,
  type TourSessionState,
} from "../../src/core/tour-session.js";
import { deriveTourSessionView } from "../../src/core/tour-session-view.js";
import {
  TourSessionRuntime,
  type ScrollRowAnchor,
  type TourEvent,
  type TourEventHandler,
  type TourSessionAdapter,
} from "../../src/core/tour-session-runtime.js";
import type {
  ScrollMotion,
  ScrollPlacement,
} from "../../src/core/tour-session.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import type { ReplyLock } from "../../src/core/reply-lock.js";
import type { Tour, Comment } from "../../src/core/types.js";
import type { WriteCommentInput } from "../../src/core/write-comment-input.js";
import type { Cursor } from "../../src/core/cursor-state.js";

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

function snapshotLostBundle(id: string): TourBundle {
  return { kind: "snapshot-lost", tour: tour(id), comments: [] as Comment[] };
}

function okBundle(id: string, comments: Comment[] = []): TourBundle {
  return {
    kind: "ok",
    tour: tour(id),
    comments,
    diff: "",
    files: [],
  };
}

// A real one-hunk diff + matching BundleFile for revalidateCursor tests —
// `okBundle` produces an empty diff/files which can't host a RowAnchor.
const DIFF_A = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
`;

function fileA(): BundleFile {
  return {
    name: "a.ts",
    type: "change",
    hunks: [
      {
        additionStart: 1,
        additionCount: 1,
        deletionStart: 1,
        deletionCount: 1,
        content: [],
      },
    ],
    oldContent: "old\n",
    newContent: "new\n",
    classification: { collapsed: false },
    orphanWindows: [],
  };
}

function bundleWithFileA(
  id: string,
  comments: Comment[] = [],
): TourBundle {
  return {
    kind: "ok",
    tour: tour(id),
    comments,
    diff: DIFF_A,
    files: [fileA()],
  };
}

interface FakeAdapter extends TourSessionAdapter {
  bundleCalls: string[];
  lockCalls: string[];
  writeCalls: Array<{ tourId: string; input: WriteCommentInput }>;
  deleteCalls: Array<{ tourId: string; targetId: string }>;
  requestReplyCalls: Array<{ tourId: string; commentId: string }>;
  scrollCardCalls: Array<{ id: string; mode: ScrollPlacement; behavior: ScrollMotion }>;
  scrollRowCalls: Array<{
    anchor: ScrollRowAnchor;
    mode: ScrollPlacement;
    behavior: ScrollMotion;
  }>;
  scrollComposerCalls: Array<ComposerTarget>;
  scrollPickerCalls: number[];
  revealFileCalls: string[];
  mirrorTourCalls: string[];
  mirrorAnnCalls: Array<string | null>;
  subscriptions: Array<{ tourId: string; handler: TourEventHandler; unsubscribed: boolean }>;
  emit(tourId: string, event: TourEvent): void;
}

interface FakeAdapterOptions {
  bundleByTour?: Record<string, TourBundle>;
  lockByTour?: Record<string, ReplyLock | null>;
  fetchBundleError?: boolean;
  fetchReplyLockError?: boolean;
  writeCommentError?: string;
  writeCommentResult?: Comment;
  deleteCommentError?: string;
  requestReplyError?: string;
}

function createFakeAdapter(opts: FakeAdapterOptions = {}): FakeAdapter {
  const bundleCalls: string[] = [];
  const lockCalls: string[] = [];
  const writeCalls: FakeAdapter["writeCalls"] = [];
  const deleteCalls: FakeAdapter["deleteCalls"] = [];
  const requestReplyCalls: FakeAdapter["requestReplyCalls"] = [];
  const scrollCardCalls: FakeAdapter["scrollCardCalls"] = [];
  const scrollRowCalls: FakeAdapter["scrollRowCalls"] = [];
  const scrollComposerCalls: FakeAdapter["scrollComposerCalls"] = [];
  const scrollPickerCalls: number[] = [];
  const revealFileCalls: string[] = [];
  const mirrorTourCalls: string[] = [];
  const mirrorAnnCalls: Array<string | null> = [];
  const subscriptions: FakeAdapter["subscriptions"] = [];

  const adapter: FakeAdapter = {
    bundleCalls,
    lockCalls,
    writeCalls,
    deleteCalls,
    requestReplyCalls,
    scrollCardCalls,
    scrollRowCalls,
    scrollComposerCalls,
    scrollPickerCalls,
    revealFileCalls,
    mirrorTourCalls,
    mirrorAnnCalls,
    subscriptions,
    fetchBundle: async (id) => {
      bundleCalls.push(id);
      if (opts.fetchBundleError) throw new Error("transport");
      return opts.bundleByTour?.[id] ?? okBundle(id);
    },
    fetchReplyLock: async (id) => {
      lockCalls.push(id);
      if (opts.fetchReplyLockError) throw new Error("transport");
      return opts.lockByTour?.[id] ?? null;
    },
    writeComment: async (tourId, input) => {
      writeCalls.push({ tourId, input });
      if (opts.writeCommentError) throw new Error(opts.writeCommentError);
      return opts.writeCommentResult ?? {
        id: "a-new",
        file: input.kind === "top-level" ? input.file : input.parent.file,
        side: input.kind === "top-level" ? input.side : input.parent.side,
        line_start: input.kind === "top-level" ? input.line_start : input.parent.line_start,
        line_end: input.kind === "top-level" ? input.line_end : input.parent.line_end,
        body: input.body,
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
        ...(input.kind === "reply" ? { replies_to: input.parent.id } : {}),
      };
    },
    deleteComment: async ({ tourId, targetId }) => {
      deleteCalls.push({ tourId, targetId });
      if (opts.deleteCommentError) throw new Error(opts.deleteCommentError);
    },
    requestReply: async ({ tourId, commentId }) => {
      requestReplyCalls.push({ tourId, commentId });
      if (opts.requestReplyError) throw new Error(opts.requestReplyError);
    },
    subscribeTourEvents: (tourId, handler) => {
      const entry = { tourId, handler, unsubscribed: false };
      subscriptions.push(entry);
      return () => {
        entry.unsubscribed = true;
      };
    },
    scrollToCard: (id, mode, behavior) => {
      scrollCardCalls.push({ id, mode, behavior });
    },
    scrollToRow: (anchor, mode, behavior) => {
      scrollRowCalls.push({ anchor, mode, behavior });
    },
    scrollToComposer: (target) => {
      scrollComposerCalls.push(target);
    },
    scrollToPickerRow: (idx) => {
      scrollPickerCalls.push(idx);
    },
    revealFileInSidebar: (file) => {
      revealFileCalls.push(file);
    },
    mirrorTourUrl: (id) => {
      mirrorTourCalls.push(id);
    },
    mirrorAnnUrl: (id) => {
      mirrorAnnCalls.push(id);
    },
    emit(tourId, event) {
      for (const sub of subscriptions) {
        if (sub.tourId === tourId && !sub.unsubscribed) sub.handler(event);
      }
    },
  };
  return adapter;
}

function storeWithTour(tourId: string | null): TourSessionStore {
  const initial: TourSessionState = {
    ...initialTourSessionState(),
    currentTourId: tourId,
  };
  return new TourSessionStore(initial);
}

// Resolves after all currently-pending microtasks settle. `runtime` fires
// `fetchBundle` / `fetchReplyLock` inside the watcher handler — the await
// chain (fetch → dispatch) needs two microtask ticks to flush.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("TourSessionRuntime", () => {
  describe("start()", () => {
    it("subscribes to adapter.subscribeTourEvents for the current tour", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      expect(adapter.subscriptions.length).toBe(1);
      expect(adapter.subscriptions[0].tourId).toBe("tour-a");
      stop();
    });

    it("does not subscribe when currentTourId is null", () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      expect(adapter.subscriptions.length).toBe(0);
      stop();
    });

    it("returns a teardown that unsubscribes from the current tour subscription", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      expect(adapter.subscriptions[0].unsubscribed).toBe(false);
      stop();
      expect(adapter.subscriptions[0].unsubscribed).toBe(true);
    });
  });

  describe("comment-changed event", () => {
    it("calls adapter.fetchBundle and dispatches bundle.refreshed with the fresh bundle", async () => {
      const store = storeWithTour("tour-a");
      const fresh = okBundle("tour-a");
      const adapter = createFakeAdapter({ bundleByTour: { "tour-a": fresh } });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "comment-changed" });
      await flush();

      expect(adapter.bundleCalls).toEqual(["tour-a"]);
      expect(store.getState().bundle).toEqual({ kind: "ok", value: fresh });
      stop();
    });

    it("does NOT refetch the reply-lock (web-parity — lock changes flow through reply-* events)", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "comment-changed" });
      await flush();

      expect(adapter.lockCalls).toEqual([]);
      stop();
    });

    it("swallows fetchBundle errors (transient — keeps current bundle)", async () => {
      const store = storeWithTour("tour-a");
      // Seed bundle slice with an existing bundle so the dispatch state is observable.
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: snapshotLostBundle("tour-a"),
      });
      const adapter = createFakeAdapter({ fetchBundleError: true });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "comment-changed" });
      await flush();

      expect(adapter.bundleCalls).toEqual(["tour-a"]);
      // No state churn — bundle slice unchanged from the seed.
      expect(store.getState().bundle).toEqual({
        kind: "ok",
        value: snapshotLostBundle("tour-a"),
      });
      stop();
    });

    it("drops the dispatch when the current tour has changed before the fetch resolves", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      let resolveBundle: ((b: TourBundle) => void) | null = null;
      adapter.fetchBundle = (id) => {
        adapter.bundleCalls.push(id);
        return new Promise<TourBundle>((resolve) => {
          resolveBundle = resolve;
        });
      };

      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "comment-changed" });
      // Switch to tour-b before tour-a's fetch resolves.
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-b",
        bundle: snapshotLostBundle("tour-b"),
      });
      // Now resolve tour-a's bundle.
      resolveBundle?.(okBundle("tour-a"));
      await flush();

      // The store's bundle slice still reflects tour-b — the stale tour-a
      // bundle dispatch was dropped.
      expect(store.getState().bundle).toEqual({
        kind: "ok",
        value: snapshotLostBundle("tour-b"),
      });
      stop();
    });
  });

  describe("reply-in-flight / reply-cleared events", () => {
    it("calls adapter.fetchReplyLock and dispatches replyLock.loaded on reply-in-flight", async () => {
      const store = storeWithTour("tour-a");
      const lock: ReplyLock = {
        agent: "x",
        responding_to: "a1",
        started_at: "2026-05-14T00:00:00Z",
        pid: 1,
      };
      const adapter = createFakeAdapter({ lockByTour: { "tour-a": lock } });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "reply-in-flight" });
      await flush();

      expect(adapter.lockCalls).toEqual(["tour-a"]);
      expect(store.getState().replyLock).toEqual({ kind: "ok", value: lock });
      stop();
    });

    it("calls adapter.fetchReplyLock and dispatches replyLock.loaded(null) on reply-cleared", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter({ lockByTour: { "tour-a": null } });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "reply-cleared" });
      await flush();

      expect(adapter.lockCalls).toEqual(["tour-a"]);
      expect(store.getState().replyLock).toEqual({ kind: "ok", value: null });
      stop();
    });

    it("does NOT refetch the bundle on reply-* events", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "reply-in-flight" });
      adapter.emit("tour-a", { type: "reply-cleared" });
      await flush();

      expect(adapter.bundleCalls).toEqual([]);
      stop();
    });

    it("swallows fetchReplyLock errors", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter({ fetchReplyLockError: true });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "reply-in-flight" });
      await flush();

      expect(adapter.lockCalls).toEqual(["tour-a"]);
      // No churn — replyLock stayed idle.
      expect(store.getState().replyLock).toEqual({ kind: "idle" });
      stop();
    });
  });

  describe("tour-switch re-subscription", () => {
    it("unsubscribes from the previous tour and subscribes to the new tour when currentTourId changes", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      expect(adapter.subscriptions.length).toBe(1);
      expect(adapter.subscriptions[0].tourId).toBe("tour-a");
      expect(adapter.subscriptions[0].unsubscribed).toBe(false);

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-b",
        bundle: snapshotLostBundle("tour-b"),
      });

      expect(adapter.subscriptions.length).toBe(2);
      expect(adapter.subscriptions[0].unsubscribed).toBe(true);
      expect(adapter.subscriptions[1].tourId).toBe("tour-b");
      expect(adapter.subscriptions[1].unsubscribed).toBe(false);
      stop();
    });

    it("does not re-subscribe when other state changes (only tourId matters)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      const before = adapter.subscriptions.length;
      store.dispatch({
        type: "bundle.refreshed",
        bundle: snapshotLostBundle("tour-a"),
      });

      expect(adapter.subscriptions.length).toBe(before);
      stop();
    });

    it("subscribes when currentTourId transitions from null to non-null", () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      expect(adapter.subscriptions.length).toBe(0);

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: snapshotLostBundle("tour-a"),
      });

      expect(adapter.subscriptions.length).toBe(1);
      expect(adapter.subscriptions[0].tourId).toBe("tour-a");
      stop();
    });
  });

  describe("loadTour intent (PRD #278 slice 3)", () => {
    it("calls adapter.fetchBundle, dispatches tour.switched, then fetches reply-lock and dispatches replyLock.loaded", async () => {
      const store = storeWithTour(null);
      const fresh = okBundle("tour-a");
      const lock: ReplyLock = {
        agent: "x",
        responding_to: "a1",
        started_at: "2026-05-14T00:00:00Z",
        pid: 1,
      };
      const adapter = createFakeAdapter({
        bundleByTour: { "tour-a": fresh },
        lockByTour: { "tour-a": lock },
      });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "bundle.loading", tourId: "tour-a" });
      await flush();

      expect(adapter.bundleCalls).toEqual(["tour-a"]);
      expect(adapter.lockCalls).toEqual(["tour-a"]);
      expect(store.getState().bundle).toEqual({ kind: "ok", value: fresh });
      expect(store.getState().currentTourId).toBe("tour-a");
      expect(store.getState().replyLock).toEqual({ kind: "ok", value: lock });
      stop();
    });

    it("dispatches bundle.failed on fetchBundle rejection and does NOT fetch reply-lock", async () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter({ fetchBundleError: true });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "bundle.loading", tourId: "tour-a" });
      await flush();

      expect(adapter.bundleCalls).toEqual(["tour-a"]);
      expect(adapter.lockCalls).toEqual([]);
      expect(store.getState().bundle).toEqual({ kind: "err", error: "transport" });
      stop();
    });

    it("swallows fetchReplyLock errors (transient — keeps current pill state)", async () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter({
        bundleByTour: { "tour-a": okBundle("tour-a") },
        fetchReplyLockError: true,
      });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "bundle.loading", tourId: "tour-a" });
      await flush();

      expect(adapter.lockCalls).toEqual(["tour-a"]);
      // Reply-lock fetch error → keep current pill state. The tour-switched
      // cascade already reset replyLock to idle; the failure leaves it there.
      expect(store.getState().replyLock).toEqual({ kind: "idle" });
      stop();
    });

    it("stale-response guard: drops tour.switched when the user has moved to a different tour", async () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter();
      let resolveBundle: ((b: TourBundle) => void) | null = null;
      adapter.fetchBundle = (id) => {
        adapter.bundleCalls.push(id);
        return new Promise<TourBundle>((resolve) => {
          resolveBundle = resolve;
        });
      };
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "bundle.loading", tourId: "tour-a" });
      // Switch to tour-b before tour-a's fetch resolves.
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-b",
        bundle: snapshotLostBundle("tour-b"),
      });
      // Now resolve tour-a's bundle.
      resolveBundle?.(okBundle("tour-a"));
      await flush();

      // Bundle slice still reflects tour-b — stale tour.switched dispatch dropped.
      expect(store.getState().bundle).toEqual({
        kind: "ok",
        value: snapshotLostBundle("tour-b"),
      });
      // The runtime followed the tour-switched store change and started a
      // new subscription for tour-b. Reply-lock fetches that fired before
      // the switch are NOT for tour-a (the runtime guards with the live
      // currentTourId).
      stop();
    });

    it("stale-response guard: drops bundle.failed when the user has moved to a different tour", async () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter();
      let rejectBundle: ((err: Error) => void) | null = null;
      adapter.fetchBundle = (id) => {
        adapter.bundleCalls.push(id);
        return new Promise<TourBundle>((_resolve, reject) => {
          rejectBundle = reject;
        });
      };
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "bundle.loading", tourId: "tour-a" });
      // Switch to tour-b before tour-a's fetch rejects.
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-b",
        bundle: snapshotLostBundle("tour-b"),
      });
      rejectBundle?.(new Error("late-failure"));
      await flush();

      // Bundle slice still reflects tour-b — stale bundle.failed dispatch dropped.
      expect(store.getState().bundle).toEqual({
        kind: "ok",
        value: snapshotLostBundle("tour-b"),
      });
      stop();
    });

    it("stale-response guard: drops replyLock.loaded when tour has changed before the lock fetch resolves", async () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter({
        bundleByTour: { "tour-a": okBundle("tour-a") },
      });
      const lock: ReplyLock = {
        agent: "x",
        responding_to: "a1",
        started_at: "2026-05-14T00:00:00Z",
        pid: 1,
      };
      let resolveLock: ((l: ReplyLock | null) => void) | null = null;
      adapter.fetchReplyLock = (id) => {
        adapter.lockCalls.push(id);
        return new Promise<ReplyLock | null>((resolve) => {
          resolveLock = resolve;
        });
      };
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "bundle.loading", tourId: "tour-a" });
      // Let fetchBundle resolve and tour.switched dispatch run.
      await Promise.resolve();
      await Promise.resolve();
      // Switch tours before the reply-lock fetch resolves.
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-b",
        bundle: snapshotLostBundle("tour-b"),
      });
      // Now resolve tour-a's reply-lock.
      resolveLock?.(lock);
      await flush();

      // Reply-lock for tour-a was dropped — tour-b's slice is still idle
      // (from the tour-switched reset) modulo whatever the runtime's
      // tour-b reply-lock fetch yields. Since we haven't supplied a lock
      // for tour-b, it resolves to null after the fetch.
      // The key assertion: the tour-a lock did NOT clobber tour-b state.
      expect(store.getState().replyLock).not.toEqual({ kind: "ok", value: lock });
      stop();
    });
  });

  describe("submitComment intent (PRD #278 slice 4)", () => {
    function commentFixture(id: string, overrides: Partial<Comment> = {}): Comment {
      return {
        id,
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "parent body",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
        ...overrides,
      };
    }

    function seedTour(store: TourSessionStore, bundle: TourBundle): void {
      store.dispatch({
        type: "tour.switched",
        tourId: bundle.tour.id,
        bundle,
      });
    }

    it("calls adapter.writeComment with the built input and dispatches composer.submitted on success", async () => {
      const store = storeWithTour(null);
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      seedTour(store, bundle);

      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "hello world" });
      store.dispatch({ type: "composer.submit" });
      await flush();

      expect(adapter.writeCalls.length).toBe(1);
      expect(adapter.writeCalls[0].tourId).toBe("tour-a");
      expect(adapter.writeCalls[0].input).toMatchObject({
        kind: "top-level",
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "hello world",
      });
      expect(store.getState().composer).toEqual({ kind: "closed" });
      stop();
    });

    it("resolves the reply parent from the live bundle and passes it through writeComment", async () => {
      const store = storeWithTour(null);
      const parent = commentFixture("p1");
      const bundle = okBundle("tour-a", [parent]);
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      seedTour(store, bundle);

      store.dispatch({
        type: "composer.open",
        target: { kind: "reply", replies_to: "p1" },
      });
      store.dispatch({ type: "composer.setBody", body: "a reply" });
      store.dispatch({ type: "composer.submit" });
      await flush();

      expect(adapter.writeCalls.length).toBe(1);
      const input = adapter.writeCalls[0].input;
      expect(input.kind).toBe("reply");
      if (input.kind === "reply") {
        expect(input.parent).toEqual(parent);
        expect(input.body).toBe("a reply");
      }
      expect(store.getState().composer).toEqual({ kind: "closed" });
      stop();
    });

    it("dispatches composer.failed with the error message on writeComment rejection", async () => {
      const store = storeWithTour(null);
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter({ writeCommentError: "disk full" });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      seedTour(store, bundle);

      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "hi" });
      store.dispatch({ type: "composer.submit" });
      await flush();

      const composer = store.getState().composer;
      expect(composer.kind).toBe("errored");
      if (composer.kind === "errored") {
        expect(composer.error).toBe("disk full");
        expect(composer.body).toBe("hi");
      }
      stop();
    });

    it("treats whitespace-only body as composer.close — does NOT call writeComment", async () => {
      const store = storeWithTour(null);
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      seedTour(store, bundle);

      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "   \n  " });
      store.dispatch({ type: "composer.submit" });
      await flush();

      expect(adapter.writeCalls.length).toBe(0);
      expect(store.getState().composer).toEqual({ kind: "closed" });
      stop();
    });

    it("dispatches composer.failed when the live bundle is no longer resolved", async () => {
      const store = storeWithTour(null);
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      seedTour(store, bundle);

      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "hello" });
      // Bundle drops out from under the composer (mid-composition watcher race).
      store.dispatch({ type: "bundle.failed", tourId: "tour-a", error: "lost" });
      store.dispatch({ type: "composer.submit" });
      await flush();

      expect(adapter.writeCalls.length).toBe(0);
      const composer = store.getState().composer;
      expect(composer.kind).toBe("errored");
      if (composer.kind === "errored") {
        expect(composer.error).toBe("Tour bundle is no longer loaded");
      }
      stop();
    });

    it("dispatches composer.failed when the reply parent no longer exists in the live bundle", async () => {
      const store = storeWithTour(null);
      // Bundle has no comments, so the reply parent lookup will miss.
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      seedTour(store, bundle);

      store.dispatch({
        type: "composer.open",
        target: { kind: "reply", replies_to: "vanished" },
      });
      store.dispatch({ type: "composer.setBody", body: "hi" });
      store.dispatch({ type: "composer.submit" });
      await flush();

      expect(adapter.writeCalls.length).toBe(0);
      const composer = store.getState().composer;
      expect(composer.kind).toBe("errored");
      if (composer.kind === "errored") {
        expect(composer.error).toBe("Parent comment no longer exists");
      }
      stop();
    });
  });

  describe("applyPostSubmitLanding intent (issue #392 + #405)", () => {
    // Issue #322 keeps its goal — the freshly-created Comment lands in the
    // bundle before the SSE-driven `bundle.refreshed` round-trip. Issue #392
    // changes *how*: the fold no longer happens in the same render cycle as
    // the composer-overlay unmount. Issue #405 unifies the cursor landing
    // with the fold so the cursor never sits on a Comment id missing from
    // bundle.comments. The reducer emits `applyPostSubmitLanding`; the
    // runtime defers via a short timer (empirically 50 ms — see the
    // runtime comment for why microtask / setTimeout(0) are insufficient)
    // and dispatches `bundle.commentInsertedWithLanding` in a later
    // commit. The heightful CommentRow add + cursor write lands after
    // opentui has reflowed the composer-close commit.
    it("defers the bundle fold + cursor landing via a timer so the composer-close commit lands first", async () => {
      const store = storeWithTour(null);
      const ann: Comment = {
        id: "a-new",
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "fresh",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
      };
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter({ writeCommentResult: ann });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle });

      // Capture every state ref the store hands to listeners — each
      // distinct ref maps 1:1 to a React commit.
      const commits: Array<{ composerKind: string; commentIds: string[] }> = [];
      store.subscribe(() => {
        const st = store.getState();
        const b = isBundleResolved(st);
        commits.push({
          composerKind: st.composer.kind,
          commentIds: b ? b.comments.map((a) => a.id) : [],
        });
      });

      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "x" });
      store.dispatch({ type: "composer.submit" });
      // One microtask is enough to flush the writeComment promise →
      // composer.submitted dispatch. The bundle fold has NOT landed yet —
      // it was scheduled on a 50ms timer one further hop away.
      await Promise.resolve();

      const afterSubmittedCommit = commits[commits.length - 1];
      expect(afterSubmittedCommit.composerKind).toBe("closed");
      expect(afterSubmittedCommit.commentIds).not.toContain("a-new");

      // Drain the deferred timer. The bundle.commentInserted dispatch
      // fires and the freshly-created comment lands in the bundle.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterFoldCommit = commits[commits.length - 1];
      expect(afterFoldCommit.composerKind).toBe("closed");
      expect(afterFoldCommit.commentIds).toContain("a-new");

      stop();
    });

    it("does not fold when the bundle is no longer resolved (post-submit watcher race)", async () => {
      const store = storeWithTour(null);
      const ann: Comment = {
        id: "a-orphan",
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "fresh",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
      };
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter({ writeCommentResult: ann });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle });

      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "x" });
      store.dispatch({ type: "composer.submit" });
      // After writeComment resolves but before the deferred timer fires,
      // the bundle slice drops out (e.g. a watcher race re-classified the
      // tour as failed). The deferred fold must be a no-op rather than
      // crash on the non-ok bundle.
      await Promise.resolve();
      store.dispatch({ type: "bundle.failed", tourId: "tour-a", error: "lost" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(store.getState().bundle).toEqual({ kind: "err", error: "lost" });
      stop();
    });
  });

  describe("structural cursor validity across bundle.refreshed (issue #413 / PRD #412)", () => {
    function commentOnA(id: string): Comment {
      return {
        id,
        file: "a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "body",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
      };
    }

    function cardCursor(commentId: string): Cursor {
      return { kind: "card", commentId, preferredSide: "additions" };
    }

    function rowCursor(file: string, lineNumber: number): Cursor {
      return {
        kind: "row",
        file,
        lineNumber,
        side: "additions",
        preferredSide: "additions",
      };
    }

    it("clears a stale CardAnchor when the refreshed bundle drops its comment", () => {
      const store = storeWithTour("tour-a");
      const initialBundle = bundleWithFileA("tour-a", [commentOnA("t1")]);
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle: initialBundle });
      store.dispatch({ type: "cursor.set", anchor: cardCursor("t1") });
      expect(store.getState().cursor).toEqual(cardCursor("t1"));

      // Refresh the bundle with t1 removed. The reducer owns structural
      // validation now, so the cursor is cleared by the bundle.refreshed
      // transition itself.
      store.dispatch({
        type: "bundle.refreshed",
        bundle: bundleWithFileA("tour-a", []),
      });

      expect(store.getState().cursor).toBeNull();
      stop();
    });

    it("snaps a RowAnchor to the file's first row when bundle.refreshed keeps the file but reshapes the row away", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: bundleWithFileA("tour-a"),
      });
      // RowAnchor at a line the diff doesn't have. Structural validation
      // keeps it through bundle.refreshed because a.ts remains in the
      // bundle; the emitted revalidateCursor intent then runs projection
      // validation and dispatches the snapped cursor back into state.
      store.dispatch({ type: "cursor.set", anchor: rowCursor("a.ts", 999) });
      adapter.scrollRowCalls.length = 0;

      store.dispatch({
        type: "bundle.refreshed",
        bundle: bundleWithFileA("tour-a"),
      });

      const next = store.getState().cursor;
      expect(next).toEqual({
        kind: "row",
        file: "a.ts",
        lineNumber: 1,
        side: "deletions",
        preferredSide: "additions",
      });
      const view = deriveTourSessionView(bundleWithFileA("tour-a"), store.getState());
      expect(view.kind).toBe("ok");
      if (view.kind !== "ok") throw new Error("unreachable");
      expect(store.getState().cursor).toEqual(view.cursor.anchor);
      expect(adapter.scrollRowCalls).toEqual([
        {
          anchor: {
            kind: "row",
            file: "a.ts",
            side: "deletions",
            lineNumber: 1,
          },
          mode: "nearest",
          behavior: "smooth",
        },
      ]);
      stop();
    });

    it("does not dispatch when the cursor anchor is still valid (same-ref short-circuit)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: bundleWithFileA("tour-a"),
      });
      // RowAnchor at a line the diff DOES have (line 1).
      const anchor = rowCursor("a.ts", 1);
      store.dispatch({ type: "cursor.set", anchor });
      const before = store.getState().cursor;

      // Count subsequent dispatches by snapshotting state ref before / after
      // bundle.refreshed. validateCursor returns the same anchor ref, so the
      // runtime's `validated === cursor` short-circuit fires — no dispatch,
      // cursor slice stays referentially equal.
      store.dispatch({
        type: "bundle.refreshed",
        bundle: bundleWithFileA("tour-a"),
      });

      expect(store.getState().cursor).toBe(before);
      stop();
    });
  });

  describe("collapsed-file cursor traversal (issue #309 + issue #310 split)", () => {
    // A bun.lock-style classifier-collapsed file with a real one-hunk diff
    // body. With `classification.collapsed === true` the planner emits a
    // single synthetic `collapsed-file` interactive row in place of the
    // file's body; clearing the override re-emits the body.
    const COLLAPSED_DIFF = `diff --git a/bun.lock b/bun.lock
--- a/bun.lock
+++ b/bun.lock
@@ -1,1 +1,2 @@
 keep
+added
`;

    function collapsedFileBundle(id: string): TourBundle {
      const file: BundleFile = {
        name: "bun.lock",
        type: "change",
        hunks: [
          {
            additionStart: 1,
            additionCount: 2,
            deletionStart: 1,
            deletionCount: 1,
            content: [],
          },
        ],
        oldContent: "keep\n",
        newContent: "keep\nadded\n",
        classification: { collapsed: true, reason: "generated" },
        orphanWindows: [],
      };
      return {
        kind: "ok",
        tour: tour(id),
        comments: [],
        diff: COLLAPSED_DIFF,
        files: [file],
      };
    }

    it("cursor.set onto the synthetic collapsed-file anchor leaves state.cursor on the synthetic row and does NOT clear collapsedOverrides (issue #310)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: collapsedFileBundle("tour-a"),
      });

      // Simulate `j` landing on bun.lock's collapsed-file row: the surface
      // dispatches a `cursor.set` with a synthetic interactive anchor.
      const syntheticAnchor: Cursor = {
        kind: "row",
        file: "bun.lock",
        lineNumber: 0,
        side: "additions",
        preferredSide: "additions",
        interactive: { subKind: "collapsed-file", boundaryRef: "top" },
      };
      store.dispatch({ type: "cursor.set", anchor: syntheticAnchor });

      // After the issue #310 split, the cursor.set emits `selectSidebarFile`
      // (sidebar-select only) — NOT `revealSidebarFile`. The runtime no
      // longer dispatches `folds.setOverride { value: false }`, so the
      // planner keeps emitting the synthetic `collapsed-file` row and
      // state.cursor remains anchored to it. The user's `j` press
      // expressed "advance one stop", not "uncollapse this entire file."
      const cursor = store.getState().cursor;
      expect(cursor).toBe(syntheticAnchor);
      if (cursor === null || cursor.kind !== "row") throw new Error("unreachable");
      expect(cursor.file).toBe("bun.lock");
      // The synthetic collapsed-file row is still the anchor — Enter on
      // this row stays the explicit-reveal escape hatch (existing #280 /
      // #306 wiring).
      expect(cursor.interactive?.subKind).toBe("collapsed-file");
      // The classifier-collapse contract is preserved: no override entry
      // is written, so isClassifierCollapsed still returns true and the
      // file body stays hidden.
      expect("bun.lock" in store.getState().collapsedOverrides).toBe(false);
      stop();
    });

    it("cursor.set onto the synthetic anchor leaves the cursor resolvable in flatRows (no ghost cursor: j/k can step off the synthetic row)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: collapsedFileBundle("tour-a"),
      });
      const syntheticAnchor: Cursor = {
        kind: "row",
        file: "bun.lock",
        lineNumber: 0,
        side: "additions",
        preferredSide: "additions",
        interactive: { subKind: "collapsed-file", boundaryRef: "top" },
      };
      store.dispatch({ type: "cursor.set", anchor: syntheticAnchor });

      // The synthetic row is the SOLE row emitted for bun.lock when the
      // file is classifier-collapsed; it IS a walkable interactive row, so
      // the cursor resolves and a subsequent `j`/`k` advances normally to
      // the next file's first walkable row — no silent no-op.
      const state = store.getState();
      const bundle = isBundleResolved(state);
      if (bundle === null || bundle.kind !== "ok") throw new Error("unreachable");
      const view = deriveTourSessionView(bundle, state);
      if (view.kind !== "ok") throw new Error("unreachable");
      expect(view.cursor.rowIdx).toBeGreaterThanOrEqual(0);
      stop();
    });

    it("manual `c` toggle (user-folded file) survives cursor traversal — same rule as classifier-collapse (issue #310 AC)", () => {
      // The split rule applies to user-folded files too: a `j` traversal
      // into a file the user previously hid with `c` must not silently
      // un-hide it. The override entry stays true, the file body stays
      // hidden, and the cursor lands on whatever anchor the surface
      // dispatched.
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: collapsedFileBundle("tour-a"),
      });
      // User manually folds bun.lock with `c` — distinct from
      // classifier-collapse since this is an explicit user override.
      store.dispatch({ type: "folds.setOverride", file: "bun.lock", value: true });
      expect(store.getState().collapsedOverrides["bun.lock"]).toBe(true);

      // `j` lands the cursor on the file's anchor. With the split, no
      // implicit unfold fires; the override stays at true.
      const anchor: Cursor = {
        kind: "row",
        file: "bun.lock",
        lineNumber: 1,
        side: "additions",
        preferredSide: "additions",
      };
      store.dispatch({ type: "cursor.set", anchor });

      expect(store.getState().collapsedOverrides["bun.lock"]).toBe(true);
      stop();
    });

    it("cursor.set into a non-collapsed file does not double-dispatch cursor.set (regression guard)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: bundleWithFileA("tour-a"),
      });
      // The same-ref short-circuit in handleRevalidateCursor means a
      // re-validation that yields the same anchor does NOT dispatch a
      // second cursor.set. We measure that by tracking scrollToRow calls:
      // every cursor.set on a row anchor emits scrollCursorTarget which
      // routes to scrollToRow. A double-dispatch would show 2 calls.
      adapter.scrollRowCalls.length = 0;
      store.dispatch({
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "a.ts",
          lineNumber: 1,
          side: "additions",
          preferredSide: "additions",
        },
      });
      expect(adapter.scrollRowCalls.length).toBe(1);
      stop();
    });
  });

  describe("scroll / mirror / reveal intents (PRD #278 slice 6)", () => {
    it("scrollPickerRow intent → adapter.scrollToPickerRow", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      // `picker.move` emits scrollPickerRow with the clamped cursor index.
      store.dispatch({
        type: "picker.open",
        rows: [
          { id: "tour-a", title: "A", status: "open", glyph: "●", age: "now", commentCount: 0 },
          { id: "tour-b", title: "B", status: "open", glyph: "●", age: "now", commentCount: 0 },
        ],
      });
      store.dispatch({ type: "picker.move", delta: 1 });

      expect(adapter.scrollPickerCalls).toEqual([1]);
      stop();
    });

    it("scrollCursorTarget intent (kind=card) → adapter.scrollToCard with placement", () => {
      const store = storeWithTour(null);
      const ann: Comment = {
        id: "ann1",
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "x",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
      };
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: okBundle("tour-a", [ann]),
      });
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "cursor.set",
        anchor: { kind: "card", commentId: "ann1", preferredSide: "additions" },
        placement: "center",
      });

      expect(adapter.scrollCardCalls).toEqual([
        { id: "ann1", mode: "center", behavior: "instant" },
      ]);
      expect(adapter.scrollRowCalls).toEqual([]);
      stop();
    });

    it("scrollCursorTarget intent (kind=row) → adapter.scrollToRow with the row anchor, placement, and behavior", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "src/a.ts",
          side: "additions",
          lineNumber: 7,
          preferredSide: "additions",
        },
      });

      expect(adapter.scrollRowCalls).toEqual([
        {
          anchor: { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
          mode: "nearest",
          behavior: "smooth",
        },
      ]);
      expect(adapter.scrollCardCalls).toEqual([]);
      stop();
    });

    it("post-submit deferred dispatch routes to adapter.scrollToCard(id, 'center', 'instant') (issue #401 + #405)", async () => {
      const store = storeWithTour(null);
      const ann: Comment = {
        id: "a-new",
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "fresh",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
      };
      const bundle = okBundle("tour-a", [ann]);
      const adapter = createFakeAdapter({ writeCommentResult: ann });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle });

      // Issue #405: composer.submitted no longer emits scrollCursorTarget
      // synchronously — the cursor write and the bundle fold land
      // atomically on the deferred `bundle.commentInsertedWithLanding`
      // action (~50 ms after submit). The deferred dispatch's setCursor
      // call emits scrollCursorTarget, which the runtime routes to
      // adapter.scrollToCard(id, "center", "instant").
      store.dispatch({
        type: "composer.open",
        target: {
          kind: "top-level",
          file: "src/a.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
        },
      });
      store.dispatch({ type: "composer.setBody", body: "x" });
      store.dispatch({ type: "composer.submit" });
      store.dispatch({ type: "composer.submitted", comment: ann });

      // No synchronous adapter call — the cursor landing is deferred.
      expect(
        adapter.scrollCardCalls.filter((c) => c.id === "a-new" && c.mode === "center"),
      ).toEqual([]);

      // Drain the 50 ms timer; the deferred-landing dispatch fires and
      // the adapter is now called.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(
        adapter.scrollCardCalls.filter((c) => c.id === "a-new" && c.mode === "center"),
      ).toEqual([{ id: "a-new", mode: "center", behavior: "instant" }]);
      stop();
    });

    it("scrollToComposer intent (composer.recall, top-level) → adapter.scrollToComposer(target) (#320)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      const target: ComposerTarget = {
        kind: "top-level",
        file: "src/a.ts",
        side: "additions",
        line_start: 42,
        line_end: 42,
      };
      store.dispatch({ type: "composer.open", target });
      store.dispatch({ type: "composer.recall" });
      expect(adapter.scrollComposerCalls).toEqual([target]);
      // Composer state is unchanged by recall — still `open` at the same target.
      expect(store.getState().composer).toEqual({ kind: "open", target, body: "" });
      stop();
    });

    it("scrollToComposer intent (composer.recall, reply) → adapter.scrollToComposer(target) (#320)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      const target: ComposerTarget = { kind: "reply", replies_to: "ann-99" };
      store.dispatch({ type: "composer.open", target });
      store.dispatch({ type: "composer.recall" });
      expect(adapter.scrollComposerCalls).toEqual([target]);
      stop();
    });

    it("composer.recall while closed dispatches no scrollToComposer (#320)", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({ type: "composer.recall" });
      expect(adapter.scrollComposerCalls).toEqual([]);
      stop();
    });

    it("mirrorUrl intent → adapter.mirrorTourUrl(tourId)", () => {
      const store = storeWithTour(null);
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      // picker.commit emits both loadTour AND mirrorUrl.
      store.dispatch({
        type: "picker.open",
        rows: [
          { id: "tour-a", title: "A", status: "open", glyph: "●", age: "now", commentCount: 0 },
        ],
      });
      store.dispatch({ type: "picker.commit" });

      expect(adapter.mirrorTourCalls).toEqual(["tour-a"]);
      stop();
    });

    it("mirrorAnnUrl intent → adapter.mirrorAnnUrl(commentId)", () => {
      const store = storeWithTour(null);
      const ann: Comment = {
        id: "ann1",
        file: "src/a.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "x",
        author: "human",
        author_kind: "human",
        created_at: "2026-05-14T00:00:00Z",
      };
      store.dispatch({
        type: "tour.switched",
        tourId: "tour-a",
        bundle: okBundle("tour-a", [ann]),
      });
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "cursor.set",
        anchor: { kind: "card", commentId: "ann1", preferredSide: "additions" },
      });
      // Clearing the cursor with a card anchor present emits mirrorAnnUrl(null).
      store.dispatch({ type: "cursor.clear" });

      expect(adapter.mirrorAnnCalls).toEqual(["ann1", null]);
      stop();
    });

    it("requestReply intent → adapter.requestReply with { tourId, commentId }", () => {
      // send-to-agent (PRD #278 slice 7) is the reducer's entry point;
      // the runtime listens for the emitted requestReply intent and routes
      // it to the adapter. The auto-recall scrollCursorTarget intent fires
      // as a sibling — both are dispatched in order.
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({
        type: "cursor.set",
        anchor: { kind: "card", commentId: "root", preferredSide: "additions" },
      });

      store.dispatch({
        type: "send-to-agent",
        tourId: "tour-a",
        commentId: "leaf",
      });

      expect(adapter.requestReplyCalls).toEqual([
        { tourId: "tour-a", commentId: "leaf" },
      ]);
      // Auto-recall: the runtime also scrolled the focused card to centre
      // before dispatching. Filter to send-to-agent's recall (cursor.set
      // earlier in the test also emitted a card scroll with placement
      // "nearest"); the auto-recall is the "center" one.
      expect(
        adapter.scrollCardCalls.filter((c) => c.id === "root" && c.mode === "center"),
      ).toEqual([{ id: "root", mode: "center", behavior: "instant" }]);
      stop();
    });

    it("requestReply intent is fire-and-forget — adapter rejection does not throw to the store", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter({ requestReplyError: "transient" });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({
        type: "cursor.set",
        anchor: { kind: "card", commentId: "root", preferredSide: "additions" },
      });

      expect(() =>
        store.dispatch({
          type: "send-to-agent",
          tourId: "tour-a",
          commentId: "leaf",
        }),
      ).not.toThrow();
      // Drain the rejected promise so vitest's unhandled-rejection guard
      // doesn't fail the run.
      await flush();
      expect(adapter.requestReplyCalls).toEqual([
        { tourId: "tour-a", commentId: "leaf" },
      ]);
      stop();
    });

    it("send-to-agent on a null cursor is a no-op — no requestReply intent fired", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "send-to-agent",
        tourId: "tour-a",
        commentId: "leaf",
      });

      expect(adapter.requestReplyCalls).toEqual([]);
      expect(
        adapter.scrollCardCalls.filter((c) => c.mode === "center"),
      ).toEqual([]);
      stop();
    });

    it("selectSidebarFile intent → adapter.revealFileInSidebar without clearing collapsedOverrides (issue #310 split)", () => {
      const store = storeWithTour("tour-a");
      store.dispatch({
        type: "folds.setOverride",
        file: "src/a.ts",
        value: true,
      });
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      // `cursor.set` for a row anchor on a new file emits selectSidebarFile.
      // Pre-split this would dispatch `folds.setOverride { value: false }`
      // and uncollapse the file; the split keeps `collapsedOverrides`
      // untouched so cursor traversal honours the user's manual `c` toggle
      // and the classifier-collapse contract.
      store.dispatch({
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "src/a.ts",
          side: "additions",
          lineNumber: 1,
          preferredSide: "additions",
        },
      });

      expect(adapter.revealFileCalls).toEqual(["src/a.ts"]);
      // Override is preserved at its pre-cursor.set value (true) — the
      // intent no longer overwrites it to false.
      expect(store.getState().collapsedOverrides["src/a.ts"]).toBe(true);
      stop();
    });

    it("selectSidebarFile { file: null } does not call adapter.revealFileInSidebar", () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "src/a.ts",
          side: "additions",
          lineNumber: 1,
          preferredSide: "additions",
        },
      });
      adapter.revealFileCalls.length = 0;

      store.dispatch({ type: "cursor.clear" });

      expect(adapter.revealFileCalls).toEqual([]);
      stop();
    });
  });

  // ADR 0036 Slice D / issue #388 — deleteComment intent realisation.
  describe("deleteComment intent (ADR 0036 Slice D / issue #388)", () => {
    it("forwards deleteComment to adapter.deleteComment and dispatches deleteConfirm.succeeded on resolve", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "deleteConfirm.open", targetId: "ann-1" });
      store.dispatch({ type: "deleteConfirm.confirm" });
      expect(store.getState().deleteConfirm.kind).toBe("submitting");
      expect(adapter.deleteCalls).toEqual([{ tourId: "tour-a", targetId: "ann-1" }]);

      await flush();
      expect(store.getState().deleteConfirm).toEqual({ kind: "closed" });
      stop();
    });

    it("forwards deleteComment to adapter.deleteComment and dispatches deleteConfirm.failed on rejection", async () => {
      const store = storeWithTour("tour-a");
      const adapter = createFakeAdapter({ deleteCommentError: "no comment with id" });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      store.dispatch({ type: "deleteConfirm.open", targetId: "ghost" });
      store.dispatch({ type: "deleteConfirm.confirm" });
      await flush();

      expect(store.getState().deleteConfirm).toEqual({
        kind: "errored",
        targetId: "ghost",
        error: "no comment with id",
      });
      stop();
    });
  });
});
