import type { ParityFixture } from "./types.js";

// 10 small modified files in one patch. Tests that the harness handles
// per-file iteration without cross-file leakage (planner regression
// #199 — annotation flags scoped per-file).
function fileDiff(i: number): string {
  return `diff --git a/file-${i}.ts b/file-${i}.ts
index 0000${i}..1000${i} 100644
--- a/file-${i}.ts
+++ b/file-${i}.ts
@@ -1,2 +1,3 @@
 // file ${i}
-const v${i} = ${i};
+const v${i} = ${i + 100};
+export { v${i} };
`;
}

const DIFF = Array.from({ length: 10 }, (_, i) => fileDiff(i + 1)).join("");

export const fixture: ParityFixture = {
  name: "many-files",
  diff: DIFF,
  annotations: [],
  layouts: ["unified"],
};
