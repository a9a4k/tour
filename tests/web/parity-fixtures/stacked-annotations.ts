import type { ParityFixture } from "./types.js";

// Multiple top-level annotations stacked at the same anchor row —
// CONTEXT.md's "cards-as-step-stops" scenario. Plus a Reply on the
// second annotation. The planner interleaves them at the same anchor
// row; FileBlock renders all three CardRows after the diff-row.
const DIFF = `diff --git a/stacked.ts b/stacked.ts
index 0000001..0000002 100644
--- a/stacked.ts
+++ b/stacked.ts
@@ -1,1 +1,2 @@
-original line
+changed line
+added line
`;

export const fixture: ParityFixture = {
  name: "stacked-annotations",
  diff: DIFF,
  annotations: [
    {
      id: "ann-a",
      file: "stacked.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
      body: "First card on this row.",
      author: "agent",
      author_kind: "agent",
      created_at: "2026-05-12T01:00:00Z",
    },
    {
      id: "ann-b",
      file: "stacked.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
      body: "Second card on the same row.",
      author: "human",
      author_kind: "human",
      created_at: "2026-05-12T02:00:00Z",
    },
    {
      id: "ann-b-r1",
      file: "stacked.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
      body: "Reply to ann-b.",
      author: "agent",
      author_kind: "agent",
      replies_to: "ann-b",
      created_at: "2026-05-12T02:30:00Z",
    },
  ],
  layouts: ["unified"],
};
