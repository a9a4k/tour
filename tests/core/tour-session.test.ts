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
  type ComposerTarget,
  type Intent,
  type TourSessionState,
  type TourSummary,
} from "../../src/core/tour-session.js";
import type { PickerRow } from "../../src/core/tour-list.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import type { Tour, Comment } from "../../src/core/types.js";
import type { Cursor, RowAnchor, CardAnchor } from "../../src/core/cursor-state.js";
import { validateCursor, cursorAtFirstFileRow } from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";
import type { BoundaryRef } from "../../src/core/expansion-state.js";

function pickerRow(id: string, over: Partial<PickerRow> = {}): PickerRow {
  return {
    id,
    title: `tour-${id}`,
    status: "open",
    glyph: "●",
    age: "1m ago",
    commentCount: 0,
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
  return { kind: "snapshot-lost", tour: tour({ id }), comments: [] as Comment[] };
}

function bundleFile(
  name: string,
  orphanWindows: ReadonlyArray<{ ref: BoundaryRef; fromStart: number; fromEnd: number }> = [],
): BundleFile {
  return {
    name,
    type: "change",
    hunks: [],
    classification: { collapsed: false },
    orphanWindows,
  };
}

function okBundle(
  id: string,
  files: BundleFile[] = [],
): Extract<TourBundle, { kind: "ok" }> {
  return {
    kind: "ok",
    tour: tour({ id }),
    comments: [] as Comment[],
    diff: "",
    files,
  };
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
  it("starts idle for every RemoteData slot, closed picker, unified layout, null cursor, empty expansion, closed composer, empty folds", () => {
    const s = initialTourSessionState();
    expect(s).toEqual({
      currentTourId: null,
      tourList: { kind: "idle" },
      bundle: { kind: "idle" },
      replyLock: { kind: "idle" },
      picker: { kind: "closed" },
      layout: "unified",
      cursor: null,
      expansion: new Map(),
      composer: { kind: "closed" },
      deleteConfirm: { kind: "closed" },
      collapsedFolders: new Set(),
      collapsedOverrides: {},
      collapsedThreads: new Set(),
      paneFocus: "sidebar",
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
  it("bundle.loading sets currentTourId and bundle = loading, emits loadTour", () => {
    const r = reduce(initialTourSessionState(), { type: "bundle.loading", tourId: "x" });
    expect(r.state.currentTourId).toBe("x");
    expect(r.state.bundle).toEqual({ kind: "loading" });
    expect(r.intents).toEqual([{ type: "loadTour", tourId: "x" }]);
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

  it("tour.switched with non-empty orphanWindows in the inbound bundle seeds the expansion slice (PRD #278 slice 1)", () => {
    // Manual user expansion present BEFORE the switch: should be wiped per
    // the CONTEXT-pinned reset cascade. Seeding then runs from a fresh
    // empty slice, populating only the orphan-anchored boundaries from
    // the inbound bundle.
    let s = initialTourSessionState();
    s = reduce(s, { type: "expansion.expandFile", file: "old.ts" }).state;
    const b = okBundle("a", [
      bundleFile("foo.ts", [{ ref: "top", fromStart: 4, fromEnd: 0 }]),
      bundleFile("bar.ts", [{ ref: 1, fromStart: 0, fromEnd: 7 }]),
    ]);
    const r = reduce(s, { type: "tour.switched", tourId: "a", bundle: b });
    expect(r.state.expansion.get("old.ts")).toBeUndefined();
    expect(r.state.expansion.get("foo.ts")?.boundaries.get("top")).toEqual({
      up: 4,
      down: 0,
    });
    expect(r.state.expansion.get("bar.ts")?.boundaries.get(1)).toEqual({
      up: 0,
      down: 7,
    });
    expect(r.intents).toEqual([]);
  });

  it("tour.switched with a snapshot-lost bundle resets expansion to empty (no files → nothing to seed)", () => {
    let s = initialTourSessionState();
    s = reduce(s, { type: "expansion.expandFile", file: "old.ts" }).state;
    const r = reduce(s, { type: "tour.switched", tourId: "a", bundle: mkBundle("a") });
    expect(r.state.expansion).toEqual(new Map());
  });

  it("bundle.refreshed with new orphan windows unions with the existing expansion slice (per-side max — PRD #278 slice 1)", () => {
    // Manual user expansion on foo.ts/top at up=10. Orphan window seed
    // tries up=4 → preserved at 10 (max). Orphan window for bar.ts/1 at
    // down=5 has no prior, so it lands as { up: 0, down: 5 }.
    let s = initialTourSessionState();
    s = reduce(s, {
      type: "expansion.expandTop",
      file: "foo.ts",
      mode: "symmetric-20",
      gapSize: 100,
    }).state;
    // Sanity: prior manual expansion took us to up=20 on foo.ts/top.
    expect(s.expansion.get("foo.ts")?.boundaries.get("top")).toEqual({ up: 20, down: 0 });
    const b = okBundle("a", [
      bundleFile("foo.ts", [{ ref: "top", fromStart: 4, fromEnd: 0 }]),
      bundleFile("bar.ts", [{ ref: 1, fromStart: 0, fromEnd: 5 }]),
    ]);
    const r = reduce(s, { type: "bundle.refreshed", bundle: b });
    // Manual expansion preserved (20 > 4).
    expect(r.state.expansion.get("foo.ts")?.boundaries.get("top")).toEqual({
      up: 20,
      down: 0,
    });
    // New file seeded from orphan window.
    expect(r.state.expansion.get("bar.ts")?.boundaries.get(1)).toEqual({
      up: 0,
      down: 5,
    });
  });

  it("bundle.refreshed with empty orphanWindows leaves the expansion slice ref-equal (same-ref short-circuit — PRD #278 slice 1)", () => {
    let s = initialTourSessionState();
    s = reduce(s, {
      type: "expansion.expandTop",
      file: "foo.ts",
      mode: "symmetric-20",
      gapSize: 100,
    }).state;
    const beforeExpansion = s.expansion;
    const b = okBundle("a", [bundleFile("foo.ts", []), bundleFile("bar.ts", [])]);
    const r = reduce(s, { type: "bundle.refreshed", bundle: b });
    expect(r.state.expansion).toBe(beforeExpansion);
  });

  it("bundle.refreshed with a snapshot-lost bundle leaves the expansion slice ref-equal (no files to seed)", () => {
    let s = initialTourSessionState();
    s = reduce(s, {
      type: "expansion.expandTop",
      file: "foo.ts",
      mode: "symmetric-20",
      gapSize: 100,
    }).state;
    const beforeExpansion = s.expansion;
    const r = reduce(s, { type: "bundle.refreshed", bundle: mkBundle("a") });
    expect(r.state.expansion).toBe(beforeExpansion);
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
      comments: [] as Comment[],
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
    commentId: over.commentId ?? "ann-1",
    preferredSide: over.preferredSide ?? "additions",
  };
}

describe("reduce — cursor slice (slice 2 foundation)", () => {
  it("cursor.set on a null cursor writes the slice and emits scrollCursorTarget + selectSidebarFile (RowAnchor)", () => {
    const anchor = rowAnchor({ file: "foo.ts", lineNumber: 7, side: "additions" });
    const r = reduce(initialTourSessionState(), { type: "cursor.set", anchor });
    expect(r.state.cursor).toBe(anchor);
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 7 },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "selectSidebarFile", file: "foo.ts" },
    ]);
  });

  it("cursor.set to a RowAnchor in the same file does NOT emit selectSidebarFile", () => {
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
        placement: "nearest",
        behavior: "smooth",
      },
    ]);
  });

  it("cursor.set to a RowAnchor in a different file emits selectSidebarFile", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "bar.ts", lineNumber: 3 }),
    });
    expect(r.intents).toContainEqual({ type: "selectSidebarFile", file: "bar.ts" });
  });

  // Issue #310: split-intent regression. `cursor.set` is the most ambient
  // traversal gesture (j/k, click). Emitting an intent that forces an
  // unfold on every cursor file change burned the classifier-collapse
  // contract for lockfile / generated / vendored files — a `j` press
  // ended up uncollapsing 500+ rows of churn the classifier said weren't
  // worth review-grade attention. The intent must NOT carry an implicit
  // unfold; sidebar-selection is the only effect.
  it("cursor.set to a RowAnchor in a different file does NOT emit revealSidebarFile (issue #310 split)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "bar.ts", lineNumber: 3 }),
    });
    // After the split, `revealSidebarFile` is removed from the intent
    // vocabulary — only `selectSidebarFile` is emitted on cursor file
    // change. Explicit force-unfold lives at the call site (sidebar
    // click, n/p comment jump, ...).
    expect(
      r.intents.some((i) => (i as { type: string }).type === "revealSidebarFile"),
    ).toBe(false);
  });

  it("cursor.set from RowAnchor to CardAnchor emits mirrorAnnUrl { commentId }", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-7" }),
    });
    expect(r.state.cursor).toEqual(cardAnchor({ commentId: "ann-7" }));
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-7" },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "selectSidebarFile", file: null },
      { type: "mirrorAnnUrl", commentId: "ann-7" },
    ]);
  });

  it("cursor.set from null to CardAnchor emits sidebar selection for the comment file", () => {
    const ann = mkComment({ id: "ann-1", file: "a.ts" });
    const s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: { ...okBundle("tour-a", [bundleFile("a.ts")]), comments: [ann] },
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-1" },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "selectSidebarFile", file: "a.ts" },
      { type: "mirrorAnnUrl", commentId: "ann-1" },
    ]);
  });

  it("cursor.set from CardAnchor to RowAnchor emits mirrorAnnUrl { commentId: null }", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 4 }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 4 },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "selectSidebarFile", file: "foo.ts" },
      { type: "mirrorAnnUrl", commentId: null },
    ]);
  });

  it("cursor.set from CardAnchor in file A to CardAnchor in file A emits no sidebar selection", () => {
    const ann1 = mkComment({ id: "ann-1", file: "a.ts" });
    const ann2 = mkComment({ id: "ann-2", file: "a.ts" });
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: { ...okBundle("tour-a", [bundleFile("a.ts")]), comments: [ann1, ann2] },
    }).state;
    s = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-2" }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-2" },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "mirrorAnnUrl", commentId: "ann-2" },
    ]);
  });

  it("cursor.set from CardAnchor in file A to RowAnchor in file B emits sidebar selection for file B", () => {
    const ann = mkComment({ id: "ann-1", file: "a.ts" });
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: {
        ...okBundle("tour-a", [bundleFile("a.ts"), bundleFile("b.ts")]),
        comments: [ann],
      },
    }).state;
    s = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: rowAnchor({ file: "b.ts", lineNumber: 4 }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "b.ts", side: "additions", lineNumber: 4 },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "selectSidebarFile", file: "b.ts" },
      { type: "mirrorAnnUrl", commentId: null },
    ]);
  });

  it("cursor.set from CardAnchor to a different CardAnchor emits mirrorAnnUrl { newId } (no selectSidebarFile)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-2" }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-2" },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "mirrorAnnUrl", commentId: "ann-2" },
    ]);
  });

  it("cursor.set within the same Card (same commentId) emits scrollCursorTarget but no mirrorAnnUrl", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1", preferredSide: "deletions" }),
    });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-1" },
        placement: "nearest",
        behavior: "smooth",
      },
    ]);
  });

  it("cursor.clear sets the slice to null and clears sidebar selection when prior was a RowAnchor", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, { type: "cursor.clear" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([{ type: "selectSidebarFile", file: null }]);
  });

  it("cursor.clear after a CardAnchor clears sidebar selection and emits mirrorAnnUrl { commentId: null }", () => {
    const ann = mkComment({ id: "ann-1", file: "a.ts" });
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: { ...okBundle("tour-a", [bundleFile("a.ts")]), comments: [ann] },
    }).state;
    s = reduce(s, {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, { type: "cursor.clear" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([
      { type: "selectSidebarFile", file: null },
      { type: "mirrorAnnUrl", commentId: null },
    ]);
  });

  it("cursor.clear on a null cursor is a no-op (same state ref, no intents)", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "cursor.clear" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  // Issue #348: `placement` and `behavior` are independent axes on the
  // `scrollCursorTarget` intent. `cursor.set` accepts both as optional
  // fields; when `behavior` is omitted the reducer fills in the
  // `center → instant, nearest → smooth` default. `n` / `p` jump sites
  // pass `placement: "center", behavior: "smooth"` to land mid-viewport
  // with a perceptible tween between adjacent cards.
  describe("cursor.set — placement / behavior axis decoupling (issue #348)", () => {
    it("n/p shape (placement: 'center', behavior: 'smooth') emits center + smooth", () => {
      const r = reduce(initialTourSessionState(), {
        type: "cursor.set",
        anchor: cardAnchor({ commentId: "ann-9" }),
        placement: "center",
        behavior: "smooth",
      });
      expect(r.intents[0]).toEqual({
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-9" },
        placement: "center",
        behavior: "smooth",
      });
    });

    it("default behavior for placement: 'center' is 'instant' (URL ?ann= restore)", () => {
      const r = reduce(initialTourSessionState(), {
        type: "cursor.set",
        anchor: cardAnchor({ commentId: "ann-1" }),
        placement: "center",
      });
      expect(r.intents[0]).toEqual({
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-1" },
        placement: "center",
        behavior: "instant",
      });
    });

    it("default placement (no field) is 'nearest' with default behavior 'smooth' (j/k + click)", () => {
      const r = reduce(initialTourSessionState(), {
        type: "cursor.set",
        anchor: rowAnchor({ file: "foo.ts", lineNumber: 3 }),
      });
      expect(r.intents[0]).toEqual({
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 3 },
        placement: "nearest",
        behavior: "smooth",
      });
    });

    it("explicit behavior overrides the placement-derived default (nearest + instant for retry budget)", () => {
      const r = reduce(initialTourSessionState(), {
        type: "cursor.set",
        anchor: rowAnchor({ file: "foo.ts", lineNumber: 3 }),
        placement: "nearest",
        behavior: "instant",
      });
      expect(r.intents[0]).toEqual({
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 3 },
        placement: "nearest",
        behavior: "instant",
      });
    });
  });

  it("cursor.materialize on a null cursor sets the cursor and emits the same intents as cursor.set", () => {
    const anchor = cardAnchor({ commentId: "ann-5" });
    const r = reduce(initialTourSessionState(), { type: "cursor.materialize", anchor });
    expect(r.state.cursor).toBe(anchor);
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-5" },
        placement: "center",
        behavior: "instant",
      },
      { type: "mirrorAnnUrl", commentId: "ann-5" },
    ]);
  });

  it("cursor.materialize from null to CardAnchor emits sidebar selection for the comment file", () => {
    const ann = mkComment({ id: "ann-5", file: "a.ts" });
    const s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: { ...okBundle("tour-a", [bundleFile("a.ts")]), comments: [ann] },
    }).state;
    const anchor = cardAnchor({ commentId: "ann-5" });
    const r = reduce(s, { type: "cursor.materialize", anchor });
    expect(r.state.cursor).toBe(anchor);
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "ann-5" },
        placement: "center",
        behavior: "instant",
      },
      { type: "selectSidebarFile", file: "a.ts" },
      { type: "mirrorAnnUrl", commentId: "ann-5" },
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
      anchor: cardAnchor({ commentId: "ann-1", preferredSide: "additions" }),
    }).state;
    const r = reduce(s, { type: "cursor.setSide", side: "deletions" });
    expect(r.state.cursor).toEqual({
      kind: "card",
      commentId: "ann-1",
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

  it("expansion.expandFileAll saturates every boundary in the named file in one dispatch (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "expansion.expandFileAll",
      file: "foo.ts",
      boundaries: [
        { ref: "top", gapSize: 12 },
        { ref: 1, gapSize: 30 },
        { ref: "bottom", gapSize: 8 },
      ],
    });
    const file = r.state.expansion.get("foo.ts");
    expect(file?.boundaries.get("top")).toEqual({ up: 12, down: 0 });
    const sep = file?.boundaries.get(1);
    expect((sep?.up ?? 0) + (sep?.down ?? 0)).toBe(30);
    expect(file?.boundaries.get("bottom")).toEqual({ up: 0, down: 8 });
    expect(r.intents).toEqual([]);
  });

  it("expansion.expandFileAll on an empty boundary list is a same-ref no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, {
      type: "expansion.expandFileAll",
      file: "foo.ts",
      boundaries: [],
    });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("expansion.expandFileAll leaves other files unchanged", () => {
    let s = reduce(initialTourSessionState(), {
      type: "expansion.expand",
      file: "bar.ts",
      ref: 1,
      direction: "both",
      mode: "symmetric-20",
      gapSize: 100,
    }).state;
    s = reduce(s, {
      type: "expansion.expandFileAll",
      file: "foo.ts",
      boundaries: [{ ref: 1, gapSize: 30 }],
    }).state;
    expect(s.expansion.get("bar.ts")?.boundaries.get(1)).toEqual({ up: 10, down: 10 });
    const foo = s.expansion.get("foo.ts")?.boundaries.get(1);
    expect((foo?.up ?? 0) + (foo?.down ?? 0)).toBe(30);
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

describe("reduce — structural cursor validation on bundle.refreshed (issue #413 / PRD #412)", () => {
  it("bundle.refreshed with cursor === null leaves cursor null and emits no intents", () => {
    const r = reduce(initialTourSessionState(), {
      type: "bundle.refreshed",
      bundle: mkBundle("a"),
    });
    expect(r.intents).toEqual([]);
  });

  it("clears a RowAnchor whose file disappeared from the refreshed bundle", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 42 }),
    }).state;
    const r = reduce(s, { type: "bundle.refreshed", bundle: mkBundle("a") });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([]);
  });

  it("clears a CardAnchor whose comment is deleted in the refreshed bundle", () => {
    const live = mkComment({ id: "ann-1", file: "foo.ts" });
    const deleted = { ...live, deleted: { at: "2026-05-18T00:00:00Z" } };
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "a",
      bundle: { ...okBundle("a", [bundleFile("foo.ts")]), comments: [live] },
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "ann-1" }) }).state;
    const r = reduce(s, {
      type: "bundle.refreshed",
      bundle: { ...okBundle("a", [bundleFile("foo.ts")]), comments: [deleted] },
    });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([{ type: "mirrorAnnUrl", commentId: null }]);
  });

  it("preserves valid RowAnchor and CardAnchor cursors and emits revalidateCursor", () => {
    const ann = mkComment({ id: "ann-1", file: "foo.ts" });
    const bundle = { ...okBundle("a", [bundleFile("foo.ts")]), comments: [ann] };
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "a",
      bundle,
    }).state;
    const row = rowAnchor({ file: "foo.ts", lineNumber: 42 });
    s = reduce(s, { type: "cursor.set", anchor: row }).state;
    const rowRefresh = reduce(s, { type: "bundle.refreshed", bundle });
    expect(rowRefresh.state.cursor).toBe(row);
    expect(rowRefresh.intents).toEqual([{ type: "revalidateCursor" }]);

    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "ann-1" }) }).state;
    const cardRefresh = reduce(s, { type: "bundle.refreshed", bundle });
    expect(cardRefresh.state.cursor).toEqual(cardAnchor({ commentId: "ann-1" }));
    expect(cardRefresh.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("emits sidebar selection when a kept CardAnchor resolves to a renamed file", () => {
    const before = mkComment({ id: "ann-1", file: "old.ts" });
    const after = mkComment({ id: "ann-1", file: "new.ts" });
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "a",
      bundle: { ...okBundle("a", [bundleFile("old.ts")]), comments: [before] },
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "ann-1" }) }).state;
    const r = reduce(s, {
      type: "bundle.refreshed",
      bundle: { ...okBundle("a", [bundleFile("new.ts")]), comments: [after] },
    });
    expect(r.state.cursor).toEqual(cardAnchor({ commentId: "ann-1" }));
    expect(r.intents).toEqual([
      { type: "selectSidebarFile", file: "new.ts" },
      { type: "revalidateCursor" },
    ]);
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

