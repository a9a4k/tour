import { describe, it, expect } from "vitest";
import {
  deriveTourSessionView,
  type TourSessionView,
} from "../../src/core/tour-session-view.js";
import {
  initialTourSessionState,
  reduce,
  type TourSessionState,
} from "../../src/core/tour-session.js";
import { initialCursor } from "../../src/core/cursor-state.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import type { Tour, Comment } from "../../src/core/types.js";

/**
 * Issue #256 — TUI: cursor materialises on the first top-level comment
 * on tour load. Reverts ADR 0011's "lazy materialization on tour load"
 * rule for non-empty tours (the parity rationale broke when ADR 0022
 * shipped URL-anchored mount on the webapp; the "land on first comment"
 * eye-catcher only delivered when the first comment sat in the initial
 * viewport).
 *
 * On-load contract:
 *  - non-empty Tour: cursor.materialize lands on `topLevel[0]` as a
 *    CardAnchor; the cursor-follow useEffect then scrolls the card into
 *    view (no new scroll plumbing needed).
 *  - empty Tour: cursor stays null (no target to seed; the App-shell
 *    gates the materialize call on `topLevel.length > 0`).
 *  - snapshot-lost: cursor stays null (`initialCursor` returns null when
 *    flatRowsList is empty, which is the snapshot-lost projection).
 *  - same-tour bundle.refreshed: no re-seed; the App-shell's
 *    `seededTourIdRef` guards the call site, and the reducer's
 *    `cursor.materialize` is a strict no-op on a non-null cursor as a
 *    belt-and-suspenders fallback.
 *
 * Tests assert at the state-shape level (the AC's "pure-state equivalent"
 * branch): compose `deriveTourSessionView` + `initialCursor` +
 * `cursor.materialize` exactly the way the App-shell wires them.
 */

function tour(id: string): Tour {
  return {
    id,
    title: "T",
    status: "open",
    created_at: "2026-05-13T00:00:00Z",
    closed_at: "",
    head_sha: "h",
    base_sha: "b",
    head_source: "h",
    base_source: "b",
    wip_snapshot: false,
  };
}

function ann(o: Partial<Comment> & Pick<Comment, "id">): Comment {
  return {
    id: o.id,
    file: o.file ?? "a.ts",
    side: o.side ?? "additions",
    line_start: o.line_start ?? 1,
    line_end: o.line_end ?? 1,
    body: o.body ?? "body",
    author: o.author ?? "user",
    author_kind: o.author_kind ?? "human",
    replies_to: o.replies_to,
    created_at: o.created_at ?? "2026-05-13T00:00:00Z",
  };
}

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

function okBundle(comments: Comment[]): TourBundle {
  return {
    kind: "ok",
    tour: tour("t1"),
    comments,
    diff: DIFF_A,
    files: [fileA()],
  };
}

function snapshotLostBundle(comments: Comment[]): TourBundle {
  return {
    kind: "snapshot-lost",
    tour: tour("t1"),
    comments,
  };
}

// Mirrors the App-shell's tour-open seed step exactly: derive the view,
// gate on topLevel.length > 0 (empty-tour skip preserves the lazy rule
// for the no-target path), call initialCursor with the view's
// nav.topLevel + rows.flatRowsList, dispatch cursor.materialize if the
// seed resolved. Returns the resulting state.
function seedOnTourOpen(bundle: TourBundle, state: TourSessionState): TourSessionState {
  const view: TourSessionView = deriveTourSessionView(bundle, state);
  const topLevel = view.nav.topLevel;
  if (topLevel.length === 0) return state;
  const flatRowsList = view.kind === "ok" ? view.rows.flatRowsList : [];
  const seed = initialCursor({
    topLevelComments: topLevel,
    flatRows: flatRowsList,
  });
  if (!seed) return state;
  return reduce(state, { type: "cursor.materialize", anchor: seed }).state;
}

describe("issue #256 — cursor materialises on tour open for non-empty tours", () => {
  it("non-empty Tour seeds a CardAnchor on topLevel[0].id", () => {
    const a = ann({
      id: "a1",
      file: "a.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
    });
    const next = seedOnTourOpen(okBundle([a]), initialTourSessionState());
    expect(next.cursor).toEqual({
      kind: "card",
      commentId: "a1",
      preferredSide: "additions",
    });
  });

  it("empty Tour leaves the cursor null (topLevel.length === 0 short-circuits)", () => {
    const before = initialTourSessionState();
    const next = seedOnTourOpen(okBundle([]), before);
    expect(next.cursor).toBeNull();
    expect(next).toBe(before);
  });

  it("snapshot-lost bundle leaves the cursor null (flatRowsList is empty → initialCursor returns null)", () => {
    const a = ann({ id: "a1" });
    const before = initialTourSessionState();
    const next = seedOnTourOpen(snapshotLostBundle([a]), before);
    expect(next.cursor).toBeNull();
    expect(next).toBe(before);
  });

  it("cursor.materialize on an already-materialised cursor is a strict no-op — same-tour bundle.refreshed survives user motion", () => {
    // Simulate the user having moved the cursor to a different comment
    // after the initial mount.
    const moved = reduce(initialTourSessionState(), {
      type: "cursor.set",
      anchor: { kind: "card", commentId: "a2", preferredSide: "deletions" },
    }).state;
    // The App-shell suppresses the re-seed via `seededTourIdRef` so the
    // dispatch never fires on `bundle.refreshed`. The reducer's
    // belt-and-suspenders branch returns the same state ref if it does.
    const r = reduce(moved, {
      type: "cursor.materialize",
      anchor: { kind: "card", commentId: "a1", preferredSide: "additions" },
    });
    expect(r.state).toBe(moved);
    expect(r.intents).toEqual([]);
  });

  it("seed emits scrollCursorTarget so the cursor-follow useEffect scrolls the card into view", () => {
    const a = ann({
      id: "a1",
      file: "a.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
    });
    const view = deriveTourSessionView(okBundle([a]), initialTourSessionState());
    if (view.kind !== "ok") throw new Error("expected ok view");
    const seed = initialCursor({
      topLevelComments: view.nav.topLevel,
      flatRows: view.rows.flatRowsList,
    });
    if (!seed) throw new Error("expected seed");
    const r = reduce(initialTourSessionState(), {
      type: "cursor.materialize",
      anchor: seed,
    });
    expect(r.intents).toContainEqual({
      type: "scrollCursorTarget",
      target: { kind: "card", commentId: "a1" },
      placement: "center",
      behavior: "instant",
    });
  });
});
