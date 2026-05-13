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
import type { Cursor, RowAnchor, CardAnchor } from "../../src/core/cursor-state.js";
import { validateCursor, cursorAtFirstFileRow } from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";

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
  it("starts idle for every RemoteData slot, closed picker, split layout, null cursor, empty expansion", () => {
    const s = initialTourSessionState();
    expect(s).toEqual({
      currentTourId: null,
      tourList: { kind: "idle" },
      bundle: { kind: "idle" },
      replyLock: { kind: "idle" },
      picker: { kind: "closed" },
      layout: "split",
      cursor: null,
      expansion: new Map(),
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

  it("tour.switched applies CONTEXT-pinned reset rules: layout preserved, picker closed, replyLock reset, cursor null, expansion empty", () => {
    let s = initialTourSessionState();
    s = { ...s, layout: "unified", replyLock: { kind: "ok", value: null } };
    s = reduce(s, { type: "picker.open", rows: [pickerRow("a")] }).state;
    s = reduce(s, {
      type: "cursor.set",
      anchor: {
        kind: "row",
        file: "f.ts",
        side: "additions",
        lineNumber: 1,
        preferredSide: "additions",
      },
    }).state;
    s = reduce(s, {
      type: "expansion.expandFile",
      file: "f.ts",
    }).state;
    const b = mkBundle("a");
    const r = reduce(s, { type: "tour.switched", tourId: "a", bundle: b });
    expect(r.state.bundle).toEqual({ kind: "ok", value: b });
    expect(r.state.currentTourId).toBe("a");
    expect(r.state.layout).toBe("unified");
    expect(r.state.picker).toEqual({ kind: "closed" });
    expect(r.state.replyLock).toEqual({ kind: "idle" });
    expect(r.state.cursor).toBeNull();
    expect(r.state.expansion).toEqual(new Map());
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

// --- Slice 2 (PRD #229 / issue #230) ----------------------------------------

function rowAnchor(over: Partial<RowAnchor> = {}): RowAnchor {
  return {
    kind: "row",
    file: over.file ?? "foo.ts",
    side: over.side ?? "additions",
    lineNumber: over.lineNumber ?? 42,
    preferredSide: over.preferredSide ?? "additions",
    ...(over.interactive ? { interactive: over.interactive } : {}),
  };
}

function cardAnchor(over: Partial<CardAnchor> = {}): CardAnchor {
  return {
    kind: "card",
    annotationId: over.annotationId ?? "ann-1",
    preferredSide: over.preferredSide ?? "additions",
  };
}

describe("reduce — cursor slice (slice 2 foundation)", () => {
  it("cursor.set on a null cursor writes the slice and emits scrollCursorTarget + revealSidebarFile (RowAnchor)", () => {
    const anchor = rowAnchor({ file: "foo.ts", lineNumber: 7, side: "additions" });
    const r = reduce(initialTourSessionState(), { type: "cursor.set", anchor });
    expect(r.state.cursor).toBe(anchor);
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 7 },
      },
      { type: "revealSidebarFile", file: "foo.ts" },
    ]);
  });

  it("cursor.set to a RowAnchor in the same file does NOT emit revealSidebarFile", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 1 }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 5 }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 5 },
      },
    ]);
  });

  it("cursor.set to a RowAnchor in a different file emits revealSidebarFile", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "bar.ts", lineNumber: 3 }),
    });
    expect(r.intents).toContainEqual({ type: "revealSidebarFile", file: "bar.ts" });
  });

  it("cursor.set from RowAnchor to CardAnchor emits mirrorAnnUrl { annotationId }", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-7" }),
    });
    expect(r.state.cursor).toEqual(cardAnchor({ annotationId: "ann-7" }));
    expect(r.intents).toEqual([
      { type: "scrollCursorTarget", target: { kind: "card", annotationId: "ann-7" } },
      { type: "mirrorAnnUrl", annotationId: "ann-7" },
    ]);
  });

  it("cursor.set from CardAnchor to RowAnchor emits mirrorAnnUrl { annotationId: null }", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 4 }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 4 },
      },
      { type: "revealSidebarFile", file: "foo.ts" },
      { type: "mirrorAnnUrl", annotationId: null },
    ]);
  });

  it("cursor.set from CardAnchor to a different CardAnchor emits mirrorAnnUrl { newId } (no revealSidebarFile)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-2" }),
    });
    expect(r.intents).toEqual([
      { type: "scrollCursorTarget", target: { kind: "card", annotationId: "ann-2" } },
      { type: "mirrorAnnUrl", annotationId: "ann-2" },
    ]);
  });

  it("cursor.set within the same Card (same annotationId) emits scrollCursorTarget but no mirrorAnnUrl", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-1", preferredSide: "deletions" }),
    });
    expect(r.intents).toEqual([
      { type: "scrollCursorTarget", target: { kind: "card", annotationId: "ann-1" } },
    ]);
  });

  it("cursor.clear sets the slice to null and emits no intents when prior was a RowAnchor", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, { type: "cursor.clear" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([]);
  });

  it("cursor.clear after a CardAnchor emits mirrorAnnUrl { annotationId: null }", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-1" }),
    }).state;
    const r = reduce(s, { type: "cursor.clear" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([{ type: "mirrorAnnUrl", annotationId: null }]);
  });

  it("cursor.clear on a null cursor is a no-op (same state ref, no intents)", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "cursor.clear" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("cursor.materialize on a null cursor sets the cursor and emits the same intents as cursor.set", () => {
    const anchor = cardAnchor({ annotationId: "ann-5" });
    const r = reduce(initialTourSessionState(), { type: "cursor.materialize", anchor });
    expect(r.state.cursor).toBe(anchor);
    expect(r.intents).toEqual([
      { type: "scrollCursorTarget", target: { kind: "card", annotationId: "ann-5" } },
      { type: "mirrorAnnUrl", annotationId: "ann-5" },
    ]);
  });

  it("cursor.materialize on a non-null cursor is a strict no-op (same state ref, no intents)", () => {
    const before = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(before, {
      type: "cursor.materialize",
      anchor: rowAnchor({ file: "bar.ts", lineNumber: 99 }),
    });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("cursor.setSide on a null cursor is a no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "cursor.setSide", side: "deletions" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("cursor.setSide on a RowAnchor updates preferredSide and side (no intents)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ side: "additions", preferredSide: "additions" }),
    }).state;
    const r = reduce(s, { type: "cursor.setSide", side: "deletions" });
    expect(r.state.cursor).toMatchObject({
      kind: "row",
      side: "deletions",
      preferredSide: "deletions",
    });
    expect(r.intents).toEqual([]);
  });

  it("cursor.setSide on a CardAnchor updates only preferredSide (no intents)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ annotationId: "ann-1", preferredSide: "additions" }),
    }).state;
    const r = reduce(s, { type: "cursor.setSide", side: "deletions" });
    expect(r.state.cursor).toEqual({
      kind: "card",
      annotationId: "ann-1",
      preferredSide: "deletions",
    });
    expect(r.intents).toEqual([]);
  });

  it("cursor.setSide is a no-op when the side is unchanged", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ side: "additions", preferredSide: "additions" }),
    }).state;
    const r = reduce(s, { type: "cursor.setSide", side: "additions" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("cursor slice survives slices it shouldn't touch (picker.move, replyLock.loaded)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 1 }),
    }).state;
    const before = s.cursor;
    s = reduce(s, { type: "picker.open", rows: [pickerRow("a"), pickerRow("b")] }).state;
    s = reduce(s, { type: "picker.move", delta: 1 }).state;
    s = reduce(s, {
      type: "replyLock.loaded",
      replyLock: { agent: "claude", started_at: "2026-05-13T00:00:00Z" },
    }).state;
    expect(s.cursor).toBe(before);
  });
});