describe("cross-async fixture — watcher reload revalidates projection through the runtime", () => {
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

  it("bundle.refreshed emits revalidateCursor when a still-present file keeps a RowAnchor structurally valid", () => {
    const store = new TourSessionStore();
    const intents: Intent[] = [];
    store.onIntent((i) => intents.push(i));
    store.dispatch({
      type: "tour.switched",
      tourId: "a",
      bundle: okBundle("a", [bundleFile("foo.ts")]),
    });
    intents.length = 0;

    // Seed: cursor pinned to (foo, line 42, additions).
    const initialAnchor: Cursor = rowAnchor({
      file: "foo.ts",
      lineNumber: 42,
      side: "additions",
    });
    store.dispatch({ type: "cursor.set", anchor: initialAnchor });

    // Intent stream so far: cursor.set's two intents (scroll + sidebar
    // select; the prev-null state means no mirror-null is emitted).
    expect(intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "row", file: "foo.ts", side: "additions", lineNumber: 42 },
        placement: "nearest",
        behavior: "smooth",
      },
      { type: "selectSidebarFile", file: "foo.ts" },
    ]);
    intents.length = 0;

    const refreshedBundle = okBundle("a", [bundleFile("foo.ts")]);
    store.dispatch({ type: "bundle.refreshed", bundle: refreshedBundle });

    expect(store.getState().cursor).toBe(initialAnchor);
    expect(intents).toEqual([{ type: "revalidateCursor" }]);

    const newFlatRows: FlatRow[] = [diffRow("foo.ts", 1), diffRow("foo.ts", 2)];
    const files: ReadonlyArray<{ name: string }> = [{ name: "foo.ts" }];
    expect(validateCursor(store.getState().cursor, newFlatRows, files)).toEqual(
      rowAnchor({ file: "foo.ts", lineNumber: 1 }),
    );
    expect(cursorAtFirstFileRow("foo.ts", newFlatRows)).toEqual(
      rowAnchor({ file: "foo.ts", lineNumber: 1 }),
    );
  });

  it("when the cursor's file vanishes entirely, bundle.refreshed clears state.cursor directly", () => {
    const store = new TourSessionStore();
    const intents: Intent[] = [];
    store.onIntent((i) => intents.push(i));
    store.dispatch({
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 1 }),
    });
    intents.length = 0;
    store.dispatch({ type: "bundle.refreshed", bundle: mkBundle("a") });
    expect(store.getState().cursor).toBeNull();
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

// --- Slice 3 (PRD #234 / issue #236) ----------------------------------------

function topLevelTarget(
  over: Partial<{
    file: string;
    side: "additions" | "deletions";
    line_start: number;
    line_end: number;
  }> = {},
): ComposerTarget {
  return {
    kind: "top-level",
    file: over.file ?? "foo.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 10,
    line_end: over.line_end ?? 10,
  };
}

function replyTarget(replies_to: string = "parent-1"): ComposerTarget {
  return { kind: "reply", replies_to };
}

function mkComment(over: Partial<Comment> & { id: string }): Comment {
  return {
    id: over.id,
    file: over.file ?? "foo.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 10,
    line_end: over.line_end ?? 10,
    body: over.body ?? "body text",
    author: over.author ?? "claude",
    author_kind: over.author_kind ?? "agent",
    created_at: over.created_at ?? "2026-05-13T00:00:00Z",
    ...(over.replies_to !== undefined ? { replies_to: over.replies_to } : {}),
  };
}

function stateWithTourLoaded(tourId: string = "tour-a"): TourSessionState {
  return reduce(initialTourSessionState(), {
    type: "tour.switched",
    tourId,
    bundle: mkBundle(tourId),
  }).state;
}

