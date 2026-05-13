import type { ParityFixture } from "./types.js";

// Same fixture run under both split and unified layouts to confirm
// layout-switching parity. Includes a change-pair so split vs unified
// row counts differ in interesting ways at the planner level.
const DIFF = `diff --git a/swap.ts b/swap.ts
index 0000001..0000002 100644
--- a/swap.ts
+++ b/swap.ts
@@ -1,3 +1,4 @@
 const start = "begin";
-const middle = "old";
+const middle = "new";
+const extra = "added";
 const end = "stop";
`;

export const fixture: ParityFixture = {
  name: "layout-split-and-unified",
  diff: DIFF,
  annotations: [],
  layouts: ["split", "unified"],
};
