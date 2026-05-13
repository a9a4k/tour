import type { ParityFixture } from "./types.js";

// Three files; the annotation lives in the MIDDLE file. Validates that
// per-file isolation holds — the annotation does not leak into the
// other files' planned rows (planner regression #199).
function fileDiff(name: string): string {
  return `diff --git a/${name} b/${name}
index 0000001..0000002 100644
--- a/${name}
+++ b/${name}
@@ -1,1 +1,2 @@
-old line in ${name}
+new line in ${name}
+extra line in ${name}
`;
}

const DIFF = fileDiff("first.ts") + fileDiff("middle.ts") + fileDiff("last.ts");

export const fixture: ParityFixture = {
  name: "deep-link-ann",
  diff: DIFF,
  annotations: [
    {
      id: "deep-link-target",
      file: "middle.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
      body: "Deep-link target.",
      author: "human",
      author_kind: "human",
      created_at: "2026-05-12T00:00:00Z",
    },
  ],
  layouts: ["unified"],
};