function stateWithOkTourLoaded(tourId: string = "tour-a"): TourSessionState {
  return reduce(initialTourSessionState(), {
    type: "tour.switched",
    tourId,
    bundle: okBundle(tourId, [bundleFile("foo.ts")]),
  }).state;
}

describe("reduce — composer slice (slice 3 foundation)", () => {
  it("composer.open from closed → { kind: 'open', target, body: '' } (no intents)", () => {
    const target = topLevelTarget({ line_start: 7, line_end: 9 });
    const r = reduce(initialTourSessionState(), { type: "composer.open", target });
    expect(r.state.composer).toEqual({ kind: "open", target, body: "" });
    expect(r.intents).toEqual([]);
  });

  it("composer.open from open re-targets and clears body (no stale draft text)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "composer.open",
      target: topLevelTarget({ file: "foo.ts" }),
    }).state;
    s = reduce(s, { type: "composer.setBody", body: "stale draft" }).state;
    const t2 = replyTarget("ann-99");
    const r = reduce(s, { type: "composer.open", target: t2 });
    expect(r.state.composer).toEqual({ kind: "open", target: t2, body: "" });
    expect(r.intents).toEqual([]);
  });

  it("composer.open from submitting / errored re-targets and clears body", () => {
    let s: TourSessionState = stateWithTourLoaded();
    s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
    s = reduce(s, { type: "composer.setBody", body: "draft" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    expect(s.composer.kind).toBe("submitting");
    const t2 = replyTarget("ann-7");
    const r1 = reduce(s, { type: "composer.open", target: t2 });
    expect(r1.state.composer).toEqual({ kind: "open", target: t2, body: "" });

    let s2: TourSessionState = stateWithTourLoaded();
    s2 = reduce(s2, { type: "composer.open", target: topLevelTarget() }).state;
    s2 = reduce(s2, { type: "composer.setBody", body: "draft" }).state;
    s2 = reduce(s2, { type: "composer.submit" }).state;
    s2 = reduce(s2, { type: "composer.failed", error: "boom" }).state;
    expect(s2.composer.kind).toBe("errored");
    const r2 = reduce(s2, { type: "composer.open", target: t2 });
    expect(r2.state.composer).toEqual({ kind: "open", target: t2, body: "" });
  });

  it("composer.setBody updates body on open / submitting / errored", () => {
    let s: TourSessionState = stateWithTourLoaded();
    s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
    s = reduce(s, { type: "composer.setBody", body: "open-body" }).state;
    expect((s.composer as { body: string }).body).toBe("open-body");

    s = reduce(s, { type: "composer.submit" }).state;
    expect(s.composer.kind).toBe("submitting");
    s = reduce(s, { type: "composer.setBody", body: "while-submitting" }).state;
    expect((s.composer as { body: string }).body).toBe("while-submitting");

    s = reduce(s, { type: "composer.failed", error: "boom" }).state;
    expect(s.composer.kind).toBe("errored");
    s = reduce(s, { type: "composer.setBody", body: "edited-after-error" }).state;
    expect((s.composer as { body: string }).body).toBe("edited-after-error");
  });

  it("composer.setBody on closed is a strict no-op (same state ref, no intents)", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "composer.setBody", body: "anything" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("composer.setBody with the same body is a same-state-ref no-op", () => {
    let s = reduce(initialTourSessionState(), {
      type: "composer.open",
      target: topLevelTarget(),
    }).state;
    s = reduce(s, { type: "composer.setBody", body: "same" }).state;
    const r = reduce(s, { type: "composer.setBody", body: "same" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("composer.submit on open → submitting; emits submitComment { tourId, target, body }", () => {
    let s = stateWithTourLoaded("tour-a");
    const target = topLevelTarget({ file: "foo.ts", line_start: 1, line_end: 1 });
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "the draft" }).state;
    const r = reduce(s, { type: "composer.submit" });
    expect(r.state.composer).toEqual({ kind: "submitting", target, body: "the draft" });
    expect(r.intents).toEqual([
      { type: "submitComment", tourId: "tour-a", target, body: "the draft" },
    ]);
  });

  it("composer.submit on closed / submitting / errored is a no-op (same state ref, no intents)", () => {
    // closed
    const closedBefore = stateWithTourLoaded();
    const r1 = reduce(closedBefore, { type: "composer.submit" });
    expect(r1.state).toBe(closedBefore);
    expect(r1.intents).toEqual([]);

    // submitting
    let s2 = stateWithTourLoaded();
    s2 = reduce(s2, { type: "composer.open", target: topLevelTarget() }).state;
    s2 = reduce(s2, { type: "composer.setBody", body: "x" }).state;
    s2 = reduce(s2, { type: "composer.submit" }).state;
    const r2 = reduce(s2, { type: "composer.submit" });
    expect(r2.state).toBe(s2);
    expect(r2.intents).toEqual([]);

    // errored
    let s3 = stateWithTourLoaded();
    s3 = reduce(s3, { type: "composer.open", target: topLevelTarget() }).state;
    s3 = reduce(s3, { type: "composer.setBody", body: "x" }).state;
    s3 = reduce(s3, { type: "composer.submit" }).state;
    s3 = reduce(s3, { type: "composer.failed", error: "boom" }).state;
    const r3 = reduce(s3, { type: "composer.submit" });
    expect(r3.state).toBe(s3);
    expect(r3.intents).toEqual([]);
  });

  it("composer.submitted on submitting → closed; emits applyPostSubmitLanding (no synchronous cursor move — issue #405)", () => {
    // Issue #392: the bundle fold no longer happens inline. Issue #405:
    // the cursor re-anchor no longer happens inline either — the
    // synchronous cursor write was racing the deferred bundle fold and
    // App.tsx's cursor-reconcile useEffect cleared the orphan
    // CardAnchor. Both the fold and the cursor land atomically on the
    // runtime-deferred `bundle.commentInsertedWithLanding` action; this
    // reducer branch only closes the composer and emits the deferred-
    // landing intent.
    let s = stateWithTourLoaded();
    s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
    s = reduce(s, { type: "composer.setBody", body: "draft" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    const cursorBefore = s.cursor;
    const ann = mkComment({ id: "fresh-ann-1" });
    const r = reduce(s, { type: "composer.submitted", comment: ann });
    expect(r.state.composer).toEqual({ kind: "closed" });
    // Cursor is unchanged here — it lands in the deferred dispatch.
    expect(r.state.cursor).toEqual(cursorBefore);
    expect(r.intents).toEqual([
      {
        type: "applyPostSubmitLanding",
        comment: ann,
        preferredSide: "additions",
      },
    ]);
  });

  it("composer.submitted on non-submitting states is a no-op (same state ref, no intents)", () => {
    const ann = mkComment({ id: "x" });
    // closed
    const before = initialTourSessionState();
    const r1 = reduce(before, { type: "composer.submitted", comment: ann });
    expect(r1.state).toBe(before);
    expect(r1.intents).toEqual([]);
    // open
    const opened = reduce(before, { type: "composer.open", target: topLevelTarget() }).state;
    const r2 = reduce(opened, { type: "composer.submitted", comment: ann });
    expect(r2.state).toBe(opened);
    expect(r2.intents).toEqual([]);
  });

  // Issue #322: optimistic comment insert — the freshly-created Comment
  // must materialise into the resolved bundle's comments array before the
  // SSE-driven `bundle.refreshed` round-trip (~500-600ms on large tours).
  //
  // Issue #392: the fold no longer happens inline in `composer.submitted`
  // — it ships via a separate action the runtime dispatches after a
  // ~50 ms timer, so the composer-overlay unmount and the height-
  // changing CommentRow add land in two distinct React commits (opentui's
  // yoga layout pass crashed when both happened in the same commit).
  //
  // Issue #405: the cursor re-anchor was synchronous in `composer.submitted`
  // and raced the deferred fold. The fix unifies bundle fold + cursor
  // landing in one atomic action — `bundle.commentInsertedWithLanding`
  // — so the cursor never points at a Comment id that isn't already in
  // `bundle.comments`. Append-if-absent semantics are preserved;
  // cursor lands on the new Comment with the supplied `preferredSide`.
  describe("bundle.commentInsertedWithLanding atomic fold + cursor landing (issue #322 + #392 + #405)", () => {
    it("appends to a resolved snapshot-lost bundle but does not land an invalid cursor", () => {
      let s = stateWithTourLoaded();
      const ann = mkComment({ id: "fresh-ann-1" });
      const r = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      });
      expect(r.state.bundle.kind).toBe("ok");
      if (r.state.bundle.kind === "ok") {
        expect(r.state.bundle.value.comments.map((a) => a.id)).toContain("fresh-ann-1");
        // Variant is preserved across the optimistic fold.
        expect(r.state.bundle.value.kind).toBe("snapshot-lost");
      }
      expect(r.state.cursor).toBeNull();
      expect(r.intents).toEqual([]);
    });

    it("appends the new comment to a resolved ok-bundle's comments array (preserves diff + files)", () => {
      const b = okBundle("tour-a", [bundleFile("foo.ts")]);
      let s = reduce(initialTourSessionState(), {
        type: "tour.switched",
        tourId: "tour-a",
        bundle: b,
      }).state;
      const ann = mkComment({ id: "fresh-ann-ok" });
      const r = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      });
      expect(r.state.bundle.kind).toBe("ok");
      if (r.state.bundle.kind === "ok") {
        expect(r.state.bundle.value.kind).toBe("ok");
        expect(r.state.bundle.value.comments.map((a) => a.id)).toContain("fresh-ann-ok");
        if (r.state.bundle.value.kind === "ok") {
          // diff / files refs preserved (no full bundle rebuild).
          expect(r.state.bundle.value.diff).toBe(b.diff);
          expect(r.state.bundle.value.files).toBe(b.files);
        }
      }
    });

    it("reply path produces the same fold (parent retained, reply appended) and lands cursor on the reply", () => {
      const parent = mkComment({ id: "parent-1" });
      const b: TourBundle = {
        ...okBundle("tour-a", [bundleFile("foo.ts")]),
        comments: [parent],
      };
      let s = reduce(initialTourSessionState(), {
        type: "tour.switched",
        tourId: "tour-a",
        bundle: b,
      }).state;
      const reply = mkComment({ id: "reply-1", replies_to: "parent-1" });
      const r = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: reply,
        preferredSide: "additions",
      });
      expect(r.state.bundle.kind).toBe("ok");
      if (r.state.bundle.kind === "ok") {
        const ids = r.state.bundle.value.comments.map((a) => a.id);
        expect(ids).toEqual(["parent-1", "reply-1"]);
      }
      expect(r.state.cursor).toEqual({
        kind: "card",
        commentId: "reply-1",
        preferredSide: "additions",
      });
    });

    it("preferredSide is carried through to the new CardAnchor", () => {
      let s = stateWithOkTourLoaded();
      const ann = mkComment({ id: "fresh-with-side" });
      const r = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "deletions",
      });
      expect(r.state.cursor).toEqual({
        kind: "card",
        commentId: "fresh-with-side",
        preferredSide: "deletions",
      });
    });

    it("is idempotent on the fold: a second insert for the same id does not duplicate (cursor still re-lands)", () => {
      let s = stateWithOkTourLoaded();
      const ann = mkComment({ id: "dedup-1" });
      s = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      }).state;
      const r = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      });
      // Bundle slice ref-equal — fold portion is a no-op since the id
      // is already present (so the bundle.comments array isn't rebuilt).
      expect(r.state.bundle).toBe(s.bundle);
      if (r.state.bundle.kind === "ok") {
        const matching = r.state.bundle.value.comments.filter((a) => a.id === "dedup-1");
        expect(matching).toHaveLength(1);
      }
      // mirrorAnnUrl is NOT emitted — comment id under the cursor is
      // unchanged across the second dispatch. scrollCursorTarget still
      // fires (re-centers the cursor target, harmless on duplicate).
      expect(r.intents).toEqual([
        {
          type: "scrollCursorTarget",
          target: { kind: "card", commentId: "dedup-1" },
          placement: "center",
          behavior: "instant",
        },
      ]);
    });

    it("subsequent bundle.refreshed carrying the same id results in exactly one occurrence (no duplicate)", () => {
      let s = stateWithTourLoaded();
      const ann = mkComment({ id: "dedup-1" });
      s = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      }).state;
      // Server bundle from the SSE-triggered refetch — also carries the
      // same comment. The refresh must overwrite the optimistic copy,
      // not double-insert.
      const refreshed: TourBundle = {
        kind: "snapshot-lost",
        tour: tour({ id: "tour-a" }),
        comments: [ann],
      };
      const r = reduce(s, { type: "bundle.refreshed", bundle: refreshed });
      expect(r.state.bundle.kind).toBe("ok");
      if (r.state.bundle.kind === "ok") {
        const matching = r.state.bundle.value.comments.filter((a) => a.id === "dedup-1");
        expect(matching).toHaveLength(1);
      }
    });

    it("subsequent bundle.refreshed NOT carrying the id overwrites the optimistic insert (server wins on divergence)", () => {
      let s = stateWithTourLoaded();
      const optimistic = mkComment({ id: "optimistic-1" });
      s = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: optimistic,
        preferredSide: "additions",
      }).state;
      // Multi-client scenario: another writer concurrently created a
      // different comment; ours never reached disk. The refreshed
      // bundle carries someone else's comment but not ours.
      const otherAnn = mkComment({ id: "other-writer-1" });
      const refreshed: TourBundle = {
        kind: "snapshot-lost",
        tour: tour({ id: "tour-a" }),
        comments: [otherAnn],
      };
      const r = reduce(s, { type: "bundle.refreshed", bundle: refreshed });
      expect(r.state.bundle.kind).toBe("ok");
      if (r.state.bundle.kind === "ok") {
        const ids = r.state.bundle.value.comments.map((a) => a.id);
        expect(ids).toEqual(["other-writer-1"]);
        expect(ids).not.toContain("optimistic-1");
      }
    });

    it("is a no-op when the bundle isn't resolved (defence in depth; state ref-equal, cursor untouched)", () => {
      // Hand-construct a state with a non-ok bundle slice — the runtime
      // already gates `composer.submit` on a resolved bundle, but the
      // reducer must defensively no-op so a late timer dispatch after
      // the bundle dropped out doesn't crash. The cursor must NOT land
      // on a CardAnchor that the bundle can't resolve — the validator
      // would project to null and the cursor-reconcile useEffect would
      // clear it (the exact race the atomic-landing action closes).
      const base = initialTourSessionState();
      const s: TourSessionState = {
        ...base,
        currentTourId: "tour-a",
        bundle: { kind: "loading" },
      };
      const ann = mkComment({ id: "fresh-but-bundleless" });
      const r = reduce(s, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      });
      expect(r.state).toBe(s);
      expect(r.intents).toEqual([]);
    });
  });

  describe("composer.submitted decouples the bundle fold AND cursor landing (issue #392 + #405)", () => {
    it("does NOT mutate bundle.comments inline — bundle slice ref-equal across the dispatch", () => {
      let s = stateWithTourLoaded();
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "draft" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const bundleBefore = s.bundle;
      const ann = mkComment({ id: "fresh-1" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      // Bundle slice unchanged — the fold ships on a separate dispatch
      // that the runtime queues for the next timer tick.
      expect(r.state.bundle).toBe(bundleBefore);
      // Composer still transitions to closed in the same commit.
      expect(r.state.composer).toEqual({ kind: "closed" });
    });

    it("does NOT mutate the cursor inline — cursor slice ref-equal across the dispatch (issue #405)", () => {
      // The cursor used to re-anchor synchronously in `composer.submitted`
      // (issue #401's fix), but the synchronous CardAnchor pointed at a
      // Comment id not yet in `bundle.comments`, and the validator
      // cleared it before the deferred fold landed. The atomic-landing
      // action (`bundle.commentInsertedWithLanding`) owns the cursor
      // move now — `composer.submitted` is cursor-neutral.
      let s = stateWithTourLoaded();
      const cursorBefore: Cursor = {
        kind: "row",
        file: "foo.ts",
        side: "additions",
        lineNumber: 10,
        preferredSide: "additions",
      };
      s = reduce(s, { type: "cursor.set", anchor: cursorBefore }).state;
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "draft" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const ann = mkComment({ id: "fresh-1" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      expect(r.state.cursor).toBe(s.cursor);
    });

    it("emits applyPostSubmitLanding carrying the new Comment + pre-submit preferredSide (no inline cursor intents)", () => {
      let s = stateWithTourLoaded();
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "draft" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const ann = mkComment({ id: "fresh-1" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      expect(r.intents).toEqual([
        {
          type: "applyPostSubmitLanding",
          comment: ann,
          preferredSide: "additions",
        },
      ]);
    });

    it("emits the same intent stream regardless of bundle slice state (runtime + deferred reducer own the bundle guard)", () => {
      // The reducer no longer peeks at the bundle. The runtime's
      // deferred `bundle.commentInsertedWithLanding` dispatch is the
      // home of the bundle-resolved check. This keeps the reducer's
      // branch shape uniform across bundle states and lets the failure-
      // recovery path (composer.submit while bundle is loading) close
      // cleanly.
      const base = initialTourSessionState();
      const s: TourSessionState = {
        ...base,
        currentTourId: "tour-a",
        bundle: { kind: "loading" },
        composer: {
          kind: "submitting",
          target: topLevelTarget(),
          body: "draft",
        },
      };
      const ann = mkComment({ id: "fresh-but-bundleless" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      expect(r.state.composer).toEqual({ kind: "closed" });
      expect(r.state.bundle).toEqual({ kind: "loading" });
      expect(r.intents).toEqual([
        {
          type: "applyPostSubmitLanding",
          comment: ann,
          preferredSide: "additions",
        },
      ]);
    });
  });

  // Issue #401 + #405: after a successful submit, the cursor re-anchors
  // to the freshly-created Comment so focus follows the new Card. The
  // re-anchor happens atomically with the deferred bundle fold on the
  // `bundle.commentInsertedWithLanding` action — not synchronously in
  // `composer.submitted`. The synchronous path (issue #401's original
  // fix) created a transient orphan-CardAnchor window in which the
  // cursor-reconcile useEffect cleared the cursor (issue #405).
  // Reply-composer and top-level-composer paths share the same landing
  // semantics; the `applyPostSubmitLanding` intent carries the
  // pre-submit cursor's `preferredSide` through to the deferred dispatch.
  describe("post-submit cursor landing on bundle.commentInsertedWithLanding (issue #401 + #405)", () => {
    it("reply-composer submit emits applyPostSubmitLanding with the new Comment + parent's preferredSide", () => {
      const parent = mkComment({ id: "parent-1" });
      const b: TourBundle = {
        ...okBundle("tour-a", [bundleFile("foo.ts")]),
        comments: [parent],
      };
      let s = reduce(initialTourSessionState(), {
        type: "tour.switched",
        tourId: "tour-a",
        bundle: b,
      }).state;
      // Cursor parked on the parent Card (matches the reply-composer's
      // typical pre-submit anchor).
      s = reduce(s, {
        type: "cursor.set",
        anchor: { kind: "card", commentId: "parent-1", preferredSide: "additions" },
      }).state;
      s = reduce(s, { type: "composer.open", target: replyTarget("parent-1") }).state;
      s = reduce(s, { type: "composer.setBody", body: "reply" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const reply = mkComment({ id: "reply-1", replies_to: "parent-1" });
      const r = reduce(s, { type: "composer.submitted", comment: reply });
      expect(r.intents).toEqual([
        {
          type: "applyPostSubmitLanding",
          comment: reply,
          preferredSide: "additions",
        },
      ]);
      // The deferred dispatch is what actually lands the cursor. Pin
      // the end-state by running the action the runtime would dispatch.
      const r2 = reduce(r.state, {
        type: "bundle.commentInsertedWithLanding",
        comment: reply,
        preferredSide: "additions",
      });
      expect(r2.state.cursor).toEqual({
        kind: "card",
        commentId: "reply-1",
        preferredSide: "additions",
      });
    });

    it("top-level submit from a RowAnchor lands the cursor on the new Comment via the deferred dispatch", () => {
      let s = stateWithOkTourLoaded();
      s = reduce(s, {
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "foo.ts",
          side: "additions",
          lineNumber: 10,
          preferredSide: "additions",
        },
      }).state;
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "draft" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const ann = mkComment({ id: "fresh-top-level-1" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      const r2 = reduce(r.state, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "additions",
      });
      expect(r2.state.cursor).toEqual({
        kind: "card",
        commentId: "fresh-top-level-1",
        preferredSide: "additions",
      });
    });

    it("preferredSide on the new CardAnchor is inherited from the pre-submit cursor (intent payload + deferred landing)", () => {
      let s = stateWithOkTourLoaded();
      // Park on a RowAnchor whose preferredSide is "deletions" (e.g. an
      // `h` flip on the diff before opening the composer).
      s = reduce(s, {
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "foo.ts",
          side: "deletions",
          lineNumber: 10,
          preferredSide: "deletions",
        },
      }).state;
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "x" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const ann = mkComment({ id: "fresh-2" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      // preferredSide carried on the deferred-landing intent.
      expect(r.intents).toEqual([
        {
          type: "applyPostSubmitLanding",
          comment: ann,
          preferredSide: "deletions",
        },
      ]);
      const r2 = reduce(r.state, {
        type: "bundle.commentInsertedWithLanding",
        comment: ann,
        preferredSide: "deletions",
      });
      expect(r2.state.cursor).toEqual({
        kind: "card",
        commentId: "fresh-2",
        preferredSide: "deletions",
      });
    });

    it("preferredSide falls back to 'additions' when the prior cursor was null", () => {
      let s = stateWithTourLoaded();
      // Cursor is null on a fresh load (lazy materialization).
      expect(s.cursor).toBeNull();
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "x" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const ann = mkComment({ id: "fresh-3" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      expect(r.intents).toEqual([
        {
          type: "applyPostSubmitLanding",
          comment: ann,
          preferredSide: "additions",
        },
      ]);
    });

    it("composer.submitted emits ONLY applyPostSubmitLanding (no synchronous scroll/mirror intents — issue #405)", () => {
      let s = stateWithTourLoaded();
      s = reduce(s, {
        type: "cursor.set",
        anchor: {
          kind: "row",
          file: "foo.ts",
          side: "additions",
          lineNumber: 10,
          preferredSide: "additions",
        },
      }).state;
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "x" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const ann = mkComment({ id: "fresh-4" });
      const r = reduce(s, { type: "composer.submitted", comment: ann });
      // No inline scrollCursorTarget / mirrorAnnUrl — they're emitted
      // when the deferred-landing action runs, atomically with the
      // bundle fold.
      expect(r.intents).toEqual([
        {
          type: "applyPostSubmitLanding",
          comment: ann,
          preferredSide: "additions",
        },
      ]);
    });

    it("end-to-end dispatch chain: composer.submitted then bundle.commentInsertedWithLanding lands the cursor with no orphan-CardAnchor window (issue #405)", () => {
      // This is the reducer-level pin on the race fix. After
      // composer.submitted, the cursor is still on its pre-submit
      // anchor — it does NOT yet point at the new Comment. The new
      // Comment is also NOT yet in bundle.comments. The deferred
      // dispatch atomically folds the comment AND lands the cursor on
      // it — so no intermediate state has cursor-points-at-orphan-id.
      const parent = mkComment({ id: "parent-1" });
      const b: TourBundle = {
        ...okBundle("tour-a", [bundleFile("foo.ts")]),
        comments: [parent],
      };
      let s = reduce(initialTourSessionState(), {
        type: "tour.switched",
        tourId: "tour-a",
        bundle: b,
      }).state;
      s = reduce(s, {
        type: "cursor.set",
        anchor: { kind: "card", commentId: "parent-1", preferredSide: "additions" },
      }).state;
      s = reduce(s, { type: "composer.open", target: replyTarget("parent-1") }).state;
      s = reduce(s, { type: "composer.setBody", body: "reply" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const reply = mkComment({ id: "reply-1", replies_to: "parent-1" });

      // composer.submitted commit — cursor and bundle both still pre-submit.
      const afterSubmitted = reduce(s, {
        type: "composer.submitted",
        comment: reply,
      }).state;
      expect(afterSubmitted.cursor).toEqual({
        kind: "card",
        commentId: "parent-1",
        preferredSide: "additions",
      });
      if (afterSubmitted.bundle.kind === "ok") {
        expect(
          afterSubmitted.bundle.value.comments.map((a) => a.id),
        ).toEqual(["parent-1"]);
      }

      // Deferred dispatch — bundle gains the reply AND cursor lands on
      // it in the same commit. No state in this chain has the cursor
      // pointing at a Comment id missing from bundle.comments.
      const afterLanding = reduce(afterSubmitted, {
        type: "bundle.commentInsertedWithLanding",
        comment: reply,
        preferredSide: "additions",
      }).state;
      expect(afterLanding.cursor).toEqual({
        kind: "card",
        commentId: "reply-1",
        preferredSide: "additions",
      });
      if (afterLanding.bundle.kind === "ok") {
        expect(
          afterLanding.bundle.value.comments.map((a) => a.id),
        ).toEqual(["parent-1", "reply-1"]);
      }
    });

    it("composer.failed leaves the cursor untouched (cursor only updates on the success branch)", () => {
      let s = stateWithTourLoaded();
      const cursorBefore: Cursor = {
        kind: "row",
        file: "foo.ts",
        side: "additions",
        lineNumber: 10,
        preferredSide: "additions",
      };
      s = reduce(s, { type: "cursor.set", anchor: cursorBefore }).state;
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "x" }).state;
      s = reduce(s, { type: "composer.submit" }).state;
      const r = reduce(s, { type: "composer.failed", error: "boom" });
      expect(r.state.cursor).toEqual(cursorBefore);
    });

    it("composer.close leaves the cursor untouched", () => {
      let s = stateWithTourLoaded();
      const cursorBefore: Cursor = {
        kind: "row",
        file: "foo.ts",
        side: "additions",
        lineNumber: 10,
        preferredSide: "additions",
      };
      s = reduce(s, { type: "cursor.set", anchor: cursorBefore }).state;
      s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
      s = reduce(s, { type: "composer.setBody", body: "x" }).state;
      const r = reduce(s, { type: "composer.close" });
      expect(r.state.cursor).toEqual(cursorBefore);
    });
  });

  it("composer.failed on submitting → errored, preserving target + body", () => {
    let s = stateWithTourLoaded();
    const target = topLevelTarget({ file: "z.ts", line_start: 3, line_end: 3 });
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "preserved body" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    const r = reduce(s, { type: "composer.failed", error: "permission denied" });
    expect(r.state.composer).toEqual({
      kind: "errored",
      target,
      body: "preserved body",
      error: "permission denied",
    });
    expect(r.intents).toEqual([]);
  });

  it("composer.failed on non-submitting states is a no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "composer.failed", error: "boom" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("composer.retry on errored → submitting; re-emits submitComment", () => {
    let s = stateWithTourLoaded("tour-x");
    const target = topLevelTarget();
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "retry body" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    s = reduce(s, { type: "composer.failed", error: "503" }).state;
    const r = reduce(s, { type: "composer.retry" });
    expect(r.state.composer).toEqual({ kind: "submitting", target, body: "retry body" });
    expect(r.intents).toEqual([
      { type: "submitComment", tourId: "tour-x", target, body: "retry body" },
    ]);
  });

  it("composer.retry on non-errored states is a no-op", () => {
    // open
    const opened = reduce(initialTourSessionState(), {
      type: "composer.open",
      target: topLevelTarget(),
    }).state;
    const r = reduce(opened, { type: "composer.retry" });
    expect(r.state).toBe(opened);
    expect(r.intents).toEqual([]);
  });

  it("composer.dismissError on errored → open with body preserved (no intents)", () => {
    let s = stateWithTourLoaded();
    const target = replyTarget("ann-1");
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "still-typing" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    s = reduce(s, { type: "composer.failed", error: "boom" }).state;
    const r = reduce(s, { type: "composer.dismissError" });
    expect(r.state.composer).toEqual({ kind: "open", target, body: "still-typing" });
    expect(r.intents).toEqual([]);
  });

  it("composer.dismissError on non-errored states is a no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "composer.dismissError" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("composer.close from any kind → closed (no intents)", () => {
    // From open
    let s1 = reduce(initialTourSessionState(), {
      type: "composer.open",
      target: topLevelTarget(),
    }).state;
    expect(reduce(s1, { type: "composer.close" }).state.composer).toEqual({ kind: "closed" });

    // From submitting
    let s2 = stateWithTourLoaded();
    s2 = reduce(s2, { type: "composer.open", target: topLevelTarget() }).state;
    s2 = reduce(s2, { type: "composer.setBody", body: "x" }).state;
    s2 = reduce(s2, { type: "composer.submit" }).state;
    expect(reduce(s2, { type: "composer.close" }).state.composer).toEqual({ kind: "closed" });

    // From errored
    let s3 = stateWithTourLoaded();
    s3 = reduce(s3, { type: "composer.open", target: topLevelTarget() }).state;
    s3 = reduce(s3, { type: "composer.setBody", body: "x" }).state;
    s3 = reduce(s3, { type: "composer.submit" }).state;
    s3 = reduce(s3, { type: "composer.failed", error: "y" }).state;
    expect(reduce(s3, { type: "composer.close" }).state.composer).toEqual({ kind: "closed" });
  });

  it("composer.close on closed is a same-state-ref no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "composer.close" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  // ------------------------------------------------------------------
  // composer.recall (issue #320)
  // ------------------------------------------------------------------

  it("composer.recall on open emits scrollToComposer with the open target (no state change)", () => {
    let s = stateWithTourLoaded();
    const target = topLevelTarget({ file: "foo.ts", line_start: 42, line_end: 42 });
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "in flight" }).state;
    const r = reduce(s, { type: "composer.recall" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([{ type: "scrollToComposer", target }]);
  });

  it("composer.recall on submitting emits scrollToComposer with the submitting target", () => {
    let s = stateWithTourLoaded();
    const target = topLevelTarget({ file: "bar.ts", line_start: 7, line_end: 7 });
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "x" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    expect(s.composer.kind).toBe("submitting");
    const r = reduce(s, { type: "composer.recall" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([{ type: "scrollToComposer", target }]);
  });

  it("composer.recall on errored emits scrollToComposer with the errored target", () => {
    let s = stateWithTourLoaded();
    const target = topLevelTarget();
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "x" }).state;
    s = reduce(s, { type: "composer.submit" }).state;
    s = reduce(s, { type: "composer.failed", error: "boom" }).state;
    const r = reduce(s, { type: "composer.recall" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([{ type: "scrollToComposer", target }]);
  });

  it("composer.recall while closed is a state no-op and emits no intent (defensive guard)", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "composer.recall" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("composer.recall on a reply composer emits the reply target verbatim", () => {
    let s = stateWithTourLoaded();
    const target = replyTarget("ann-42");
    s = reduce(s, { type: "composer.open", target }).state;
    const r = reduce(s, { type: "composer.recall" });
    expect(r.intents).toEqual([{ type: "scrollToComposer", target }]);
  });

  it("bundle.refreshed does not touch composer (kind / target / body all preserved)", () => {
    let s = stateWithTourLoaded("tour-a");
    const target = topLevelTarget({ file: "foo.ts", line_start: 5, line_end: 5 });
    s = reduce(s, { type: "composer.open", target }).state;
    s = reduce(s, { type: "composer.setBody", body: "preserved draft" }).state;
    const composerBefore = s.composer;
    const r = reduce(s, { type: "bundle.refreshed", bundle: mkBundle("tour-a") });
    // Same composer slice reference — bundle.refreshed never mutates it.
    expect(r.state.composer).toBe(composerBefore);
    expect(r.state.composer).toEqual({ kind: "open", target, body: "preserved draft" });
  });
});

describe("reduce — folds slice (slice 3 foundation)", () => {
  it("folds.toggleFolder adds a path that wasn't present", () => {
    const r = reduce(initialTourSessionState(), {
      type: "folds.toggleFolder",
      path: "src/web",
    });
    expect(r.state.collapsedFolders.has("src/web")).toBe(true);
    expect(r.intents).toEqual([]);
  });

  it("folds.toggleFolder removes a path that was already present", () => {
    let s = reduce(initialTourSessionState(), {
      type: "folds.toggleFolder",
      path: "src/web",
    }).state;
    s = reduce(s, { type: "folds.toggleFolder", path: "src/core" }).state;
    const r = reduce(s, { type: "folds.toggleFolder", path: "src/web" });
    expect(r.state.collapsedFolders.has("src/web")).toBe(false);
    expect(r.state.collapsedFolders.has("src/core")).toBe(true);
    expect(r.intents).toEqual([]);
  });

  it("folds.toggleFolder keeps other slices reference-stable", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    s = reduce(s, { type: "expansion.expandFile", file: "foo.ts" }).state;
    const r = reduce(s, { type: "folds.toggleFolder", path: "src" });
    expect(r.state.cursor).toBe(s.cursor);
    expect(r.state.expansion).toBe(s.expansion);
    expect(r.state.bundle).toBe(s.bundle);
    expect(r.state.picker).toBe(s.picker);
    expect(r.state.replyLock).toBe(s.replyLock);
    expect(r.state.composer).toBe(s.composer);
    expect(r.state.collapsedOverrides).toBe(s.collapsedOverrides);
  });

  it("folds.setOverride writes a file→boolean entry to the record", () => {
    const r = reduce(initialTourSessionState(), {
      type: "folds.setOverride",
      file: "foo.ts",
      value: true,
    });
    expect(r.state.collapsedOverrides).toEqual({ "foo.ts": true });
    expect(r.intents).toEqual([]);
  });

  it("folds.setOverride is a same-state-ref no-op when value is unchanged", () => {
    const s = reduce(initialTourSessionState(), {
      type: "folds.setOverride",
      file: "foo.ts",
      value: true,
    }).state;
    const r = reduce(s, { type: "folds.setOverride", file: "foo.ts", value: true });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("folds.setOverride toggles boolean values (true ↔ false)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "folds.setOverride",
      file: "foo.ts",
      value: true,
    }).state;
    s = reduce(s, { type: "folds.setOverride", file: "foo.ts", value: false }).state;
    expect(s.collapsedOverrides).toEqual({ "foo.ts": false });
  });

  it("folds.clearOverride removes the file from the record", () => {
    let s = reduce(initialTourSessionState(), {
      type: "folds.setOverride",
      file: "foo.ts",
      value: true,
    }).state;
    s = reduce(s, { type: "folds.setOverride", file: "bar.ts", value: false }).state;
    const r = reduce(s, { type: "folds.clearOverride", file: "foo.ts" });
    expect(r.state.collapsedOverrides).toEqual({ "bar.ts": false });
    expect(r.intents).toEqual([]);
  });

  it("folds.clearOverride is a same-state-ref no-op when the file is absent", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "folds.clearOverride", file: "ghost.ts" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("folds.clearAll empties both slices (collapsedFolders + collapsedOverrides)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "folds.toggleFolder",
      path: "src",
    }).state;
    s = reduce(s, { type: "folds.setOverride", file: "foo.ts", value: true }).state;
    const r = reduce(s, { type: "folds.clearAll" });
    expect(r.state.collapsedFolders).toEqual(new Set());
    expect(r.state.collapsedOverrides).toEqual({});
    expect(r.intents).toEqual([]);
  });

  it("folds.clearAll is a same-state-ref no-op when both slices are already empty", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "folds.clearAll" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });
});

describe("reduce — thread collapse slice (PRD #397 / ADR 0038)", () => {
  it("thread.collapse adds the id to the set; no intents when cursor is null", () => {
    const r = reduce(initialTourSessionState(), {
      type: "thread.collapse",
      id: "ann-1",
    });
    expect(r.state.collapsedThreads.has("ann-1")).toBe(true);
    expect(r.intents).toEqual([]);
  });

  it("thread.collapse is a same-state-ref no-op when the id is already present", () => {
    const s = reduce(initialTourSessionState(), {
      type: "thread.collapse",
      id: "ann-1",
    }).state;
    const r = reduce(s, { type: "thread.collapse", id: "ann-1" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("thread.expand removes the id from the set", () => {
    let s = reduce(initialTourSessionState(), {
      type: "thread.collapse",
      id: "ann-1",
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "ann-2" }).state;
    const r = reduce(s, { type: "thread.expand", id: "ann-1" });
    expect(r.state.collapsedThreads.has("ann-1")).toBe(false);
    expect(r.state.collapsedThreads.has("ann-2")).toBe(true);
    expect(r.intents).toEqual([]);
  });

  it("thread.expand is a same-state-ref no-op when the id is absent", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "thread.expand", id: "missing" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("thread.toggle flips membership (absent → present)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "thread.toggle",
      id: "ann-1",
    });
    expect(r.state.collapsedThreads.has("ann-1")).toBe(true);
  });

  it("thread.toggle flips membership (present → absent)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "thread.toggle",
      id: "ann-1",
    }).state;
    const r = reduce(s, { type: "thread.toggle", id: "ann-1" });
    expect(r.state.collapsedThreads.has("ann-1")).toBe(false);
  });

  it("thread.collapse with cursor !== null emits revalidateCursor (defence-in-depth for the validator clause)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const r = reduce(s, { type: "thread.collapse", id: "ann-1" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("thread.toggle with cursor !== null emits revalidateCursor on both directions", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    const collapseR = reduce(s, { type: "thread.toggle", id: "ann-1" });
    expect(collapseR.intents).toEqual([{ type: "revalidateCursor" }]);
    s = collapseR.state;
    const expandR = reduce(s, { type: "thread.toggle", id: "ann-1" });
    expect(expandR.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("thread.* keeps other slices reference-stable", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: cardAnchor({ commentId: "ann-1" }),
    }).state;
    s = reduce(s, { type: "expansion.expandFile", file: "foo.ts" }).state;
    s = reduce(s, { type: "folds.toggleFolder", path: "src" }).state;
    const r = reduce(s, { type: "thread.collapse", id: "ann-1" });
    expect(r.state.expansion).toBe(s.expansion);
    expect(r.state.bundle).toBe(s.bundle);
    expect(r.state.collapsedFolders).toBe(s.collapsedFolders);
    expect(r.state.collapsedOverrides).toBe(s.collapsedOverrides);
    expect(r.state.composer).toBe(s.composer);
  });

  it("tour.switched clears collapsedThreads", () => {
    let s = stateWithTourLoaded("tour-a");
    s = reduce(s, { type: "thread.collapse", id: "ann-1" }).state;
    s = reduce(s, { type: "thread.collapse", id: "ann-2" }).state;
    expect(s.collapsedThreads.size).toBe(2);
    const r = reduce(s, {
      type: "tour.switched",
      tourId: "tour-b",
      bundle: mkBundle("tour-b"),
    });
    expect(r.state.collapsedThreads).toEqual(new Set());
  });

  it("bundle.refreshed preserves collapsedThreads for ids that survive in topLevel", () => {
    const t1 = mkComment({ id: "t1" });
    const t2 = mkComment({ id: "t2" });
    const initial: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1, t2],
      diff: "",
      files: [],
    };
    let s: TourSessionState = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: initial,
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t1" }).state;
    s = reduce(s, { type: "thread.collapse", id: "t2" }).state;
    const refreshed: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1, t2, mkComment({ id: "r1", replies_to: "t1" })],
      diff: "",
      files: [],
    };
    const r = reduce(s, { type: "bundle.refreshed", bundle: refreshed });
    expect(r.state.collapsedThreads.has("t1")).toBe(true);
    expect(r.state.collapsedThreads.has("t2")).toBe(true);
  });

  it("bundle.refreshed drops collapsedThreads ids whose Thread was cascade-deleted (no longer in topLevel)", () => {
    const t1 = mkComment({ id: "t1" });
    const t2 = mkComment({ id: "t2" });
    const initial: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1, t2],
      diff: "",
      files: [],
    };
    let s: TourSessionState = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: initial,
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t1" }).state;
    s = reduce(s, { type: "thread.collapse", id: "t2" }).state;
    // Cascade-delete: t2's Thread fully removed from bundle.
    const refreshed: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1],
      diff: "",
      files: [],
    };
    const r = reduce(s, { type: "bundle.refreshed", bundle: refreshed });
    expect(r.state.collapsedThreads.has("t1")).toBe(true);
    expect(r.state.collapsedThreads.has("t2")).toBe(false);
  });

  it("layout.set preserves collapsedThreads", () => {
    let s = reduce(initialTourSessionState(), {
      type: "thread.collapse",
      id: "ann-1",
    }).state;
    const r = reduce(s, { type: "layout.set", layout: "split" });
    expect(r.state.collapsedThreads).toBe(s.collapsedThreads);
  });
});

