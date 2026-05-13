import type { ParityFixture } from "./types.js";
import type { ExpansionState } from "../../../src/core/expansion-state.js";

// Annotation whose anchor line falls in hidden context — the ±10 line
// orphan window pre-expands. Fixture seeds the expansion so the
// annotation's anchor line is visible in the planner output.
const OLD_LINES = Array.from({ length: 29 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const NEW_LINES = (() => {
  const lines = Array.from({ length: 29 }, (_, i) => `line ${i + 1}`);
  lines[14] = "line 15 changed";
  return lines.join("\n") + "\n";
})();

const DIFF = `diff --git a/big.txt b/big.txt
index 0000001..0000002 100644
--- a/big.txt
+++ b/big.txt
@@ -14,3 +14,3 @@ context
 line 14
-line 15
+line 15 changed
 line 16
`;

// Pre-expand top boundary so the orphan-anchored annotation lands on a
// visible row at line 5. Without this the planner doesn't emit a diff
// row at line 5 and the annotation has no anchor row to attach to.
const expansion: ExpansionState = new Map([
  [
    "big.txt",
    {
      fileExpanded: false,
      boundaries: new Map([["top", { up: 10, down: 0 }]]),
    },
  ],
]);

export const fixture: ParityFixture = {
  name: "orphan-window-annotations",
  diff: DIFF,
  oldContents: { "big.txt": OLD_LINES },
  newContents: { "big.txt": NEW_LINES },
  annotations: [
    {
      id: "orph-1",
      file: "big.txt",
      side: "additions",
      line_start: 5,
      line_end: 5,
      body: "Anchored to a pre-expanded line.",
      author: "agent",
      author_kind: "agent",
      created_at: "2026-05-12T00:00:00Z",
    },
  ],
  expansion,
  layouts: ["unified"],
};
