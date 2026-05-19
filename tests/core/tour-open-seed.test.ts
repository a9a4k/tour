import { describe, expect, it } from "vitest";
import { computeTourOpenSeed } from "../../src/core/tour-open-seed.js";
import type { BundleFile, TourBundle } from "../../src/core/tour-bundle.js";
import type { Comment, Tour } from "../../src/core/types.js";

function tour(id: string): Tour {
  return {
    id,
    title: "T",
    status: "open",
    created_at: "2026-05-19T00:00:00Z",
    closed_at: "",
    head_sha: "h",
    base_sha: "b",
    head_source: "h",
    base_source: "b",
    wip_snapshot: false,
  };
}

function snapshotLostBundle(comments: Comment[] = []): TourBundle {
  return { kind: "snapshot-lost", tour: tour("tour-a"), comments };
}

function bundleFile(name: string): BundleFile {
  return {
    name,
    type: "change",
    hunks: [],
    classification: { collapsed: false },
    orphanWindows: [],
  };
}

function okBundle(comments: Comment[] = []): TourBundle {
  return {
    kind: "ok",
    tour: tour("tour-a"),
    comments,
    diff: "",
    files: [bundleFile("a.ts"), bundleFile("b.ts")],
  };
}

function comment(over: Partial<Comment> & { id: string }): Comment {
  return {
    id: over.id,
    file: over.file ?? "a.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 1,
    line_end: over.line_end ?? 1,
    body: over.body ?? "body",
    author: over.author ?? "user",
    author_kind: over.author_kind ?? "human",
    created_at: over.created_at ?? "2026-05-19T00:00:00Z",
    ...(over.replies_to !== undefined ? { replies_to: over.replies_to } : {}),
    ...(over.deleted !== undefined ? { deleted: over.deleted } : {}),
  };
}

function nonEmptySeed(commentId: string, file: string) {
  return {
    paneFocus: "diff",
    cursor: { kind: "card", commentId, preferredSide: "additions" },
    intents: [
      { type: "selectSidebarFile", file },
      {
        type: "scrollCursorTarget",
        target: { kind: "card", commentId },
        placement: "center",
        behavior: "instant",
      },
      { type: "mirrorAnnUrl", commentId },
    ],
  };
}

describe("computeTourOpenSeed", () => {
  it("snapshot-lost bundles seed sidebar focus, no cursor, and clear the mirrored ann id", () => {
    expect(computeTourOpenSeed(snapshotLostBundle(), "ann-1")).toEqual({
      paneFocus: "sidebar",
      cursor: null,
      intents: [{ type: "mirrorAnnUrl", commentId: null }],
    });
  });

  it("empty ok bundles seed sidebar focus, no cursor, and clear the mirrored ann id", () => {
    expect(computeTourOpenSeed(okBundle(), null)).toEqual({
      paneFocus: "sidebar",
      cursor: null,
      intents: [{ type: "mirrorAnnUrl", commentId: null }],
    });
  });

  it("non-empty bundles without annId seed the first top-level Comment", () => {
    const first = comment({ id: "ann-1", file: "a.ts" });
    const second = comment({ id: "ann-2", file: "b.ts" });

    expect(computeTourOpenSeed(okBundle([first, second]), null)).toEqual(
      nonEmptySeed("ann-1", "a.ts"),
    );
  });

  it("matching annId seeds that top-level Comment instead of topLevel[0]", () => {
    const first = comment({ id: "ann-1", file: "a.ts" });
    const second = comment({ id: "ann-2", file: "b.ts" });

    expect(computeTourOpenSeed(okBundle([first, second]), "ann-2")).toEqual(
      nonEmptySeed("ann-2", "b.ts"),
    );
  });

  it("annId pointing at a Reply falls back to topLevel[0]", () => {
    const first = comment({ id: "ann-1", file: "a.ts" });
    const reply = comment({ id: "reply-1", file: "b.ts", replies_to: "ann-1" });

    expect(computeTourOpenSeed(okBundle([first, reply]), "reply-1")).toEqual(
      nonEmptySeed("ann-1", "a.ts"),
    );
  });

  it("annId pointing at a deleted Comment falls back to topLevel[0]", () => {
    const first = comment({ id: "ann-1", file: "a.ts" });
    const deleted = comment({
      id: "ann-2",
      file: "b.ts",
      deleted: { at: "2026-05-19T01:00:00Z" },
    });

    expect(computeTourOpenSeed(okBundle([first, deleted]), "ann-2")).toEqual(
      nonEmptySeed("ann-1", "a.ts"),
    );
  });

  it("annId missing from the bundle falls back to topLevel[0]", () => {
    const first = comment({ id: "ann-1", file: "a.ts" });

    expect(computeTourOpenSeed(okBundle([first]), "missing")).toEqual(
      nonEmptySeed("ann-1", "a.ts"),
    );
  });
});
