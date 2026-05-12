import { describe, it, expect } from "vitest";
import {
  reduce,
  initialTourSessionState,
  TourSessionStore,
  isPickerOpen,
  isBundleResolved,
  resolvedReplyLock,
  pickerHighlighted,
  currentTourSummary,
  map,
  withDefault,
  isOk,
  type Intent,
  type TourSessionState,
  type TourSummary,
} from "../../src/core/tour-session.js";
import type { PickerRow } from "../../src/core/tour-list.js";
import type { TourBundle } from "../../src/core/tour-bundle.js";
import type { Tour, Annotation } from "../../src/core/types.js";

function pickerRow(id: string, over: Partial<PickerRow> = {}): PickerRow {
  return {
    id,
    title: `tour-${id}`,
    status: "open",
    glyph: "●",
    age: "1m ago",
    annotationCount: 0,
    ...over,
  };
}

function tour(over: Partial<Tour> & { id: string }): Tour {
  return {
    id: over.id,
    title: over.title ?? "T",
    status: over.status ?? "open",
    created_at: over.created_at ?? "2026-05-12T00:00:00Z",
    closed_at: over.closed_at ?? "",
    head_sha: "h",
    base_sha: "b",
    head_source: "h",
    base_source: "b",
    wip_snapshot: false,
  };
}

function mkBundle(id: string): TourBundle {
  return { kind: "snapshot-lost", tour: tour({ id }), annotations: [] as Annotation[] };
}

describe("RemoteData<T> helpers", () => {
  it("isOk reports kind === 'ok'", () => {
    expect(isOk({ kind: "idle" })).toBe(false);
    expect(isOk({ kind: "loading" })).toBe(false);
    expect(isOk({ kind: "ok", value: 1 })).toBe(true);
    expect(isOk({ kind: "err", error: "x" })).toBe(false);
  });

  it("map only transforms ok; idle/loading/err pass through", () => {
    expect(map<number, string>({ kind: "ok", value: 7 }, (n) => `${n * 2}`)).toEqual({
      kind: "ok",
      value: "14",
    });
    expect(map<number, string>({ kind: "idle" }, () => "_")).toEqual({ kind: "idle" });
    expect(map<number, string>({ kind: "loading" }, () => "_")).toEqual({ kind: "loading" });
    expect(map<number, string>({ kind: "err", error: "bad" }, () => "_")).toEqual({
      kind: "err",
      error: "bad",
    });
  });

  it("withDefault returns the inner value when ok, else the fallback", () => {
    expect(withDefault({ kind: "ok", value: 9 }, 0)).toBe(9);
    expect(withDefault<number>({ kind: "loading" }, -1)).toBe(-1);
    expect(withDefault<number>({ kind: "idle" }, -1)).toBe(-1);
    expect(withDefault<number>({ kind: "err", error: "x" }, -1)).toBe(-1);
  });
});

describe("initialTourSessionState", () => {
  it("starts idle for every RemoteData slot, closed picker, split layout", () => {
    const s = initialTourSessionState();
    expect(s).toEqual({
      currentTourId: null,
      tourList: { kind: "idle" },
      bundle: { kind: "idle" },
      replyLock: { kind: "idle" },
      picker: { kind: "closed" },
      layout: "split",
    });
  });
});

