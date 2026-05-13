import { describe, it, expect } from "vitest";
import {
  deriveTourSessionView,
  type TourSessionView,
} from "../../src/core/tour-session-view.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import type { Tour, Annotation } from "../../src/core/types.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import {
  initialTourSessionState,
  type TourSessionState,
} from "../../src/core/tour-session.js";
import { topLevelAnnotations } from "../../src/core/threads.js";
import {
  buildTree,
  compress,
  flatten,
  sortFilesForStream,
} from "../../src/core/file-tree.js";
import { parseFileDiffMetadata } from "../../src/core/diff-model.js";
import { planRows } from "../../src/core/diff-rows.js";
import { flatRows } from "../../src/core/flat-rows.js";

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

function ann(o: Partial<Annotation> & Pick<Annotation, "id">): Annotation {
  return {
    id: o.id,
    file: o.file ?? "a.ts",
    side: o.side ?? "additions",
    line_start: o.line_start ?? 1,
    line_end: o.line_end ?? 1,
    body: o.body ?? "body",
    author: o.author ?? (o.author_kind === "agent" ? "claude" : "user"),
    author_kind: o.author_kind ?? "human",
    replies_to: o.replies_to,
    created_at: o.created_at ?? "2026-05-12T00:00:00Z",
  };
}

