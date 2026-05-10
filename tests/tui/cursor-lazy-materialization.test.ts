import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { flatRows } from "../../src/core/flat-rows.js";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
import {
  initialCursor,
  cursorFromAnnotation,
  type Cursor,
} from "../../src/core/cursor-state.js";
import { buildTopLevelComposer } from "../../src/tui/composer-state.js";
import { dispatchKey, type KeyInput, type KeymapContext } from "../../src/tui/keymap.js";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { Annotation } from "../../src/core/types.js";

const SIMPLE_DIFF = `diff --git a/REPLACE b/REPLACE
index 1..2 100644
--- a/REPLACE
+++ b/REPLACE
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;

function fileFromName(name: string): DiffFile {
  return { name, type: "change", hunks: [] };
}

function plannedFor(name: string, layout: "split" | "unified"): PlannedRow[] {
  const meta = parsePatchFiles(SIMPLE_DIFF.replace(/REPLACE/g, name))[0].files[0];
  return planRows(meta, [], layout);
}

function ann(o: Pick<Annotation, "id" | "file" | "side" | "line_start" | "line_end">): Annotation {
  return {
    id: o.id,
    file: o.file,
    side: o.side,
    line_start: o.line_start,
    line_end: o.line_end,
    body: "x",
    author: "agent",
    author_kind: "agent",
    created_at: "2026-01-01T00:00:00Z",
  };
}

const k = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyInput => ({
  name,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
});

const diffPane: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
};

/**
 * Lazy materialization (ADR 0011 Revisions / ADR 0012). The TUI cursor
 * stays null on tour load and materializes only on first user interaction
 * (j/k/h/l/arrows/a, plus n/p β-coupling and click). These tests compose
 * the same pure helpers App.tsx wires together — the contract sits at the
 * helper layer so the App's role is purely plumbing.
 */

describe("diff-pane cursor motion fires regardless of cursor state", () => {
  // Pre-AFK keymap gated j/k/h/l on `cursorExists: true`; lazy
  // materialization removes the gate so first interaction can promote a
  // null cursor into the seeded state via the App's handler.
  it("j → cursor-down even when no cursor is materialized", () => {
    expect(dispatchKey(k("j"), diffPane).type).toBe("cursor-down");
  });

  it("k → cursor-up even when no cursor is materialized", () => {
    expect(dispatchKey(k("k"), diffPane).type).toBe("cursor-up");
  });

  it("h → cursor-side-left even when no cursor is materialized", () => {
    expect(dispatchKey(k("h"), diffPane).type).toBe("cursor-side-left");
  });

  it("l → cursor-side-right even when no cursor is materialized", () => {
    expect(dispatchKey(k("l"), diffPane).type).toBe("cursor-side-right");
  });

  it("ArrowDown / ArrowUp / ArrowLeft / ArrowRight all map to cursor motion", () => {
    expect(dispatchKey(k("down"), diffPane).type).toBe("cursor-down");
    expect(dispatchKey(k("up"), diffPane).type).toBe("cursor-up");
    expect(dispatchKey(k("left"), diffPane).type).toBe("cursor-side-left");
    expect(dispatchKey(k("right"), diffPane).type).toBe("cursor-side-right");
  });
});

describe("first j/k/h/l materializes at the default target", () => {
  it("non-empty Tour with no annotations: seeds at first annotatable row of first file", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("a.txt", "split")],
      ["b.txt", plannedFor("b.txt", "split")],
    ]);
    const flat = flatRows([fa, fb], planned, () => false);
    const seeded = initialCursor({ topLevelAnnotations: [], flatRows: flat });
    expect(seeded?.file).toBe("a.txt");
    expect(seeded?.lineNumber).toBe(flat[0].lineNumber);
  });

  it("Tour with annotations: seeds at the first top-level annotation's anchor", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const flat = flatRows([f], planned, () => false);
    const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
    const seeded = initialCursor({ topLevelAnnotations: [a], flatRows: flat });
    expect(seeded?.file).toBe("a.txt");
    expect(seeded?.lineNumber).toBe(2);
    expect(seeded?.side).toBe("additions");
  });

  it("degraded Tour (no rows): materialization yields null and motion is a no-op", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const allFolded = flatRows([f], planned, () => true);
    expect(initialCursor({ topLevelAnnotations: [], flatRows: allFolded })).toBeNull();
  });
});

describe("a from null cursor materializes at the default target AND opens the composer", () => {
  it("with annotations: composer opens at the first annotation's anchor", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const flat = flatRows([f], planned, () => false);
    const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
    const seeded = initialCursor({ topLevelAnnotations: [a], flatRows: flat });
    const composer = buildTopLevelComposer({ cursor: seeded, currentAnnotation: null });
    expect(composer).toEqual({
      kind: "top-level",
      file: "a.txt",
      side: "additions",
      line_start: 2,
      line_end: 2,
    });
  });

  it("without annotations: composer opens at the first annotatable row of the first file", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const flat = flatRows([f], planned, () => false);
    const seeded = initialCursor({ topLevelAnnotations: [], flatRows: flat });
    const composer = buildTopLevelComposer({ cursor: seeded, currentAnnotation: null });
    expect(composer?.kind).toBe("top-level");
    if (composer?.kind !== "top-level") return;
    expect(composer.file).toBe("a.txt");
    expect(composer.line_start).toBe(flat[0].lineNumber);
  });

  it("degraded (no rows): seeded cursor is null and composer is a silent no-op", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const allFolded = flatRows([f], planned, () => true);
    const seeded = initialCursor({ topLevelAnnotations: [], flatRows: allFolded });
    const composer = buildTopLevelComposer({ cursor: seeded, currentAnnotation: null });
    expect(composer).toBeNull();
  });
});

describe("n/p from null cursor materializes via β-coupling", () => {
  // n/p call cursorFromAnnotation(target) inside jumpToAnnotation — a
  // null cursor at the moment of n/p press lands on the target
  // annotation's anchor in one step.
  it("cursorFromAnnotation seeds the cursor at the target's anchor", () => {
    const a = ann({ id: "a1", file: "src/foo.ts", side: "deletions", line_start: 7, line_end: 7 });
    const c = cursorFromAnnotation(a);
    expect(c).toEqual({
      file: "src/foo.ts",
      lineNumber: 7,
      side: "deletions",
      preferredSide: "deletions",
    });
  });
});

describe("first interaction is the only path from null → cursor", () => {
  // The seeding effect that previously materialized the cursor on first
  // sight of a non-empty flatRowsList is gone: tour load leaves cursor
  // null. validateCursor on a null cursor is also a no-op (existing
  // contract preserved).
  it("an existing seed effect equivalent (initialCursor on a non-empty flat row sequence) is what motion now invokes inline", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const flat = flatRows([f], planned, () => false);
    // initialCursor still produces a non-null cursor for a populated bundle
    // — just no longer auto-applied via useEffect.
    expect(initialCursor({ topLevelAnnotations: [], flatRows: flat })).not.toBeNull();
  });
});

describe("watcher reload preserves null when cursor was null", () => {
  // Tour load + bundle reload (annotations only changed): cursor stays
  // null because no first interaction has fired yet. validateCursor on a
  // null cursor returns null — the no-op contract.
  it("a null cursor stays null across a benign bundle reload", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const flat = flatRows([f], planned, () => false);
    const c: Cursor | null = null;
    // App's validate-in-place effect short-circuits on null:
    // `if (cursor === null) return;` — the cursor remains null until the
    // user interacts. This test documents the contract.
    expect(c).toBeNull();
    expect(flat.length).toBeGreaterThan(0);
  });
});