describe("reduce — expansion slice (slice 2 foundation)", () => {
  it("expansion.expandFile sets fileExpanded for the file (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "expansion.expandFile",
      file: "foo.ts",
    });
    expect(r.state.expansion.get("foo.ts")?.fileExpanded).toBe(true);
    expect(r.intents).toEqual([]);
  });

  it("expansion.expandFile is a no-op when the file is already expanded (same state ref)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "expansion.expandFile",
      file: "foo.ts",
    }).state;
    const r = reduce(s, { type: "expansion.expandFile", file: "foo.ts" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("expansion.expandTop appends `up` lines to the file-top boundary (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "expansion.expandTop",
      file: "foo.ts",
      mode: "all",
      gapSize: 30,
    });
    const boundary = r.state.expansion.get("foo.ts")?.boundaries.get("top");
    expect(boundary).toEqual({ up: 30, down: 0 });
    expect(r.intents).toEqual([]);
  });

  it("expansion.expandBottom appends `down` lines to the file-bottom boundary (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "expansion.expandBottom",
      file: "foo.ts",
      mode: "all",
      gapSize: 30,
    });
    const boundary = r.state.expansion.get("foo.ts")?.boundaries.get("bottom");
    expect(boundary).toEqual({ up: 0, down: 30 });
    expect(r.intents).toEqual([]);
  });

  it("expansion.expand on a numeric hunk separator updates both sides symmetrically (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "expansion.expand",
      file: "foo.ts",
      ref: 2,
      direction: "both",
      mode: "symmetric-20",
      gapSize: 100,
    });
    const boundary = r.state.expansion.get("foo.ts")?.boundaries.get(2);
    expect(boundary).toEqual({ up: 10, down: 10 });
    expect(r.intents).toEqual([]);
  });

  it("expansion.expand returns the same state ref when gap is fully expanded (no-op)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "expansion.expand",
      file: "foo.ts",
      ref: 1,
      direction: "both",
      mode: "all",
      gapSize: 10,
    }).state;
    const r = reduce(s, {
      type: "expansion.expand",
      file: "foo.ts",
      ref: 1,
      direction: "both",
      mode: "symmetric-20",
      gapSize: 10,
    });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("expansion.seedFromOrphans merges orphan windows into the slice (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "expansion.seedFromOrphans",
      windows: [
        { file: "foo.ts", ref: "top", fromStart: 3, fromEnd: 0 },
        { file: "bar.ts", ref: 1, fromStart: 0, fromEnd: 5 },
      ],
    });
    expect(r.state.expansion.get("foo.ts")?.boundaries.get("top")).toEqual({ up: 3, down: 0 });
    expect(r.state.expansion.get("bar.ts")?.boundaries.get(1)).toEqual({ up: 0, down: 5 });
    expect(r.intents).toEqual([]);
  });

  it("expansion.seedFromOrphans on an empty window list is a same-ref no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "expansion.seedFromOrphans", windows: [] });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("unchanged slices keep reference stability across an expansion action", () => {
    const lock = { agent: "claude", started_at: "2026-05-13T00:00:00Z" };
    let s = reduce(initialTourSessionState(), {
      type: "replyLock.loaded",
      replyLock: lock,
    }).state;
    s = reduce(s, {
      type: "picker.open",
      rows: [pickerRow("a")],
    }).state;
    const r = reduce(s, { type: "expansion.expandFile", file: "foo.ts" });
    expect(r.state.replyLock).toBe(s.replyLock);
    expect(r.state.picker).toBe(s.picker);
    expect(r.state.tourList).toBe(s.tourList);
    expect(r.state.bundle).toBe(s.bundle);
  });
});