// Issue #406 / ADR 0038 (amended). `Shift+C` becomes a global toggle —
// the App-side handler picks the direction (collapseAll vs expandAll)
// from the current state. Reducer actions stay pure: collapseAll
// folds every top-level Comment id into the set; expandAll empties
// the set. Both emit revalidateCursor when the cursor is non-null
// so the validator's Reply→parent projection fires.
describe("reduce — thread.collapseAll / thread.expandAll (issue #406)", () => {
  function bundleWithTopLevel(ids: string[]): TourBundle {
    const comments: Comment[] = ids.map((id) => mkComment({ id }));
    return {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments,
      diff: "",
      files: [],
    };
  }

  it("thread.collapseAll folds every top-level Comment id into the set", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1", "t2", "t3"]),
    }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.state.collapsedThreads).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("thread.collapseAll skips Reply ids (only top-level Comments)", () => {
    const t1 = mkComment({ id: "t1" });
    const r1 = mkComment({ id: "r1", replies_to: "t1" });
    const bundle: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1, r1],
      diff: "",
      files: [],
    };
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle,
    }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.state.collapsedThreads).toEqual(new Set(["t1"]));
  });

  it("thread.collapseAll is a same-state-ref no-op when every top-level id is already collapsed", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1", "t2"]),
    }).state;
    s = reduce(s, { type: "thread.collapseAll" }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("thread.collapseAll preserves existing ids and adds the missing ones", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1", "t2", "t3"]),
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t2" }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.state.collapsedThreads).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("thread.collapseAll is a no-op when the bundle is not `ok` (no Threads to collapse)", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "thread.collapseAll" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("thread.collapseAll is a no-op when the bundle has zero top-level Comments", () => {
    const s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel([]),
    }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("thread.collapseAll with cursor on a Card emits scrollCursorTarget + revalidateCursor (issue #407)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1", "t2"]),
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "t1" }) }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "t1" },
        placement: "center",
        behavior: "instant",
      },
      { type: "revalidateCursor" },
    ]);
  });

  it("thread.collapseAll with cursor on a Reply emits scrollCursorTarget targeting the Thread root (issue #407)", () => {
    const t1 = mkComment({ id: "t1" });
    const r1 = mkComment({ id: "r1", replies_to: "t1" });
    const bundle: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1, r1],
      diff: "",
      files: [],
    };
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle,
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "r1" }) }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "t1" },
        placement: "center",
        behavior: "instant",
      },
      { type: "revalidateCursor" },
    ]);
  });

  it("thread.collapseAll with cursor on a row emits only revalidateCursor (no scroll, issue #407)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1"]),
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: rowAnchor() }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("thread.collapseAll with null cursor emits no scroll (issue #407)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1"]),
    }).state;
    const r = reduce(s, { type: "thread.collapseAll" });
    expect(r.intents).toEqual([]);
  });

  it("thread.expandAll empties the set", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1", "t2"]),
    }).state;
    s = reduce(s, { type: "thread.collapseAll" }).state;
    const r = reduce(s, { type: "thread.expandAll" });
    expect(r.state.collapsedThreads).toEqual(new Set());
  });

  it("thread.expandAll is a same-state-ref no-op when the set is already empty", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "thread.expandAll" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("thread.expandAll with cursor on a Card emits scrollCursorTarget + revalidateCursor (issue #407)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1"]),
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t1" }).state;
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "t1" }) }).state;
    const r = reduce(s, { type: "thread.expandAll" });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "t1" },
        placement: "center",
        behavior: "instant",
      },
      { type: "revalidateCursor" },
    ]);
  });

  it("thread.expandAll with cursor on a Reply emits scrollCursorTarget targeting the Thread root (issue #407)", () => {
    const t1 = mkComment({ id: "t1" });
    const r1 = mkComment({ id: "r1", replies_to: "t1" });
    const bundle: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [t1, r1],
      diff: "",
      files: [],
    };
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle,
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t1" }).state;
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "r1" }) }).state;
    const r = reduce(s, { type: "thread.expandAll" });
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "t1" },
        placement: "center",
        behavior: "instant",
      },
      { type: "revalidateCursor" },
    ]);
  });

  it("thread.expandAll with cursor on a row emits only revalidateCursor (no scroll, issue #407)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1"]),
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t1" }).state;
    s = reduce(s, { type: "cursor.set", anchor: rowAnchor() }).state;
    const r = reduce(s, { type: "thread.expandAll" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("thread.expandAll with null cursor emits no scroll (issue #407)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle: bundleWithTopLevel(["t1"]),
    }).state;
    s = reduce(s, { type: "thread.collapse", id: "t1" }).state;
    const r = reduce(s, { type: "thread.expandAll" });
    expect(r.intents).toEqual([]);
  });
});

