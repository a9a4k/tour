import type { ParityFixture } from "./types.js";

// A file with a hunk in the middle so there's both a file-top gap and
// a file-bottom gap. The new content is 30 lines long; hunk addresses
// lines 11-13. Gaps: top = 10, bottom = ~17. Used to verify both
// renderers emit gap rows (hunk-header w/ gapAbove > 0 and a trailing
// `boundary-bottom` interactive row).
const OLD_LINES = Array.from({ length: 29 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const NEW_LINES = (() => {
  const lines = Array.from({ length: 29 }, (_, i) => `line ${i + 1}`);
  lines[10] = "line 11 changed";
  lines.splice(11, 0, "line 11.5 inserted");
  return lines.join("\n") + "\n";
})();

const DIFF = `diff --git a/big.txt b/big.txt
index 0000001..0000002 100644
--- a/big.txt
+++ b/big.txt
@@ -10,3 +10,4 @@ context
 line 10
-line 11
+line 11 changed
+line 11.5 inserted
 line 12
`;

export const fixture: ParityFixture = {
  name: "hidden-context",
  diff: DIFF,
  oldContents: { "big.txt": OLD_LINES },
  newContents: { "big.txt": NEW_LINES },
  annotations: [],
  layouts: ["unified"],
};