describe("reduce — bundle.refreshed → revalidateCursor wiring", () => {
  it("bundle.refreshed with cursor === null emits no revalidateCursor intent", () => {
    const r = reduce(initialTourSessionState(), {
      type: "bundle.refreshed",
      bundle: mkBundle("a"),
    });
    expect(r.intents).toEqual([]);
  });

  it("bundle.refreshed with cursor !== null emits a revalidateCursor intent", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 42 }),
    }).state;
    const r = reduce(s, { type: "bundle.refreshed", bundle: mkBundle("a") });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("tour.switched does not emit revalidateCursor (cursor was reset to null)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "tour.switched",
      tourId: "a",
      bundle: mkBundle("a"),
    });
    expect(r.intents).toEqual([]);
    expect(r.state.cursor).toBeNull();
  });
});

describe("cross-async killer fixture — watcher reload snaps cursor to file's first row", () => {
  // The slice-2 architecture earns its keep here: a watcher reload arrives,
  // the cursor's row vanishes from the new bundle, the surface drains the
  // revalidateCursor intent by calling validateCursor against fresh flat-
  // rows + files, and the resulting snap is reproducible as a synchronous
  // fixture — no React / OpenTUI / JSDOM rendering required.
  function diffRow(file: string, line: number): FlatRow {
    return {
      kind: "diff",
      file,
      lineNumber: line,
      side: "additions",
      leftLineNumber: line,
      rightLineNumber: line,
      paired: true,
    };
  }

  it("cursor on file foo line 42 → bundle.refreshed → surface snaps via validateCursor → cursor.set lands on file's first row, with deterministic action + intent stream", () => {
    const store = new TourSessionStore();
    const intents: Intent[] = [];
    store.onIntent((i) => intents.push(i));

    // Seed: cursor pinned to (foo, line 42, additions).
    const initialAnchor: Cursor = rowAnchor({
      file: "foo.ts",
      lineNumber: 42,
      side: "additions",
    });
    store.dispatch({ type: "cursor.set", anchor: initialAnchor });

    // Intent stream so far: cursor.set's three intents (scroll + reveal +
    // mirror-null since prev was null and new is row).
    expect(intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 42 },
      },
      { type: "revealSidebarFile", file: "foo.ts" },
    ]);
    intents.length = 0;

    // Bundle.refreshed arrives (watcher reload). The new bundle's flat-rows
    // for foo.ts no longer contain line 42 — the row vanished.
    const refreshedBundle = mkBundle("a");
    store.dispatch({ type: "bundle.refreshed", bundle: refreshedBundle });

    // Intent stream: just the revalidateCursor signal — the reducer doesn't
    // know what flat-rows look like, so the surface owns the resolution.
    expect(intents).toEqual([{ type: "revalidateCursor" }]);
    intents.length = 0;

    // Simulate the surface drain: rebuild flat-rows from the new bundle
    // (line 1 still present, line 42 gone), call validateCursor with files
    // also containing foo.ts. The pure helper picks the file's first
    // surviving row.
    const newFlatRows: FlatRow[] = [diffRow("foo.ts", 1), diffRow("foo.ts", 2)];
    const files: ReadonlyArray<{ name: string }> = [{ name: "foo.ts" }];
    const snapped = validateCursor(store.getState().cursor, newFlatRows, files);
    expect(snapped).toEqual(rowAnchor({ file: "foo.ts", lineNumber: 1 }));
    // Sanity check against the dedicated first-row helper.
    expect(cursorAtFirstFileRow("foo.ts", newFlatRows)).toEqual(snapped);

    // Surface dispatches the snap.
    if (snapped !== null) store.dispatch({ type: "cursor.set", anchor: snapped });

    // Final state + intent stream is fully deterministic.
    expect(store.getState().cursor).toEqual(snapped);
    expect(intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 1 },
      },
    ]);
  });

  it("when the cursor's file vanishes entirely, validateCursor returns null and the surface dispatches cursor.clear (Card-leaving null mirror not emitted for a Row→null path)", () => {
    const store = new TourSessionStore();
    const intents: Intent[] = [];
    store.onIntent((i) => intents.push(i));
    store.dispatch({
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 1 }),
    });
    intents.length = 0;
    store.dispatch({ type: "bundle.refreshed", bundle: mkBundle("a") });
    expect(intents).toEqual([{ type: "revalidateCursor" }]);
    intents.length = 0;

    // foo.ts removed from the new bundle.
    const newFlatRows: FlatRow[] = [diffRow("bar.ts", 1)];
    const files: ReadonlyArray<{ name: string }> = [{ name: "bar.ts" }];
    const snapped = validateCursor(store.getState().cursor, newFlatRows, files);
    // No "snap to next file" because the cursor's file isn't in `files`.
    expect(snapped).toBeNull();
    store.dispatch({ type: "cursor.clear" });
    expect(store.getState().cursor).toBeNull();
    // Prior was a RowAnchor → no mirrorAnnUrl emitted.
    expect(intents).toEqual([]);
  });

  it("when the cursor's row survives the reload, validateCursor returns the same anchor ref and the surface emits no dispatch", () => {
    const store = new TourSessionStore();
    const initial = rowAnchor({ file: "foo.ts", lineNumber: 1 });
    store.dispatch({ type: "cursor.set", anchor: initial });
    const newFlatRows: FlatRow[] = [diffRow("foo.ts", 1), diffRow("foo.ts", 2)];
    const files: ReadonlyArray<{ name: string }> = [{ name: "foo.ts" }];
    const validated = validateCursor(store.getState().cursor, newFlatRows, files);
    expect(validated).toBe(store.getState().cursor); // Same ref — no dispatch.
  });
});