describe("reduce — picker slice", () => {
  it("picker.open opens with cursor at 0", () => {
    const rows = [pickerRow("a"), pickerRow("b")];
    const { state, intents } = reduce(initialTourSessionState(), {
      type: "picker.open",
      rows,
    });
    expect(state.picker).toEqual({ kind: "open", rows, cursor: 0 });
    expect(intents).toEqual([]);
  });

  it("picker.close transitions to closed", () => {
    const opened = reduce(initialTourSessionState(), {
      type: "picker.open",
      rows: [pickerRow("a")],
    }).state;
    const { state, intents } = reduce(opened, { type: "picker.close" });
    expect(state.picker).toEqual({ kind: "closed" });
    expect(intents).toEqual([]);
  });

  it("picker.move advances cursor and emits scrollPickerRow", () => {
    const rows = [pickerRow("a"), pickerRow("b"), pickerRow("c")];
    const opened = reduce(initialTourSessionState(), { type: "picker.open", rows }).state;
    const r = reduce(opened, { type: "picker.move", delta: 1 });
    expect(r.state.picker).toEqual({ kind: "open", rows, cursor: 1 });
    expect(r.intents).toEqual([{ type: "scrollPickerRow", idx: 1 }]);
  });

  it("picker.move clamps at the upper edge and still emits scrollPickerRow at that idx", () => {
    const rows = [pickerRow("a"), pickerRow("b")];
    let s = reduce(initialTourSessionState(), { type: "picker.open", rows }).state;
    s = reduce(s, { type: "picker.move", delta: 1 }).state; // now at idx 1
    const r = reduce(s, { type: "picker.move", delta: 1 });
    expect(r.state.picker).toEqual({ kind: "open", rows, cursor: 1 });
    expect(r.intents).toEqual([{ type: "scrollPickerRow", idx: 1 }]);
  });

  it("picker.move clamps at the lower edge", () => {
    const rows = [pickerRow("a"), pickerRow("b")];
    const opened = reduce(initialTourSessionState(), { type: "picker.open", rows }).state;
    const r = reduce(opened, { type: "picker.move", delta: -1 });
    expect(r.state.picker).toEqual({ kind: "open", rows, cursor: 0 });
    expect(r.intents).toEqual([{ type: "scrollPickerRow", idx: 0 }]);
  });

  it("picker.move on a closed picker is a no-op (no intents, same state ref)", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "picker.move", delta: 1 });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("picker.commit closes the picker, sets bundle loading + currentTourId, emits loadTour + mirrorUrl", () => {
    const rows = [pickerRow("a"), pickerRow("b")];
    let s = reduce(initialTourSessionState(), { type: "picker.open", rows }).state;
    s = reduce(s, { type: "picker.move", delta: 1 }).state; // pick b
    const r = reduce(s, { type: "picker.commit" });
    expect(r.state.picker).toEqual({ kind: "closed" });
    expect(r.state.bundle).toEqual({ kind: "loading" });
    expect(r.state.currentTourId).toBe("b");
    expect(r.intents).toEqual([
      { type: "loadTour", tourId: "b" },
      { type: "mirrorUrl", tourId: "b" },
    ]);
  });

  it("picker.commit on a closed picker is a no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "picker.commit" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });
});

describe("reduce — bundle slice", () => {
  it("bundle.loading sets currentTourId and bundle = loading", () => {
    const r = reduce(initialTourSessionState(), { type: "bundle.loading", tourId: "x" });
    expect(r.state.currentTourId).toBe("x");
    expect(r.state.bundle).toEqual({ kind: "loading" });
    expect(r.intents).toEqual([]);
  });

  it("bundle.refreshed replaces the bundle slice in place and leaves picker / replyLock / currentTourId / layout untouched", () => {
    // Set up a state with an OPEN picker and a LOADED reply-lock — the
    // two slots that `tour.switched` (the Tour-switch sibling) resets.
    // `bundle.refreshed` is the same-tour-refresh path: the user is still
    // mid-flight, so neither slot must be touched.
    let s: TourSessionState = initialTourSessionState();
    const lock = { agent: "claude", started_at: "2026-05-12T00:00:00Z" };
    s = {
      ...s,
      currentTourId: "a",
      layout: "unified",
      replyLock: { kind: "ok", value: lock },
    };
    s = reduce(s, { type: "picker.open", rows: [pickerRow("a"), pickerRow("b")] }).state;
    s = reduce(s, { type: "picker.move", delta: 1 }).state; // cursor=1
    const b = mkBundle("a");
    const r = reduce(s, { type: "bundle.refreshed", bundle: b });
    expect(r.state.bundle).toEqual({ kind: "ok", value: b });
    // Untouched slots:
    expect(r.state.currentTourId).toBe("a");
    expect(r.state.layout).toBe("unified");
    expect(r.state.picker).toEqual({
      kind: "open",
      rows: [pickerRow("a"), pickerRow("b")],
      cursor: 1,
    });
    expect(r.state.replyLock).toEqual({ kind: "ok", value: lock });
    expect(r.intents).toEqual([]);
  });

  it("tour.switched applies CONTEXT-pinned reset rules: layout preserved, picker closed, replyLock reset", () => {
    let s = initialTourSessionState();
    s = { ...s, layout: "unified", replyLock: { kind: "ok", value: null } };
    s = reduce(s, { type: "picker.open", rows: [pickerRow("a")] }).state;
    const b = mkBundle("a");
    const r = reduce(s, { type: "tour.switched", tourId: "a", bundle: b });
    expect(r.state.bundle).toEqual({ kind: "ok", value: b });
    expect(r.state.currentTourId).toBe("a");
    expect(r.state.layout).toBe("unified");
    expect(r.state.picker).toEqual({ kind: "closed" });
    expect(r.state.replyLock).toEqual({ kind: "idle" });
    expect(r.intents).toEqual([]);
  });

  it("bundle.failed puts bundle into err(...) and leaves currentTourId in place", () => {
    const after = reduce(initialTourSessionState(), {
      type: "bundle.loading",
      tourId: "x",
    }).state;
    const r = reduce(after, { type: "bundle.failed", tourId: "x", error: "boom" });
    expect(r.state.bundle).toEqual({ kind: "err", error: "boom" });
    expect(r.state.currentTourId).toBe("x");
    expect(r.intents).toEqual([]);
  });

  it("replyLock.loaded replaces the replyLock slice (used by watcher / SSE / tour-switch handlers)", () => {
    const s = initialTourSessionState();
    const lock = { agent: "claude", started_at: "2026-05-12T00:00:00Z" };
    const r = reduce(s, { type: "replyLock.loaded", replyLock: lock });
    expect(r.state.replyLock).toEqual({ kind: "ok", value: lock });
    expect(r.intents).toEqual([]);
    const r2 = reduce(r.state, { type: "replyLock.loaded", replyLock: null });
    expect(r2.state.replyLock).toEqual({ kind: "ok", value: null });
  });
});

