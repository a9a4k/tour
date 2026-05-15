import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { flatRows } from "../../src/core/flat-rows.js";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
import {
  initialCursor,
  cursorFromComment,
} from "../../src/core/cursor-state.js";
import { buildTopLevelComposer } from "../../src/tui/composer-state.js";
import { dispatchKey, type KeyInput, type KeymapContext } from "../../src/tui/keymap.js";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { Comment } from "../../src/core/types.js";

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

function plannedFor(
  name: string,
  layout: "split" | "unified",
  comments: Comment[] = [],
): PlannedRow[] {
  const meta = parsePatchFiles(SIMPLE_DIFF.replace(/REPLACE/g, name))[0].files[0];
  return planRows(meta, comments, layout);
}

function ann(o: Pick<Comment, "id" | "file" | "side" | "line_start" | "line_end">): Comment {
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
  cursorOnInteractive: false,
  cursorOnCard: false,
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
  it("non-empty Tour with no comments: seeds at first annotatable row of first file", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("a.txt", "split")],
      ["b.txt", plannedFor("b.txt", "split")],
    ]);
    const flat = flatRows([fa, fb], planned, () => false);
    const seeded = initialCursor({ topLevelComments: [], flatRows: flat });
    if (seeded?.kind !== "row") throw new Error("expected row anchor");
    expect(seeded.file).toBe("a.txt");
    // Initial cursor lands on the first DIFF row, skipping interactive
    // hunk-separator rows (PRD #107 US 14, ADR 0013).
    const firstDiff = flat.find((r) => r.kind === "diff");
    if (firstDiff?.kind !== "diff") throw new Error("no diff row");
    expect(seeded.lineNumber).toBe(firstDiff.lineNumber);
  });

  it("Tour with comments: seeds at the first top-level comment's CardAnchor (PRD #192)", () => {
    const f = fileFromName("a.txt");
    const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split", [a])]]);
    const flat = flatRows([f], planned, () => false);
    const seeded = initialCursor({ topLevelComments: [a], flatRows: flat });
    expect(seeded).toEqual({ kind: "card", commentId: "a1", preferredSide: "additions" });
  });

  it("degraded Tour (no rows): materialization yields null and motion is a no-op", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const allFolded = flatRows([f], planned, () => true);
    expect(initialCursor({ topLevelComments: [], flatRows: allFolded })).toBeNull();
  });
});

describe("a from null cursor materializes at the default target AND opens the composer", () => {
  it("with comments: seeded card cursor falls back to currentComment anchor for `a` composer (PRD #192 — `a` is row-only)", () => {
    // Under the unified-cursor model the seeded cursor at tour-open is a
    // CardAnchor (PRD #192). `a` is row-only — when the cursor is on a
    // card, buildTopLevelComposer falls back to the supplied
    // currentComment. The App-shell keymap surfaces a footer hint
    // before reaching this path; the helper's fallback covers the
    // degraded direct-call path.
    const f = fileFromName("a.txt");
    const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split", [a])]]);
    const flat = flatRows([f], planned, () => false);
    const seeded = initialCursor({ topLevelComments: [a], flatRows: flat });
    const composer = buildTopLevelComposer({ cursor: seeded, currentComment: a });
    expect(composer).toEqual({
      kind: "top-level",
      file: "a.txt",
      side: "additions",
      line_start: 2,
      line_end: 2,
    });
  });

  it("without comments: composer opens at the first annotatable row of the first file", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const flat = flatRows([f], planned, () => false);
    const seeded = initialCursor({ topLevelComments: [], flatRows: flat });
    const composer = buildTopLevelComposer({ cursor: seeded, currentComment: null });
    expect(composer?.kind).toBe("top-level");
    if (composer?.kind !== "top-level") return;
    expect(composer.file).toBe("a.txt");
    const firstDiff = flat.find((r) => r.kind === "diff");
    if (firstDiff?.kind !== "diff") throw new Error("no diff row");
    expect(composer.line_start).toBe(firstDiff.lineNumber);
  });

  it("degraded (no rows): seeded cursor is null and composer is a silent no-op", () => {
    const f = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("a.txt", "split")]]);
    const allFolded = flatRows([f], planned, () => true);
    const seeded = initialCursor({ topLevelComments: [], flatRows: allFolded });
    const composer = buildTopLevelComposer({ cursor: seeded, currentComment: null });
    expect(composer).toBeNull();
  });
});

describe("n/p from null cursor materializes a CardAnchor (PRD #192)", () => {
  // n/p call cursorFromComment(target) inside jumpToComment — a
  // null cursor at the moment of n/p press lands on the target
  // comment's CardAnchor in one step.
  it("cursorFromComment seeds a CardAnchor on the target's id", () => {
    const a = ann({ id: "a1", file: "src/foo.ts", side: "deletions", line_start: 7, line_end: 7 });
    const c = cursorFromComment(a);
    expect(c).toEqual({ kind: "card", commentId: "a1", preferredSide: "additions" });
  });
});

