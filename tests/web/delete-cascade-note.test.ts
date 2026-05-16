// Issue #389 / ADR 0036 (Slice E). Pure projection of the C4 cascade
// preview surfaced in the delete-confirm modal. The helper takes the
// target comment + the bundle's projected comments and returns one of
// three notes; renderDeleteCascadeNote pipes the variant to a string.

import { describe, expect, it } from "vitest";
import type { Comment } from "../../src/web/client/types.js";
import {
  computeDeleteCascadeNote,
  renderDeleteCascadeNote,
} from "../../src/web/client/delete-cascade-note.js";

function comment(overrides: Partial<Comment>): Comment {
  return {
    id: "default",
    file: "x.ts",
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "body",
    author: "human",
    author_kind: "human",
    created_at: "2026-05-16T00:00:00Z",
    ...overrides,
  };
}

describe("computeDeleteCascadeNote (issue #389)", () => {
  it("returns 'thread-vanishes' when the target is a parent with no live replies", () => {
    const parent = comment({ id: "p" });
    expect(computeDeleteCascadeNote(parent, [parent])).toEqual({
      kind: "thread-vanishes",
    });
  });

  it("returns 'parent-stub' with the live reply count when the target is a parent with surviving replies", () => {
    const parent = comment({ id: "p" });
    const r1 = comment({ id: "r1", replies_to: "p" });
    const r2 = comment({ id: "r2", replies_to: "p" });
    expect(computeDeleteCascadeNote(parent, [parent, r1, r2])).toEqual({
      kind: "parent-stub",
      survivorCount: 2,
    });
  });

  it("excludes already-deleted replies from the parent's surviving count", () => {
    const parent = comment({ id: "p" });
    const live = comment({ id: "r1", replies_to: "p" });
    const dead = comment({
      id: "r2",
      replies_to: "p",
      deleted: { at: "2026-05-16T00:00:00Z" },
    });
    expect(computeDeleteCascadeNote(parent, [parent, live, dead])).toEqual({
      kind: "parent-stub",
      survivorCount: 1,
    });
  });

  it("returns 'thread-vanishes' on a parent whose only replies are all deleted", () => {
    const parent = comment({ id: "p" });
    const dead = comment({
      id: "r1",
      replies_to: "p",
      deleted: { at: "2026-05-16T00:00:00Z" },
    });
    expect(computeDeleteCascadeNote(parent, [parent, dead])).toEqual({
      kind: "thread-vanishes",
    });
  });

  it("returns 'reply-only' when the target is a Reply and its parent or another sibling stays live", () => {
    const parent = comment({ id: "p" });
    const r1 = comment({ id: "r1", replies_to: "p" });
    const r2 = comment({ id: "r2", replies_to: "p" });
    expect(computeDeleteCascadeNote(r1, [parent, r1, r2])).toEqual({
      kind: "reply-only",
    });
  });

  it("returns 'thread-vanishes' when the target is a Reply whose parent stub + every other reply is already deleted", () => {
    // C4 cascade: parent is a `[deleted]` stub (already deleted), only
    // this reply remains live. Deleting it makes the projection empty.
    const parent = comment({
      id: "p",
      deleted: { at: "2026-05-16T00:00:00Z" },
    });
    const r1 = comment({ id: "r1", replies_to: "p" });
    expect(computeDeleteCascadeNote(r1, [parent, r1])).toEqual({
      kind: "thread-vanishes",
    });
  });

  it("returns 'reply-only' for a reply when the parent stub is deleted but ≥1 live sibling remains", () => {
    const parent = comment({
      id: "p",
      deleted: { at: "2026-05-16T00:00:00Z" },
    });
    const r1 = comment({ id: "r1", replies_to: "p" });
    const r2 = comment({ id: "r2", replies_to: "p" });
    expect(computeDeleteCascadeNote(r1, [parent, r1, r2])).toEqual({
      kind: "reply-only",
    });
  });

  it("returns 'thread-vanishes' for a reply that has no surviving parent and no siblings", () => {
    // Defensive — a reply pointing at a parent that's not in the
    // projection (cascade-collapsed thread or unknown id). The
    // projection invariant is "reply's parent is always present or
    // stubbed"; this branch handles the degenerate case without
    // misclassifying.
    const r = comment({ id: "r1", replies_to: "ghost" });
    expect(computeDeleteCascadeNote(r, [r])).toEqual({
      kind: "thread-vanishes",
    });
  });
});

describe("renderDeleteCascadeNote (issue #389)", () => {
  it("renders the reply-only message verbatim", () => {
    expect(renderDeleteCascadeNote({ kind: "reply-only" })).toBe(
      "this reply will be removed from the thread.",
    );
  });

  it("renders the thread-vanishes message verbatim", () => {
    expect(renderDeleteCascadeNote({ kind: "thread-vanishes" })).toBe(
      "the thread will vanish.",
    );
  });

  it("pluralises 'reply' for the parent-stub message", () => {
    expect(
      renderDeleteCascadeNote({ kind: "parent-stub", survivorCount: 1 }),
    ).toBe("1 reply will remain under [deleted].");
    expect(
      renderDeleteCascadeNote({ kind: "parent-stub", survivorCount: 2 }),
    ).toBe("2 replies will remain under [deleted].");
    expect(
      renderDeleteCascadeNote({ kind: "parent-stub", survivorCount: 7 }),
    ).toBe("7 replies will remain under [deleted].");
  });
});
