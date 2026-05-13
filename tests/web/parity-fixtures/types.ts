import type { BundleFile, Annotation } from "../../../src/web/client/types.js";
import type { ExpansionState } from "../../../src/core/expansion-state.js";

/**
 * A canonical TourBundle-shaped input for the parity test harness (PRD
 * #212, issue #219). Each fixture covers one user-visible scenario the
 * cutover must preserve. The harness mounts both renderers (Pierre's
 * SSR `<FileDiff>` HTML + the Tour-owned `<FileBlock>` from #218)
 * against the fixture and asserts equivalent visible-row sequences.
 *
 * Fields are small on purpose: each fixture stays under ~200 lines of
 * source so the suite runs in seconds.
 */
export interface ParityFixture {
  /** Stable id used in test names + assertion failure diffs. */
  name: string;
  /** Raw git patch passed to `parsePatchFiles` and `parseDiff`. */
  diff: string;
  /** Optional per-file old contents. Required for hidden-context
   *  expansion (`preloadMultiFileDiff` needs the full pre-image). */
  oldContents?: Record<string, string>;
  /** Optional per-file new contents (post-image). */
  newContents?: Record<string, string>;
  /** Top-level + reply annotations attached to files in the patch. */
  annotations: Annotation[];
  /** Which layouts to run this fixture under. Defaults to ["unified"]
   *  in the harness when omitted. */
  layouts: Array<"split" | "unified">;
  /** Pre-applied expansion state (the `expansion-applied` fixture
   *  exercises this). */
  expansion?: ExpansionState;
  /** Files marked classifier-collapsed at planner time. The
   *  `classifier-collapsed` fixture exercises this. */
  classifierCollapsed?: Set<string>;
  /** Per-file classification override used by the FileBlock mount
   *  (renamed / binary / generated). Optional; defaults derived from
   *  the patch type. */
  classifications?: Record<string, BundleFile["classification"]>;
}
