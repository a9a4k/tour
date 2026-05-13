import type { ParityFixture } from "./types.js";

// A binary file change. Both renderers must NOT emit any diff rows;
// the file header alone signals the change.
const DIFF = `diff --git a/image.png b/image.png
index 0000001..0000002 100644
Binary files a/image.png and b/image.png differ
`;

export const fixture: ParityFixture = {
  name: "binary-files",
  diff: DIFF,
  annotations: [],
  layouts: ["unified"],
  classifications: {
    "image.png": { collapsed: true, reason: "binary" },
  },
};