describe("reduce — tourList slice", () => {
  it("tourList.loading", () => {
    const r = reduce(initialTourSessionState(), { type: "tourList.loading" });
    expect(r.state.tourList).toEqual({ kind: "loading" });
  });

  it("tourList.loaded", () => {
    const tours: TourSummary[] = [
      { id: "a", title: "A", status: "open", created_at: "2026-05-12T00:00:00Z" },
    ];
    const r = reduce(initialTourSessionState(), { type: "tourList.loaded", tours });
    expect(r.state.tourList).toEqual({ kind: "ok", value: tours });
  });

  it("tourList.failed", () => {
    const r = reduce(initialTourSessionState(), { type: "tourList.failed", error: "404" });
    expect(r.state.tourList).toEqual({ kind: "err", error: "404" });
  });
});

describe("selectors", () => {
  it("isPickerOpen reflects picker.kind", () => {
    expect(isPickerOpen(initialTourSessionState())).toBe(false);
    const s = reduce(initialTourSessionState(), {
      type: "picker.open",
      rows: [pickerRow("a")],
    }).state;
    expect(isPickerOpen(s)).toBe(true);
  });

  it("isBundleResolved unwraps the outer RemoteData.ok layer regardless of bundle.kind", () => {
    expect(isBundleResolved(initialTourSessionState())).toBeNull();
    // Loading bundle slice → not resolved.
    const loadingState = reduce(initialTourSessionState(), {
      type: "bundle.loading",
      tourId: "x",
    }).state;
    expect(isBundleResolved(loadingState)).toBeNull();
    // Failed bundle slice → not resolved.
    const failedState = reduce(initialTourSessionState(), {
      type: "bundle.failed",
      tourId: "x",
      error: "boom",
    }).state;
    expect(isBundleResolved(failedState)).toBeNull();
    // ok-kind bundle resolves to the TourBundle value.
    const okBundle = mkBundle("a");
    const okState = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "a",
      bundle: okBundle,
    }).state;
    expect(isBundleResolved(okState)).toBe(okBundle);
    // snapshot-lost-kind bundle still resolves — the helper unwraps the
    // outer RemoteData layer; the inner kind is the caller's concern.
    const snapBundle: TourBundle = {
      kind: "snapshot-lost",
      tour: tour({ id: "b" }),
      annotations: [] as Annotation[],
    };
    const snapState = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "b",
      bundle: snapBundle,
    }).state;
    expect(isBundleResolved(snapState)).toBe(snapBundle);
  });

  it("resolvedReplyLock returns null for idle/loading/err and the inner value for ok", () => {
    // idle (initial) → null.
    expect(resolvedReplyLock(initialTourSessionState())).toBeNull();
    // ok with a concrete lock → that lock.
    const lock = { agent: "claude", started_at: "2026-05-12T00:00:00Z" };
    const okState = reduce(initialTourSessionState(), {
      type: "replyLock.loaded",
      replyLock: lock,
    }).state;
    expect(resolvedReplyLock(okState)).toBe(lock);
    // ok with null inner (lock genuinely absent on disk) → null. This is
    // semantically distinct from `idle` (slice never observed); the
    // selector intentionally collapses both to null because the renderer
    // only needs "is a lock currently held?".
    const okNullState = reduce(initialTourSessionState(), {
      type: "replyLock.loaded",
      replyLock: null,
    }).state;
    expect(resolvedReplyLock(okNullState)).toBeNull();
  });

  it("pickerHighlighted returns the row at cursor; null when closed", () => {
    expect(pickerHighlighted(initialTourSessionState())).toBeNull();
    const rows = [pickerRow("a"), pickerRow("b")];
    let s = reduce(initialTourSessionState(), { type: "picker.open", rows }).state;
    expect(pickerHighlighted(s)).toEqual(rows[0]);
    s = reduce(s, { type: "picker.move", delta: 1 }).state;
    expect(pickerHighlighted(s)).toEqual(rows[1]);
  });

  it("currentTourSummary returns the matching summary from a loaded list, else null", () => {
    expect(currentTourSummary(initialTourSessionState())).toBeNull();
    const tours: TourSummary[] = [
      { id: "a", title: "A", status: "open", created_at: "2026-05-12T00:00:00Z" },
      { id: "b", title: "B", status: "closed", created_at: "2026-05-11T00:00:00Z" },
    ];
    let s: TourSessionState = reduce(initialTourSessionState(), {
      type: "tourList.loaded",
      tours,
    }).state;
    s = { ...s, currentTourId: "b" };
    expect(currentTourSummary(s)).toEqual(tours[1]);
    s = { ...s, currentTourId: "missing" };
    expect(currentTourSummary(s)).toBeNull();
    s = { ...s, currentTourId: null };
    expect(currentTourSummary(s)).toBeNull();
  });

  it("currentTourSummary returns null when tourList is not ok", () => {
    let s: TourSessionState = initialTourSessionState();
    s = { ...s, currentTourId: "a" };
    expect(currentTourSummary(s)).toBeNull();
    s = { ...s, tourList: { kind: "loading" } };
    expect(currentTourSummary(s)).toBeNull();
    s = { ...s, tourList: { kind: "err", error: "x" } };
    expect(currentTourSummary(s)).toBeNull();
  });
});

