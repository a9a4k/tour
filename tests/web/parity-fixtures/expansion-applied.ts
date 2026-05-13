import type { ParityFixture } from "./types.js";
import type { ExpansionState } from "../../../src/core/expansion-state.js";

// Hidden context already partially expanded — the planner emits the
// revealed lines + a reduced gap row. Both renderers should agree on
// the post-expansion row sequence.
const OLD_LINES = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const NEW_LINES = (() => {
  const lines = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`);
  lines[14] = "line 15 changed";
  return lines.join("\n") + "\n";
})();

const DIFF = `diff --git a/file.txt b/file.txt
index 0000001..0000002 100644
--- a/file.txt
+++ b/file.txt
@@ -14,3 +14,3 @@
 line 14
-line 15
+line 15 changed
 line 16
`;

// Reveal 5 lines from the file-top gap. Planner emits those as context
// rows; gapAbove for the hunk-header drops by 5.
const expansion: ExpansionState = new Map([
  [
    "file.txt",
    {
      fileExpanded: false,
      boundaries: new Map([["top", { up: 5, down: 0 }]]),
    },
  ],
]);

export const fixture: ParityFixture = {
  name: "expansion-applied",
  diff: DIFF,
  oldContents: { "file.txt": OLD_LINES },
  newContents: { "file.txt": NEW_LINES },
  annotations: [],
  expansion,
  layouts: ["unified"],
};
