import type { ParityFixture } from "./types.js";

const DIFF = `diff --git a/hello.ts b/hello.ts
index 0000001..0000002 100644
--- a/hello.ts
+++ b/hello.ts
@@ -1,3 +1,4 @@
 export function hello(name: string): string {
-  return "hi " + name;
+  return \`hi \${name}\`;
+  // trailing comment
 }
`;

export const fixture: ParityFixture = {
  name: "single-small-file",
  diff: DIFF,
  annotations: [],
  layouts: ["split", "unified"],
};
