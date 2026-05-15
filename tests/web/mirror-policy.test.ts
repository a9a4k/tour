import { describe, it, expect } from "vitest";
import { decideMirrorUrl } from "../../src/web/client/mirror-policy.js";
import type { Comment } from "../../src/core/types.js";
import type { Cursor } from "../../src/core/cursor-state.js";

function ann(id: string, file = "x.txt"): Comment {
  return {
    id,
    file,
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "n",
    author: "human",
    author_kind: "human",
    created_at: "2026-01-01T00:00:00Z",
  };
}

const annA = ann("annA", "a.txt");
const annB = ann("annB", "b.txt");
const topLevel = [annA, annB];
const TOUR = "tour-X";

describe("decideMirrorUrl (issue #198)", () => {
  // Tour-load defer: cursor is briefly null before the re-anchor effect
  // seeds it from `#<ann-id>`. The mirror must NOT strip-then-restore the
  // valid comment id in a single cycle (preserves Issue #180 / PRD UX 26).
  it("skip when cursor is null and topLevel is non-empty (tour-load defer)", () => {
    expect(decideMirrorUrl(null, topLevel, TOUR)).toEqual({ kind: "skip" });
  });

  // Empty Tour: nothing to defer for — write a bare `/<tour-id>`. (Existing
  // behaviour from before #197: the topLevel.length > 0 part of the gate
  // gates the defer specifically on "comments exist".)
  it("write bare tour url when cursor is null and topLevel is empty (no comments to seed)", () => {
    expect(decideMirrorUrl(null, [], TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}`,
    });
  });

  it("write `/tour#ann` when cursor is a CardAnchor", () => {
    const cursor: Cursor = { kind: "card", commentId: "annA", preferredSide: "additions" };
    expect(decideMirrorUrl(cursor, topLevel, TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}#annA`,
    });
  });

  // The bug fix (issue #198): cursorCardId === null is TWO cases under the
  // unified-cursor model — "cursor === null" (defer) and "cursor.kind ===
  // 'row'" (a `j`/`k`/click landed on a diff row, the hash MUST be dropped
  // so reload doesn't restore the stale card the user just left).
  it("write bare tour url when cursor is a RowAnchor (drops the stale hash, AC2)", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "a.txt",
      lineNumber: 5,
      side: "additions",
      preferredSide: "additions",
    };
    expect(decideMirrorUrl(cursor, topLevel, TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}`,
    });
  });

  it("write bare tour url when cursor is an interactive RowAnchor (gap-row / boundary)", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "a.txt",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "hunk-separator", boundaryRef: 1 },
    };
    expect(decideMirrorUrl(cursor, topLevel, TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}`,
    });
  });

  // AC3: transitions from RowAnchor back to a CardAnchor re-introduce the
  // hash. The policy is stateless — this is just the CardAnchor case again
  // — but the test name is the AC.
  it("transitions row→card put the hash back (AC3)", () => {
    const rowCursor: Cursor = {
      kind: "row",
      file: "a.txt",
      lineNumber: 5,
      side: "additions",
      preferredSide: "additions",
    };
    const cardCursor: Cursor = { kind: "card", commentId: "annB", preferredSide: "additions" };
    expect(decideMirrorUrl(rowCursor, topLevel, TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}`,
    });
    expect(decideMirrorUrl(cardCursor, topLevel, TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}#annB`,
    });
  });

  // CardAnchor for a comment that's no longer top-level (deleted /
  // restructured between bundle loads). The mirror still writes the URL;
  // the re-anchor effect's stale-fallback branch handles the cursor
  // correction. Asymmetric with decideReanchor: the mirror is a pure
  // serialiser of the cursor's intent.
  it("write `/tour#ann` even when the CardAnchor id is not in topLevel (mirror is unaware of staleness)", () => {
    const cursor: Cursor = { kind: "card", commentId: "ghost", preferredSide: "additions" };
    expect(decideMirrorUrl(cursor, topLevel, TOUR)).toEqual({
      kind: "write",
      url: `/${TOUR}#ghost`,
    });
  });
});
