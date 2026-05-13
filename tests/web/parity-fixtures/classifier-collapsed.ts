import type { ParityFixture } from "./types.js";

// Lockfile + generated + vendored. All three would normally classify
// as collapsed (the file-classifier sets `collapsed: true`). Planner
// emits a single synthetic `collapsed-file` interactive row in place
// of the diff body. The new <FileBlock> dispatches that to
// <InteractiveRow subKind="collapsed-file">; Pierre uses its
// `collapsed: true` option.
function makeDiff(name: string): string {
  return `diff --git a/${name} b/${name}
index 0000001..0000002 100644
--- a/${name}
+++ b/${name}
@@ -1,1 +1,2 @@
-old
+new
+extra
`;
}

const DIFF =
  makeDiff("package-lock.json") +
  makeDiff("dist/generated.js") +
  makeDiff("vendor/lib.js");

export const fixture: ParityFixture = {
  name: "classifier-collapsed",
  diff: DIFF,
  annotations: [],
  layouts: ["unified"],
  classifierCollapsed: new Set([
    "package-lock.json",
    "dist/generated.js",
    "vendor/lib.js",
  ]),
  classifications: {
    "package-lock.json": { collapsed: true, reason: "lockfile" },
    "dist/generated.js": { collapsed: true, reason: "generated" },
    "vendor/lib.js": { collapsed: true, reason: "vendored" },
  },
};
