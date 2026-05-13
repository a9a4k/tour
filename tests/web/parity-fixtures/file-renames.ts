import type { ParityFixture } from "./types.js";

// Pure rename + a rename-with-content-change. Both renderers must show
// the rename pill on the file header and (for the rename-with-change)
// emit the modified hunk.
const DIFF = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
diff --git a/foo.ts b/bar.ts
similarity index 80%
rename from foo.ts
rename to bar.ts
index 0000001..0000002 100644
--- a/foo.ts
+++ b/bar.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
`;

export const fixture: ParityFixture = {
  name: "file-renames",
  diff: DIFF,
  annotations: [],
  layouts: ["unified"],
};