describe("reduce — folds.* + expansion.* → revalidateCursor wiring (issue #309)", () => {
  // The fix mirrors the `bundle.refreshed → revalidateCursor` wiring at every
  // reducer branch that mutates flat-rows-shape state (folds + expansion) so
  // the runtime can snap `state.cursor` back to a walkable row when a state
  // mutation drops the cursor's anchor from flatRows. The original orphan
  // path (cursor.set → auto-unfold via revealSidebarFile intent → planner
  // drops synthetic row → state.cursor orphaned) is no longer reachable
  // through cursor traversal: issue #310 split `revealSidebarFile` into a
  // sidebar-select-only intent, so a `j`/`k` press no longer dispatches
  // `folds.setOverride`. The revalidateCursor wiring remains valuable as
  // defence in depth for programmatic `folds.*` and `expansion.*` mutations
  // that DO still mutate flat-rows shape from explicit user actions
  // (sidebar click, comment jump, ...).
  it("folds.setOverride { value: false } with cursor !== null emits revalidateCursor", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, {
      type: "folds.setOverride",
      file: "foo.ts",
      value: false,
    });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("folds.setOverride with cursor === null emits no revalidateCursor", () => {
    const r = reduce(initialTourSessionState(), {
      type: "folds.setOverride",
      file: "foo.ts",
      value: true,
    });
    expect(r.intents).toEqual([]);
  });

  it("folds.setOverride same-value no-op emits no revalidateCursor (state ref unchanged)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    s = reduce(s, { type: "folds.setOverride", file: "foo.ts", value: true }).state;
    const r = reduce(s, { type: "folds.setOverride", file: "foo.ts", value: true });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("folds.clearOverride with cursor !== null emits revalidateCursor", () => {
    let s = reduce(initialTourSessionState(), {
      type: "folds.setOverride",
      file: "foo.ts",
      value: true,
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: rowAnchor({ file: "foo.ts" }) }).state;
    const r = reduce(s, { type: "folds.clearOverride", file: "foo.ts" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("folds.clearOverride absent-file no-op emits no revalidateCursor", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, { type: "folds.clearOverride", file: "ghost.ts" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("folds.toggleFolder with cursor !== null emits revalidateCursor", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, { type: "folds.toggleFolder", path: "src" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("folds.clearAll with cursor !== null emits revalidateCursor", () => {
    let s = reduce(initialTourSessionState(), {
      type: "folds.toggleFolder",
      path: "src",
    }).state;
    s = reduce(s, { type: "cursor.set", anchor: rowAnchor({ file: "foo.ts" }) }).state;
    const r = reduce(s, { type: "folds.clearAll" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("folds.clearAll same-empty no-op emits no revalidateCursor", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, { type: "folds.clearAll" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("expansion.expandFile with cursor !== null emits revalidateCursor (defence in depth on top of cursorAfterExpand)", () => {
    const s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    const r = reduce(s, { type: "expansion.expandFile", file: "foo.ts" });
    expect(r.intents).toEqual([{ type: "revalidateCursor" }]);
  });

  it("expansion.expandFile same-ref no-op emits no revalidateCursor", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    s = reduce(s, { type: "expansion.expandFile", file: "foo.ts" }).state;
    const r = reduce(s, { type: "expansion.expandFile", file: "foo.ts" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });
});

describe("reduce — layout slice (slice 3 foundation)", () => {
  it("layout.set switches unified → split (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "layout.set",
      layout: "split",
    });
    expect(r.state.layout).toBe("split");
    expect(r.intents).toEqual([]);
  });

  it("layout.set is a same-state-ref no-op when the layout is unchanged", () => {
    const before = initialTourSessionState();
    expect(before.layout).toBe("unified");
    const r = reduce(before, { type: "layout.set", layout: "unified" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("layout.set keeps other slices reference-stable", () => {
    let s = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts" }),
    }).state;
    s = reduce(s, { type: "expansion.expandFile", file: "foo.ts" }).state;
    s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
    const r = reduce(s, { type: "layout.set", layout: "split" });
    expect(r.state.cursor).toBe(s.cursor);
    expect(r.state.expansion).toBe(s.expansion);
    expect(r.state.composer).toBe(s.composer);
    expect(r.state.collapsedFolders).toBe(s.collapsedFolders);
    expect(r.state.collapsedOverrides).toBe(s.collapsedOverrides);
  });
});

describe("reduce — send-to-agent action (PRD #278 slice 7)", () => {
  it("on a CardAnchor with lock not held → emits scrollCursorTarget (auto-recall) then requestReply", () => {
    let s = initialTourSessionState();
    s = { ...s, currentTourId: "tour-a", replyLock: { kind: "ok", value: null } };
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "root" }) }).state;
    const r = reduce(s, {
      type: "send-to-agent",
      tourId: "tour-a",
      commentId: "leaf",
    });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId: "root" },
        placement: "center",
        behavior: "instant",
      },
      { type: "requestReply", tourId: "tour-a", commentId: "leaf" },
    ]);
  });

  it("no-op when cursor is null", () => {
    const before = initialTourSessionState();
    const r = reduce(before, {
      type: "send-to-agent",
      tourId: "tour-a",
      commentId: "leaf",
    });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("no-op when cursor is a RowAnchor (not on a card)", () => {
    let s = initialTourSessionState();
    s = reduce(s, { type: "cursor.set", anchor: rowAnchor({ file: "foo.ts" }) }).state;
    const r = reduce(s, {
      type: "send-to-agent",
      tourId: "tour-a",
      commentId: "leaf",
    });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("no-op when the reply-lock is held by another in-flight dispatch", () => {
    let s = initialTourSessionState();
    s = {
      ...s,
      replyLock: {
        kind: "ok",
        value: {
          agent: "claude",
          responding_to: "x",
          started_at: "2026-05-14T00:00:00Z",
          pid: 1,
        },
      },
    };
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "root" }) }).state;
    const r = reduce(s, {
      type: "send-to-agent",
      tourId: "tour-a",
      commentId: "leaf",
    });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("uses the cursor's CardAnchor for auto-recall, not the action's commentId (leaf may differ from root)", () => {
    let s = initialTourSessionState();
    s = reduce(s, { type: "cursor.set", anchor: cardAnchor({ commentId: "root" }) }).state;
    const r = reduce(s, {
      type: "send-to-agent",
      tourId: "tour-a",
      commentId: "leaf-reply",
    });
    expect(r.intents[0]).toEqual({
      type: "scrollCursorTarget",
      target: { kind: "card", commentId: "root" },
      placement: "center",
      behavior: "instant",
    });
    expect(r.intents[1]).toEqual({
      type: "requestReply",
      tourId: "tour-a",
      commentId: "leaf-reply",
    });
  });
});

describe("reduce — tour.switched reset cascade (slice 3 extension)", () => {
  it("tour.switched resets composer → closed, folds → empty Set + empty Record; layout preserved", () => {
    let s = stateWithTourLoaded("tour-a");
    s = { ...s, layout: "unified" };
    s = reduce(s, { type: "composer.open", target: topLevelTarget() }).state;
    s = reduce(s, { type: "composer.setBody", body: "draft to discard" }).state;
    s = reduce(s, { type: "folds.toggleFolder", path: "src" }).state;
    s = reduce(s, { type: "folds.setOverride", file: "foo.ts", value: true }).state;
    const r = reduce(s, {
      type: "tour.switched",
      tourId: "tour-b",
      bundle: mkBundle("tour-b"),
    });
    expect(r.state.composer).toEqual({ kind: "closed" });
    expect(r.state.collapsedFolders).toEqual(new Set());
    expect(r.state.collapsedOverrides).toEqual({});
    // Layout preserved per CONTEXT.md pinned rule.
    expect(r.state.layout).toBe("unified");
    // Slice 1 + 2 resets still apply:
    expect(r.state.picker).toEqual({ kind: "closed" });
    expect(r.state.replyLock).toEqual({ kind: "idle" });
    expect(r.state.cursor).toBeNull();
    expect(r.state.expansion).toEqual(new Map());
    expect(r.intents).toEqual([]);
  });
});

describe("composer-survives-watcher-reload killer fixture (slice 3)", () => {
  // The architectural payoff of slice 3: the composer's body survives a
  // watcher reload as a *tested property of the reducer*, not as a React-
  // reconciliation accident. Pure-data, deterministic; no React / OpenTUI /
  // JSDOM rendering required.
  it("composer open with draft body + bundle.refreshed → composer slice unchanged (ref-equal); only revalidateCursor emitted (slice 2 carryover), no composer.* mutations", () => {
    const store = new TourSessionStore();
    const intents: Intent[] = [];
    store.onIntent((i) => intents.push(i));

    // Seed: load a tour, set a cursor (so bundle.refreshed emits
    // revalidateCursor per slice 2 wiring), open composer, type draft.
    store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle: mkBundle("tour-a") });
    store.dispatch({
      type: "cursor.set",
      anchor: rowAnchor({ file: "foo.ts", lineNumber: 7 }),
    });
    const target = topLevelTarget({ file: "foo.ts", line_start: 7, line_end: 7 });
    store.dispatch({ type: "composer.open", target });
    store.dispatch({ type: "composer.setBody", body: "draft text" });
    intents.length = 0;

    const composerBefore = store.getState().composer;
    expect(composerBefore).toEqual({ kind: "open", target, body: "draft text" });

    // The killer: a watcher reload arrives. The composer must NOT be
    // touched — its kind, target, and body all remain bit-for-bit identical
    // (in fact reference-identical, since the reducer's bundle.refreshed
    // branch spreads ...state).
    store.dispatch({ type: "bundle.refreshed", bundle: mkBundle("tour-a") });

    expect(store.getState().composer).toBe(composerBefore);
    expect(store.getState().composer).toEqual({ kind: "open", target, body: "draft text" });

    // Structural cursor validation is reducer-owned now; valid cursors
    // emit no revalidation or composer-related intents on refresh.
    expect(intents).toEqual([]);
    expect(intents.every((i) => !i.type.startsWith("composer."))).toBe(true);
    expect(intents.every((i) => i.type !== "submitComment")).toBe(true);
  });

  it("with no cursor set, bundle.refreshed still leaves composer untouched and emits no intents at all", () => {
    const store = new TourSessionStore();
    const intents: Intent[] = [];
    store.onIntent((i) => intents.push(i));

    store.dispatch({ type: "tour.switched", tourId: "tour-a", bundle: mkBundle("tour-a") });
    const target = replyTarget("parent-ann");
    store.dispatch({ type: "composer.open", target });
    store.dispatch({ type: "composer.setBody", body: "draft" });
    intents.length = 0;

    const composerBefore = store.getState().composer;
    store.dispatch({ type: "bundle.refreshed", bundle: mkBundle("tour-a") });
    expect(store.getState().composer).toBe(composerBefore);
    // No cursor → no revalidateCursor either; the intent stream is empty.
    expect(intents).toEqual([]);
  });
});

describe("reduce — paneFocus slice (PRD #343 / ADR 0031 / issue #344)", () => {
  it("paneFocus.setDiff flips the slice and emits no intents", () => {
    const before = initialTourSessionState();
    expect(before.paneFocus).toBe("sidebar");
    const r = reduce(before, { type: "paneFocus.setDiff" });
    expect(r.state.paneFocus).toBe("diff");
    expect(r.intents).toEqual([]);
  });

  it("paneFocus.setSidebar flips back to sidebar", () => {
    const s = reduce(initialTourSessionState(), { type: "paneFocus.setDiff" }).state;
    const r = reduce(s, { type: "paneFocus.setSidebar" });
    expect(r.state.paneFocus).toBe("sidebar");
    expect(r.intents).toEqual([]);
  });

  it("paneFocus.toggle round-trips sidebar ↔ diff", () => {
    const a = reduce(initialTourSessionState(), { type: "paneFocus.toggle" });
    expect(a.state.paneFocus).toBe("diff");
    const b = reduce(a.state, { type: "paneFocus.toggle" });
    expect(b.state.paneFocus).toBe("sidebar");
  });

  it("idempotent set on the current pane returns the same state ref", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "paneFocus.setSidebar" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("paneFocus flips leave the cursor slice untouched", () => {
    let s = initialTourSessionState();
    s = reduce(s, {
      type: "cursor.set",
      anchor: {
        kind: "row",
        file: "f.ts",
        side: "additions",
        lineNumber: 7,
        preferredSide: "additions",
      },
    }).state;
    const cursorBefore = s.cursor;
    s = reduce(s, { type: "paneFocus.setDiff" }).state;
    expect(s.cursor).toBe(cursorBefore);
    s = reduce(s, { type: "paneFocus.toggle" }).state;
    expect(s.cursor).toBe(cursorBefore);
    s = reduce(s, { type: "paneFocus.setSidebar" }).state;
    expect(s.cursor).toBe(cursorBefore);
  });
});

// --- ADR 0036 Slice D / issue #388: delete-confirm modal slice -------------

describe("reduce — deleteConfirm slice (ADR 0036 Slice D / issue #388)", () => {
  it("initial state is { kind: 'closed' }", () => {
    expect(initialTourSessionState().deleteConfirm).toEqual({ kind: "closed" });
  });

  it("deleteConfirm.open from closed → { kind: 'open', targetId } (no intents)", () => {
    const r = reduce(initialTourSessionState(), {
      type: "deleteConfirm.open",
      targetId: "ann-1",
    });
    expect(r.state.deleteConfirm).toEqual({ kind: "open", targetId: "ann-1" });
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.open re-targets when modal is already in flight (no stale id)", () => {
    let s = stateWithTourLoaded();
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    s = reduce(s, { type: "deleteConfirm.confirm" }).state;
    expect(s.deleteConfirm.kind).toBe("submitting");
    const r = reduce(s, { type: "deleteConfirm.open", targetId: "ann-2" });
    expect(r.state.deleteConfirm).toEqual({ kind: "open", targetId: "ann-2" });
  });

  it("deleteConfirm.close from open returns to closed", () => {
    const s = reduce(initialTourSessionState(), {
      type: "deleteConfirm.open",
      targetId: "ann-1",
    }).state;
    const r = reduce(s, { type: "deleteConfirm.close" });
    expect(r.state.deleteConfirm).toEqual({ kind: "closed" });
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.close from closed is a same-state-ref no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "deleteConfirm.close" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.confirm on open → submitting; emits deleteComment { tourId, targetId }", () => {
    let s = stateWithTourLoaded("tour-a");
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    const r = reduce(s, { type: "deleteConfirm.confirm" });
    expect(r.state.deleteConfirm).toEqual({ kind: "submitting", targetId: "ann-1" });
    expect(r.intents).toEqual([
      { type: "deleteComment", tourId: "tour-a", targetId: "ann-1" },
    ]);
  });

  it("deleteConfirm.confirm on errored re-emits deleteComment (retry path)", () => {
    let s = stateWithTourLoaded("tour-a");
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    s = reduce(s, { type: "deleteConfirm.confirm" }).state;
    s = reduce(s, { type: "deleteConfirm.failed", error: "boom" }).state;
    expect(s.deleteConfirm).toEqual({
      kind: "errored",
      targetId: "ann-1",
      error: "boom",
    });
    const r = reduce(s, { type: "deleteConfirm.confirm" });
    expect(r.state.deleteConfirm).toEqual({ kind: "submitting", targetId: "ann-1" });
    expect(r.intents).toEqual([
      { type: "deleteComment", tourId: "tour-a", targetId: "ann-1" },
    ]);
  });

  it("deleteConfirm.confirm on closed / submitting is a no-op (same state ref, no intents)", () => {
    const closedBefore = stateWithTourLoaded();
    const r1 = reduce(closedBefore, { type: "deleteConfirm.confirm" });
    expect(r1.state).toBe(closedBefore);
    expect(r1.intents).toEqual([]);

    let s2 = stateWithTourLoaded();
    s2 = reduce(s2, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    s2 = reduce(s2, { type: "deleteConfirm.confirm" }).state;
    const r2 = reduce(s2, { type: "deleteConfirm.confirm" });
    expect(r2.state).toBe(s2);
    expect(r2.intents).toEqual([]);
  });

  it("deleteConfirm.confirm without a tour loaded is a no-op (defence-in-depth)", () => {
    let s = reduce(initialTourSessionState(), {
      type: "deleteConfirm.open",
      targetId: "ann-1",
    }).state;
    const r = reduce(s, { type: "deleteConfirm.confirm" });
    expect(r.state).toBe(s);
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.succeeded on submitting → closed; no intents", () => {
    let s = stateWithTourLoaded();
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    s = reduce(s, { type: "deleteConfirm.confirm" }).state;
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "ann-1" });
    expect(r.state.deleteConfirm).toEqual({ kind: "closed" });
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.succeeded on non-submitting states is a no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "deleteConfirm.succeeded", targetId: "ann-1" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.failed on submitting → errored; preserves targetId for retry", () => {
    let s = stateWithTourLoaded();
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    s = reduce(s, { type: "deleteConfirm.confirm" }).state;
    const r = reduce(s, { type: "deleteConfirm.failed", error: "boom" });
    expect(r.state.deleteConfirm).toEqual({
      kind: "errored",
      targetId: "ann-1",
      error: "boom",
    });
    expect(r.intents).toEqual([]);
  });

  it("deleteConfirm.failed on non-submitting states is a no-op", () => {
    const before = initialTourSessionState();
    const r = reduce(before, { type: "deleteConfirm.failed", error: "boom" });
    expect(r.state).toBe(before);
    expect(r.intents).toEqual([]);
  });

  it("tour.switched resets deleteConfirm to closed (alongside picker / cursor / composer)", () => {
    let s = stateWithTourLoaded("tour-a");
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    expect(s.deleteConfirm.kind).toBe("open");
    const r = reduce(s, {
      type: "tour.switched",
      tourId: "tour-b",
      bundle: mkBundle("tour-b"),
    });
    expect(r.state.deleteConfirm).toEqual({ kind: "closed" });
  });

  it("close-modal precedence: closing the delete-confirm modal does not touch the composer or picker slice", () => {
    let s = stateWithTourLoaded();
    s = reduce(s, { type: "deleteConfirm.open", targetId: "ann-1" }).state;
    const composerBefore = s.composer;
    const pickerBefore = s.picker;
    s = reduce(s, { type: "deleteConfirm.close" }).state;
    expect(s.composer).toBe(composerBefore);
    expect(s.picker).toBe(pickerBefore);
  });
});

// --- issue #402: deleteConfirm.succeeded cursor fallback to thread parent ---

describe("reduce — deleteConfirm.succeeded cursor lineage fallback (issue #402)", () => {
  function stateWithComments(comments: Comment[]): TourSessionState {
    const bundle: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments,
      diff: "",
      files: [],
    };
    return reduce(initialTourSessionState(), {
      type: "tour.switched",
      tourId: "tour-a",
      bundle,
    }).state;
  }

  function withCardCursor(
    state: TourSessionState,
    commentId: string,
    preferredSide: "additions" | "deletions" = "additions",
  ): TourSessionState {
    return { ...state, cursor: { kind: "card", commentId, preferredSide } };
  }

  function inSubmitting(state: TourSessionState, targetId: string): TourSessionState {
    let s = reduce(state, { type: "deleteConfirm.open", targetId }).state;
    s = reduce(s, { type: "deleteConfirm.confirm" }).state;
    return s;
  }

  it("reply-only (parent live + ≥1 sibling): cursor on doomed Reply → snaps to parent root; preferredSide preserved", () => {
    const parent = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1", created_at: "2026-05-13T00:00:01Z" });
    const r2 = mkComment({ id: "r2", replies_to: "p1", created_at: "2026-05-13T00:00:02Z" });
    let s = stateWithComments([parent, r1, r2]);
    s = withCardCursor(s, "r1", "deletions");
    s = inSubmitting(s, "r1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "r1" });
    expect(r.state.cursor).toEqual({
      kind: "card",
      commentId: "p1",
      preferredSide: "deletions",
    });
    expect(r.state.deleteConfirm).toEqual({ kind: "closed" });
    expect(r.intents).toEqual([{ type: "mirrorAnnUrl", commentId: "p1" }]);
  });

  it("reply-only (parent live, no siblings): cursor on doomed Reply → snaps to parent root", () => {
    const parent = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    let s = stateWithComments([parent, r1]);
    s = withCardCursor(s, "r1", "additions");
    s = inSubmitting(s, "r1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "r1" });
    expect(r.state.cursor).toEqual({
      kind: "card",
      commentId: "p1",
      preferredSide: "additions",
    });
  });

  it("reply-only with deleted parent stub: cursor on doomed Reply snaps to the parent stub when a sibling survives", () => {
    const parentStub: Comment = {
      ...mkComment({ id: "p1" }),
      deleted: { at: "2026-05-13T00:00:00Z" },
    };
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    const r2 = mkComment({ id: "r2", replies_to: "p1" });
    let s = stateWithComments([parentStub, r1, r2]);
    s = withCardCursor(s, "r1", "deletions");
    s = inSubmitting(s, "r1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "r1" });
    expect(r.state.cursor).toEqual({
      kind: "card",
      commentId: "p1",
      preferredSide: "deletions",
    });
    expect(r.intents).toEqual([{ type: "mirrorAnnUrl", commentId: "p1" }]);
  });

  it("parent-stub: cursor on doomed parent with ≥1 surviving Reply stays on the parent stub", () => {
    const parent = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    let s = stateWithComments([parent, r1]);
    s = withCardCursor(s, "p1", "deletions");
    s = inSubmitting(s, "p1");
    const commentsBefore = s.bundle.kind === "ok" ? s.bundle.value.comments : null;
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "p1" });
    expect(r.state.cursor).toBe(s.cursor);
    expect(r.state.bundle.kind).toBe("ok");
    if (r.state.bundle.kind !== "ok") throw new Error("unreachable");
    expect(r.state.bundle.value.comments).toBe(commentsBefore);
    expect(r.intents).toEqual([]);
  });

  it("thread-vanishes (parent alone, no replies): cursor on doomed parent → cursor clears; emits mirrorAnnUrl null", () => {
    const parent = mkComment({ id: "p1" });
    let s = stateWithComments([parent]);
    s = withCardCursor(s, "p1");
    s = inSubmitting(s, "p1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "p1" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([{ type: "mirrorAnnUrl", commentId: null }]);
  });

  it("thread-vanishes (only-reply-under-[deleted]-stub): cursor on doomed Reply → cursor clears", () => {
    const parentStub: Comment = {
      ...mkComment({ id: "p1" }),
      deleted: { at: "2026-05-13T00:00:00Z" },
    };
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    let s = stateWithComments([parentStub, r1]);
    s = withCardCursor(s, "r1");
    s = inSubmitting(s, "r1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "r1" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([{ type: "mirrorAnnUrl", commentId: null }]);
  });

  it("cursor on a different CardAnchor (not the deleted target): cursor unchanged, no intents", () => {
    const p1 = mkComment({ id: "p1" });
    const p2 = mkComment({ id: "p2" });
    let s = stateWithComments([p1, p2]);
    s = withCardCursor(s, "p2", "deletions");
    const cursorBefore = s.cursor;
    s = inSubmitting(s, "p1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "p1" });
    expect(r.state.cursor).toBe(cursorBefore);
    expect(r.intents).toEqual([]);
  });

  it("RowAnchor cursor: unchanged across the delete (no fallback semantics for diff-row cursors)", () => {
    const parent = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    let s = stateWithComments([parent, r1]);
    const row: RowAnchor = {
      kind: "row",
      file: "foo.ts",
      lineNumber: 10,
      side: "additions",
      preferredSide: "additions",
    };
    s = { ...s, cursor: row };
    s = inSubmitting(s, "r1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "r1" });
    expect(r.state.cursor).toBe(row);
    expect(r.intents).toEqual([]);
  });

  it("null cursor: unchanged across the delete (no fallback semantics)", () => {
    const parent = mkComment({ id: "p1" });
    let s = stateWithComments([parent]);
    expect(s.cursor).toBeNull();
    s = inSubmitting(s, "p1");
    const r = reduce(s, { type: "deleteConfirm.succeeded", targetId: "p1" });
    expect(r.state.cursor).toBeNull();
    expect(r.intents).toEqual([]);
  });

  it("subsequent bundle.refreshed is a cursor no-op after the snap (parent still exists in flatRows)", () => {
    const parent = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    let s = stateWithComments([parent, r1]);
    s = withCardCursor(s, "r1", "deletions");
    s = inSubmitting(s, "r1");
    s = reduce(s, { type: "deleteConfirm.succeeded", targetId: "r1" }).state;
    // Watcher delivers the post-delete bundle: r1 gone, parent live.
    const refreshed: TourBundle = {
      kind: "ok",
      tour: tour({ id: "tour-a" }),
      comments: [parent],
      diff: "",
      files: [],
    };
    s = reduce(s, { type: "bundle.refreshed", bundle: refreshed }).state;
    // Cursor still on parent after the bundle.refreshed → revalidateCursor
    // round-trip (the surface validates against the refreshed flatRows and
    // finds parent's Card row still present).
    expect(s.cursor).toEqual({
      kind: "card",
      commentId: "p1",
      preferredSide: "deletions",
    });
  });
});
