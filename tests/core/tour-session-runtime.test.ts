import { describe, it, expect } from "vitest";
import {
  TourSessionStore,
  initialTourSessionState,
  type TourSessionState,
} from "../../src/core/tour-session.js";
import {
  TourSessionRuntime,
  type TourEvent,
  type TourEventHandler,
  type TourSessionAdapter,
} from "../../src/core/tour-session-runtime.js";
import type { TourBundle } from "../../src/core/tour-bundle.js";
import type { ReplyLock } from "../../src/core/reply-lock.js";
import type { Tour, Annotation } from "../../src/core/types.js";

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
  return { kind: "snapshot-lost", tour: tour(id), annotations: [] as Annotation[] };
}

function okBundle(id: string): TourBundle {
  return {
    kind: "ok",
    tour: tour(id),
    annotations: [] as Annotation[],
    diff: "",
    files: [],
  };
}

interface FakeAdapter extends TourSessionAdapter {
  bundleCalls: string[];
  lockCalls: string[];
  subscriptions: Array<{ tourId: string; handler: TourEventHandler; unsubscribed: boolean }>;
  emit(tourId: string, event: TourEvent): void;
}

interface FakeAdapterOptions {
  bundleByTour?: Record<string, TourBundle>;
  lockByTour?: Record<string, ReplyLock | null>;
  fetchBundleError?: boolean;
  fetchReplyLockError?: boolean;
}

function createFakeAdapter(opts: FakeAdapterOptions = {}): FakeAdapter {
  const bundleCalls: string[] = [];
  const lockCalls: string[] = [];
  const subscriptions: FakeAdapter["subscriptions"] = [];

  const adapter: FakeAdapter = {
    bundleCalls,
    lockCalls,
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
    writeAnnotation: async () => {
      throw new Error("not implemented");
    },
    requestReply: async () => {
      throw new Error("not implemented");
    },
    subscribeTourEvents: (tourId, handler) => {
      const entry = { tourId, handler, unsubscribed: false };
      subscriptions.push(entry);
      return () => {
        entry.unsubscribed = true;
      };
    },
    scrollToCard: () => {},
    scrollToRow: () => {},
    scrollToPickerRow: () => {},
    revealFileInSidebar: () => {},
    mirrorTourUrl: () => {},
    mirrorAnnUrl: () => {},
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

  describe("annotation-changed event", () => {
    it("calls adapter.fetchBundle and dispatches bundle.refreshed with the fresh bundle", async () => {
      const store = storeWithTour("tour-a");
      const fresh = okBundle("tour-a");
      const adapter = createFakeAdapter({ bundleByTour: { "tour-a": fresh } });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      adapter.emit("tour-a", { type: "annotation-changed" });
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

      adapter.emit("tour-a", { type: "annotation-changed" });
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

      adapter.emit("tour-a", { type: "annotation-changed" });
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

      adapter.emit("tour-a", { type: "annotation-changed" });
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
});
