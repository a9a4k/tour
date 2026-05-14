import { describe, it, expect } from "vitest";
import {
  TourSessionStore,
  initialTourSessionState,
  type TourSessionState,
} from "../../src/core/tour-session.js";
import {
  TourSessionRuntime,
  type ScrollRowAnchor,
  type TourEvent,
  type TourEventHandler,
  type TourSessionAdapter,
} from "../../src/core/tour-session-runtime.js";
import type { ScrollPlacement } from "../../src/core/tour-session.js";
import type { TourBundle } from "../../src/core/tour-bundle.js";
import type { ReplyLock } from "../../src/core/reply-lock.js";
import type { Tour, Annotation } from "../../src/core/types.js";
import type { WriteAnnotationInput } from "../../src/core/write-annotation-input.js";

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

function okBundle(id: string, annotations: Annotation[] = []): TourBundle {
  return {
    kind: "ok",
    tour: tour(id),
    annotations,
    diff: "",
    files: [],
  };
}

interface FakeAdapter extends TourSessionAdapter {
  bundleCalls: string[];
  lockCalls: string[];
  writeCalls: Array<{ tourId: string; input: WriteAnnotationInput }>;
  scrollCardCalls: Array<{ id: string; mode: ScrollPlacement }>;
  scrollRowCalls: Array<{ anchor: ScrollRowAnchor; mode: ScrollPlacement }>;
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
  writeAnnotationError?: string;
  writeAnnotationResult?: Annotation;
}

function createFakeAdapter(opts: FakeAdapterOptions = {}): FakeAdapter {
  const bundleCalls: string[] = [];
  const lockCalls: string[] = [];
  const writeCalls: FakeAdapter["writeCalls"] = [];
  const scrollCardCalls: FakeAdapter["scrollCardCalls"] = [];
  const scrollRowCalls: FakeAdapter["scrollRowCalls"] = [];
  const scrollPickerCalls: number[] = [];
  const revealFileCalls: string[] = [];
  const mirrorTourCalls: string[] = [];
  const mirrorAnnCalls: Array<string | null> = [];
  const subscriptions: FakeAdapter["subscriptions"] = [];

  const adapter: FakeAdapter = {
    bundleCalls,
    lockCalls,
    writeCalls,
    scrollCardCalls,
    scrollRowCalls,
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
    writeAnnotation: async (tourId, input) => {
      writeCalls.push({ tourId, input });
      if (opts.writeAnnotationError) throw new Error(opts.writeAnnotationError);
      return opts.writeAnnotationResult ?? {
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
    scrollToCard: (id, mode) => {
      scrollCardCalls.push({ id, mode });
    },
    scrollToRow: (anchor, mode) => {
      scrollRowCalls.push({ anchor, mode });
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

  describe("submitAnnotation intent (PRD #278 slice 4)", () => {
    function annotationFixture(id: string, overrides: Partial<Annotation> = {}): Annotation {
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

    it("calls adapter.writeAnnotation with the built input and dispatches composer.submitted on success", async () => {
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

    it("resolves the reply parent from the live bundle and passes it through writeAnnotation", async () => {
      const store = storeWithTour(null);
      const parent = annotationFixture("p1");
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

    it("dispatches composer.failed with the error message on writeAnnotation rejection", async () => {
      const store = storeWithTour(null);
      const bundle = okBundle("tour-a");
      const adapter = createFakeAdapter({ writeAnnotationError: "disk full" });
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

    it("treats whitespace-only body as composer.close — does NOT call writeAnnotation", async () => {
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
      // Bundle has no annotations, so the reply parent lookup will miss.
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
        expect(composer.error).toBe("Parent annotation no longer exists");
      }
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
          { id: "tour-a", title: "A", status: "open", glyph: "●", age: "now", annotationCount: 0 },
          { id: "tour-b", title: "B", status: "open", glyph: "●", age: "now", annotationCount: 0 },
        ],
      });
      store.dispatch({ type: "picker.move", delta: 1 });

      expect(adapter.scrollPickerCalls).toEqual([1]);
      stop();
    });

    it("scrollCursorTarget intent (kind=card) → adapter.scrollToCard with placement", () => {
      const store = storeWithTour(null);
      const ann: Annotation = {
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
        anchor: { kind: "card", annotationId: "ann1", preferredSide: "additions" },
        placement: "center",
      });

      expect(adapter.scrollCardCalls).toEqual([{ id: "ann1", mode: "center" }]);
      expect(adapter.scrollRowCalls).toEqual([]);
      stop();
    });

    it("scrollCursorTarget intent (kind=row) → adapter.scrollToRow with the row anchor and placement", () => {
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
        },
      ]);
      expect(adapter.scrollCardCalls).toEqual([]);
      stop();
    });

    it("scrollToAnnotation intent → adapter.scrollToCard(id, 'center')", () => {
      const store = storeWithTour(null);
      const ann: Annotation = {
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
      const adapter = createFakeAdapter({ writeAnnotationResult: ann });
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();
      store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle });

      // composer.submitted dispatch emits scrollToAnnotation (the reducer
      // requires composer to be in `submitting` for the transition).
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
      store.dispatch({ type: "composer.submitted", annotation: ann });

      expect(
        adapter.scrollCardCalls.filter((c) => c.id === "a-new" && c.mode === "center"),
      ).toEqual([{ id: "a-new", mode: "center" }]);
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
          { id: "tour-a", title: "A", status: "open", glyph: "●", age: "now", annotationCount: 0 },
        ],
      });
      store.dispatch({ type: "picker.commit" });

      expect(adapter.mirrorTourCalls).toEqual(["tour-a"]);
      stop();
    });

    it("mirrorAnnUrl intent → adapter.mirrorAnnUrl(annotationId)", () => {
      const store = storeWithTour(null);
      const ann: Annotation = {
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
        anchor: { kind: "card", annotationId: "ann1", preferredSide: "additions" },
      });
      // Clearing the cursor with a card anchor present emits mirrorAnnUrl(null).
      store.dispatch({ type: "cursor.clear" });

      expect(adapter.mirrorAnnCalls).toEqual(["ann1", null]);
      stop();
    });

    it("revealSidebarFile intent → adapter.revealFileInSidebar and dispatches folds.setOverride(false)", () => {
      const store = storeWithTour("tour-a");
      store.dispatch({
        type: "folds.setOverride",
        file: "src/a.ts",
        value: true,
      });
      const adapter = createFakeAdapter();
      const runtime = new TourSessionRuntime(store, adapter);
      const stop = runtime.start();

      // `cursor.set` for a row anchor on a new file emits revealSidebarFile.
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
      expect(store.getState().collapsedOverrides["src/a.ts"]).toBe(false);
      stop();
    });
  });
});