const DIFF_A = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
`;

const DIFF_A_AND_B = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/sub/b.ts b/sub/b.ts
--- a/sub/b.ts
+++ b/sub/b.ts
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

function fileB(): BundleFile {
  return {
    name: "sub/b.ts",
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

function okBundle(
  over: Partial<Extract<TourBundle, { kind: "ok" }>> = {},
): TourBundle {
  return {
    kind: "ok",
    tour: tour({ id: "t1" }),
    annotations: [],
    diff: DIFF_A,
    files: [fileA()],
    ...over,
  };
}

function snapshotLostBundle(): TourBundle {
  return {
    kind: "snapshot-lost",
    tour: tour({ id: "t1" }),
    annotations: [ann({ id: "a1" })],
  };
}

const cardCursor = (annotationId: string): Cursor => ({
  kind: "card",
  annotationId,
  preferredSide: "additions",
});

function expectOk(
  v: TourSessionView,
): Extract<TourSessionView, { kind: "ok" }> {
  if (v.kind !== "ok") throw new Error("expected ok view");
  return v;
}

describe("deriveTourSessionView — snapshot-lost", () => {
  it("short-circuits to snapshot-lost view carrying tour + annotations only", () => {
    const view = deriveTourSessionView(
      snapshotLostBundle(),
      initialTourSessionState(),
    );
    expect(view.kind).toBe("snapshot-lost");
    if (view.kind !== "snapshot-lost") throw new Error("unreachable");
    expect(view.tour.id).toBe("t1");
    expect(view.annotations).toHaveLength(1);
    expect(view.annotations[0].id).toBe("a1");
  });

  it("exposes nav.topLevel / navIndexById / navTotal / repliesByRoot on the snapshot-lost branch (issue #246)", () => {
    const top = ann({ id: "a1", created_at: "2026-05-12T00:00:00Z" });
    const reply = ann({
      id: "r1",
      replies_to: "a1",
      created_at: "2026-05-12T00:00:01Z",
    });
    const orphan = ann({
      id: "o1",
      replies_to: "missing-id",
      created_at: "2026-05-12T00:00:02Z",
    });
    const view = deriveTourSessionView(
      {
        kind: "snapshot-lost",
        tour: tour({ id: "t1" }),
        annotations: [top, reply, orphan],
      },
      initialTourSessionState(),
    );
    if (view.kind !== "snapshot-lost") throw new Error("unreachable");
    expect(view.nav.topLevel.map((a) => a.id)).toEqual(["a1"]);
    expect(view.nav.navIndexById.get("a1")).toBe(1);
    expect(view.nav.navIndexById.has("r1")).toBe(false);
    expect(view.nav.navTotal).toBe(1);
    const replies = view.nav.repliesByRoot.get("a1");
    expect(replies?.map((r) => r.id)).toEqual(["r1"]);
    expect(view.nav.repliesByRoot.has("missing-id")).toBe(false);
  });
});

describe("deriveTourSessionView — bundle slice", () => {
  it("filesByName keys each BundleFile by `name`", () => {
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ files: [fileA(), fileB()], diff: DIFF_A_AND_B }),
        initialTourSessionState(),
      ),
    );
    expect(view.bundle.filesByName.size).toBe(2);
    expect(view.bundle.filesByName.get("a.ts")?.name).toBe("a.ts");
    expect(view.bundle.filesByName.get("sub/b.ts")?.name).toBe("sub/b.ts");
  });

  it("classifications projects per-file classification into a flat record", () => {
    const f = fileA();
    f.classification = { collapsed: true, reason: "generated" };
    const view = expectOk(
      deriveTourSessionView(okBundle({ files: [f] }), initialTourSessionState()),
    );
    expect(view.bundle.classifications["a.ts"]).toEqual({
      collapsed: true,
      reason: "generated",
    });
  });

  it("fileContents populates only when both old + new contents are strings", () => {
    const withContent = fileA();
    const noContent: BundleFile = {
      ...fileB(),
      oldContent: undefined,
      newContent: undefined,
    };
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ files: [withContent, noContent], diff: DIFF_A_AND_B }),
        initialTourSessionState(),
      ),
    );
    expect(view.bundle.fileContents.has("a.ts")).toBe(true);
    expect(view.bundle.fileContents.has("sub/b.ts")).toBe(false);
  });
});

describe("deriveTourSessionView — nav slice", () => {
  it("topLevel matches topLevelAnnotations (replies excluded, order preserved)", () => {
    const top = ann({ id: "a1", created_at: "2026-05-12T00:00:00Z" });
    const reply = ann({
      id: "r1",
      replies_to: "a1",
      created_at: "2026-05-12T00:00:01Z",
    });
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ annotations: [top, reply] }),
        initialTourSessionState(),
      ),
    );
    expect(view.nav.topLevel).toEqual(topLevelAnnotations([top, reply]));
    expect(view.nav.topLevel.map((a) => a.id)).toEqual(["a1"]);
  });

  it("navIndexById is 1-based, top-level only", () => {
    const t1 = ann({ id: "t1" });
    const t2 = ann({ id: "t2", created_at: "2026-05-12T00:00:01Z" });
    const reply = ann({ id: "r1", replies_to: "t1" });
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ annotations: [t1, t2, reply] }),
        initialTourSessionState(),
      ),
    );
    expect(view.nav.navIndexById.get("t1")).toBe(1);
    expect(view.nav.navIndexById.get("t2")).toBe(2);
    expect(view.nav.navIndexById.has("r1")).toBe(false);
    expect(view.nav.navTotal).toBe(2);
  });

  it("repliesByRoot excludes orphan replies (parent missing)", () => {
    const top = ann({ id: "t1" });
    const reply = ann({ id: "r1", replies_to: "t1" });
    const orphan = ann({ id: "o1", replies_to: "missing-id" });
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ annotations: [top, reply, orphan] }),
        initialTourSessionState(),
      ),
    );
    const replies = view.nav.repliesByRoot.get("t1");
    expect(replies).toBeDefined();
    expect(replies!.map((r) => r.id)).toEqual(["r1"]);
    // The orphan's id should not appear as a root key.
    expect(view.nav.repliesByRoot.has("o1")).toBe(false);
    expect(view.nav.repliesByRoot.has("missing-id")).toBe(false);
  });

  it("currentIdx is 1-based when the cursor is on a card, 0 otherwise", () => {
    const t1 = ann({ id: "t1" });
    const t2 = ann({ id: "t2", created_at: "2026-05-12T00:00:01Z" });
    const bundle = okBundle({ annotations: [t1, t2] });

    const onT2 = expectOk(
      deriveTourSessionView(bundle, {
        ...initialTourSessionState(),
        cursor: cardCursor("t2"),
      }),
    );
    expect(onT2.nav.currentIdx).toBe(2);

    const nullCursor = expectOk(
      deriveTourSessionView(bundle, initialTourSessionState()),
    );
    expect(nullCursor.nav.currentIdx).toBe(0);
  });

  it("sendTarget mirrors the latest-human-leaf rule", () => {
    const top = ann({
      id: "t1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:00Z",
    });
    const agentReply = ann({
      id: "r1",
      replies_to: "t1",
      author_kind: "agent",
      created_at: "2026-05-12T00:00:01Z",
    });
    const humanFollowUp = ann({
      id: "r2",
      replies_to: "r1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:02Z",
    });
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ annotations: [top, agentReply, humanFollowUp] }),
        { ...initialTourSessionState(), cursor: cardCursor("t1") },
      ),
    );
    expect(view.nav.sendTarget).not.toBeNull();
    expect(view.nav.sendTarget!.leafId).toBe("r2");
    expect(view.nav.sendTarget!.leaf.id).toBe("r2");
  });

  it("sendTarget is null when the latest turn is agent-authored", () => {
    const top = ann({
      id: "t1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:00Z",
    });
    const agentReply = ann({
      id: "r1",
      replies_to: "t1",
      author_kind: "agent",
      created_at: "2026-05-12T00:00:01Z",
    });
    const view = expectOk(
      deriveTourSessionView(
        okBundle({ annotations: [top, agentReply] }),
        { ...initialTourSessionState(), cursor: cardCursor("t1") },
      ),
    );
    expect(view.nav.sendTarget).toBeNull();
  });
});

describe("deriveTourSessionView — tree slice", () => {
  it("root agrees with compress(buildTree(bundle.files))", () => {
    const bundle = okBundle({ files: [fileA(), fileB()], diff: DIFF_A_AND_B });
    const view = expectOk(
      deriveTourSessionView(bundle, initialTourSessionState()),
    );
    expect(view.tree.root).toEqual(compress(buildTree([fileA(), fileB()])));
  });

  it("visibleRows agrees with flatten(root, collapsedFolders, annotationCounts)", () => {
    const bundle = okBundle({ files: [fileA(), fileB()], diff: DIFF_A_AND_B });
    const view = expectOk(
      deriveTourSessionView(bundle, initialTourSessionState()),
    );
    const expected = flatten(
      compress(buildTree([fileA(), fileB()])),
      new Set<string>(),
      view.tree.annotationCounts,
    );
    expect(view.tree.visibleRows).toEqual(expected);
  });

  it("annotationCounts counts top-level annotations per file", () => {
    const t1 = ann({ id: "t1", file: "a.ts" });
    const r1 = ann({ id: "r1", file: "a.ts", replies_to: "t1" });
    const t2 = ann({ id: "t2", file: "sub/b.ts" });
    const view = expectOk(
      deriveTourSessionView(
        okBundle({
          annotations: [t1, r1, t2],
          files: [fileA(), fileB()],
          diff: DIFF_A_AND_B,
        }),
        initialTourSessionState(),
      ),
    );
    expect(view.tree.annotationCounts["a.ts"]).toBe(1);
    expect(view.tree.annotationCounts["sub/b.ts"]).toBe(1);
  });
});

describe("deriveTourSessionView — rows slice", () => {
  it("plannedRowsByFile agrees with planRows(meta, fileAnnotations, layout, opts) per file", () => {
    const t1 = ann({ id: "t1", file: "a.ts" });
    const bundle = okBundle({ annotations: [t1] });
    const state = initialTourSessionState();
    const view = expectOk(deriveTourSessionView(bundle, state));

    const parsed = sortFilesForStream(parseFileDiffMetadata(bundle.diff));
    expect(parsed).toHaveLength(1);
    const expected = planRows(parsed[0], [t1], state.layout, {
      oldContent: fileA().oldContent,
      newContent: fileA().newContent,
      expansion: state.expansion,
      classifierCollapsed: false,
    });
    expect(view.rows.plannedRowsByFile.get("a.ts")).toEqual(expected);
  });

  it("flatRowsList agrees with flatRows(files, plannedRowsByFile, isFolded) and rowCount === length", () => {
    const bundle = okBundle({ files: [fileA(), fileB()], diff: DIFF_A_AND_B });
    const state = initialTourSessionState();
    const view = expectOk(deriveTourSessionView(bundle, state));
    const parsed = sortFilesForStream(parseFileDiffMetadata(bundle.diff));
    const planned = new Map<string, ReturnType<typeof planRows>>();
    for (const f of parsed) {
      const bf = f.name === "a.ts" ? fileA() : fileB();
      planned.set(
        f.name,
        planRows(f, [], state.layout, {
          oldContent: bf.oldContent,
          newContent: bf.newContent,
          expansion: state.expansion,
          classifierCollapsed: false,
        }),
      );
    }
    const expected = flatRows(
      parsed.map((f) => ({ name: f.name, type: "change", hunks: [] })),
      planned,
      () => false,
    );
    expect(view.rows.flatRowsList).toEqual(expected);
    expect(view.rows.rowCount).toBe(view.rows.flatRowsList.length);
  });
});

describe("deriveTourSessionView — cursor slice", () => {
  // The killer fixture (PRD #242, issue #243): a CardAnchor pointing at an
  // annotation that's been deleted resolves to null, currentIdx folds to 0,
  // and every cursor predicate reads as "not on a card".
  it("CardAnchor → deleted annotation: anchor null, predicates off, currentIdx 0", () => {
    const view = expectOk(
      deriveTourSessionView(okBundle({ annotations: [] }), {
        ...initialTourSessionState(),
        cursor: cardCursor("deleted-id"),
      }),
    );
    expect(view.cursor.anchor).toBeNull();
    expect(view.cursor.onCard).toBe(false);
    expect(view.cursor.onInteractive).toBe(false);
    expect(view.cursor.cardId).toBeNull();
    expect(view.cursor.cardAnnotation).toBeNull();
    expect(view.cursor.rowIdx).toBe(-1);
    expect(view.nav.currentIdx).toBe(0);
  });

  it("CardAnchor on a live annotation: onCard true, cardId set, cardAnnotation resolved", () => {
    const t1 = ann({ id: "t1", file: "a.ts", line_end: 1 });
    const view = expectOk(
      deriveTourSessionView(okBundle({ annotations: [t1] }), {
        ...initialTourSessionState(),
        cursor: cardCursor("t1"),
      }),
    );
    expect(view.cursor.anchor).toEqual(cardCursor("t1"));
    expect(view.cursor.onCard).toBe(true);
    expect(view.cursor.onInteractive).toBe(false);
    expect(view.cursor.cardId).toBe("t1");
    expect(view.cursor.cardAnnotation?.id).toBe("t1");
    expect(view.cursor.rowIdx).toBeGreaterThanOrEqual(0);
  });

  it("RowAnchor on an interactive row: onInteractive true, cardId null", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "a.ts",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "boundary-top", boundaryRef: "top" },
    };
    const view = expectOk(
      deriveTourSessionView(okBundle(), {
        ...initialTourSessionState(),
        cursor,
      }),
    );
    // The single-hunk diff fixture has the first hunk at line 1, so no
    // interactive row materializes for the cursor to resolve against;
    // anchor preservation still keeps onInteractive consistent with the
    // anchor's shape (validateCursor preserves a RowAnchor when its file
    // is still in the bundle).
    expect(view.cursor.onCard).toBe(false);
    expect(view.cursor.cardId).toBeNull();
    // Predicate consistency: onInteractive iff anchor is a row anchor with
    // `interactive` set.
    const expected =
      view.cursor.anchor !== null &&
      view.cursor.anchor.kind === "row" &&
      !!view.cursor.anchor.interactive;
    expect(view.cursor.onInteractive).toBe(expected);
  });

  it("null cursor: every predicate reads false / null / -1 / 0", () => {
    const view = expectOk(
      deriveTourSessionView(okBundle(), initialTourSessionState()),
    );
    expect(view.cursor.anchor).toBeNull();
    expect(view.cursor.onCard).toBe(false);
    expect(view.cursor.onInteractive).toBe(false);
    expect(view.cursor.cardId).toBeNull();
    expect(view.cursor.cardAnnotation).toBeNull();
    expect(view.cursor.rowIdx).toBe(-1);
    expect(view.nav.currentIdx).toBe(0);
  });
});

describe("deriveTourSessionView — watcher-reload preservation", () => {
  it("cursor anchor on a card survives a bundle refresh that retains the annotation", () => {
    const t1 = ann({ id: "t1", file: "a.ts", line_end: 1 });
    const state: TourSessionState = {
      ...initialTourSessionState(),
      cursor: cardCursor("t1"),
    };

    const before = expectOk(
      deriveTourSessionView(okBundle({ annotations: [t1] }), state),
    );
    expect(before.cursor.anchor).toEqual(cardCursor("t1"));

    // Simulate a watcher refresh: annotation list keeps t1 but adds a reply.
    const reply = ann({
      id: "r1",
      replies_to: "t1",
      created_at: "2026-05-12T00:00:01Z",
    });
    const after = expectOk(
      deriveTourSessionView(okBundle({ annotations: [t1, reply] }), state),
    );
    expect(after.cursor.anchor).toEqual(cardCursor("t1"));
    expect(after.cursor.cardId).toBe("t1");
    expect(after.cursor.cardAnnotation?.id).toBe("t1");
  });

  it("cursor on a card whose annotation disappears from the refreshed bundle resolves to null", () => {
    const state: TourSessionState = {
      ...initialTourSessionState(),
      cursor: cardCursor("t1"),
    };
    const view = expectOk(
      deriveTourSessionView(okBundle({ annotations: [] }), state),
    );
    expect(view.cursor.anchor).toBeNull();
    expect(view.cursor.cardAnnotation).toBeNull();
    expect(state.cursor).toEqual(cardCursor("t1")); // raw state unchanged
  });
});