describe("TourSessionStore", () => {
  it("getState returns the initial state by default", () => {
    const store = new TourSessionStore();
    expect(store.getState()).toEqual(initialTourSessionState());
  });

  it("dispatch fires subscribers when state changes", () => {
    const store = new TourSessionStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: "picker.open", rows: [pickerRow("a")] });
    expect(calls).toBe(1);
  });

  it("dispatch fires intent listeners with emitted intents in order", () => {
    const store = new TourSessionStore();
    const captured: Intent[] = [];
    store.onIntent((i) => captured.push(i));
    store.dispatch({ type: "picker.open", rows: [pickerRow("a"), pickerRow("b")] });
    store.dispatch({ type: "picker.move", delta: 1 });
    store.dispatch({ type: "picker.commit" });
    expect(captured).toEqual([
      { type: "scrollPickerRow", idx: 1 },
      { type: "loadTour", tourId: "b" },
      { type: "mirrorUrl", tourId: "b" },
    ]);
  });

  it("state reference is stable when reducer returns the same state ref", () => {
    const store = new TourSessionStore();
    const ref1 = store.getState();
    store.dispatch({ type: "picker.commit" }); // closed → no-op
    const ref2 = store.getState();
    expect(ref2).toBe(ref1);
  });

  it("subscribers do not fire when state ref is unchanged", () => {
    const store = new TourSessionStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: "picker.commit" }); // no-op
    expect(calls).toBe(0);
  });

  it("subscribe returns an unsubscribe that stops further notifications", () => {
    const store = new TourSessionStore();
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    unsub();
    store.dispatch({ type: "picker.open", rows: [pickerRow("a")] });
    expect(calls).toBe(0);
  });

  it("onIntent returns an unsubscribe that stops further intent delivery", () => {
    const store = new TourSessionStore();
    const captured: Intent[] = [];
    const unsub = store.onIntent((i) => captured.push(i));
    unsub();
    store.dispatch({ type: "picker.open", rows: [pickerRow("a"), pickerRow("b")] });
    store.dispatch({ type: "picker.move", delta: 1 });
    expect(captured).toEqual([]);
  });
});
