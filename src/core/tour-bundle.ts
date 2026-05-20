import { getTour } from "./tour-store.js";
import { readComments } from "./comments-store.js";
import { getDiff, gitShow, isShaResolvable } from "./git.js";
import { parseDiff, type DiffHunk } from "./diff-model.js";
import { fetchFileContents } from "./file-content-provider.js";
import { computeOrphanWindows, hunkIndexToBoundaryRef } from "./orphan-window.js";
import { classifyFile, type FileClassification } from "./file-classifier.js";
import type { Tour, Comment } from "./types.js";
import type { BoundaryRef } from "./expansion-state.js";

export interface BundleFile {
  name: string;
  prevName?: string;
  type: string;
  hunks: DiffHunk[];
  oldContent?: string;
  newContent?: string;
  classification: FileClassification;
  orphanWindows: ReadonlyArray<{ ref: BoundaryRef; fromStart: number; fromEnd: number }>;
}

/**
 * Everything required to render a pinned Tour at open time, computed fresh
 * on every open. Discriminated by `kind`: `ok` carries the full payload;
 * `snapshot-lost` carries just Tour + Comments so the surface can render
 * the snapshot-lost banner without per-file machinery.
 *
 * Reply lock is intentionally OUT of the bundle — lock changes are
 * O(read one file) and are fetched separately by each surface so SSE
 * `reply-in-flight` / `reply-cleared` events don't trigger a full hydrate.
 */
export type TourBundle =
  | {
      kind: "ok";
      tour: Tour;
      comments: Comment[];
      diff: string;
      files: BundleFile[];
    }
  | { kind: "snapshot-lost"; tour: Tour; comments: Comment[] };

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  // Trailing newline doesn't add an empty trailing line.
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n").length;
}

export async function loadTourBundle(
  tourStoreRoot: string,
  tourId: string,
  repoRoot = tourStoreRoot,
): Promise<TourBundle> {
  const tour = await getTour(tourStoreRoot, tourId);
  const comments = await readComments(tourStoreRoot, tourId);

  const headOk = await isShaResolvable(tour.head_sha, repoRoot);
  const baseOk = await isShaResolvable(tour.base_sha, repoRoot);
  if (!headOk || !baseOk) {
    return { kind: "snapshot-lost", tour, comments };
  }

  const diff = await getDiff(tour.base_sha, tour.head_sha, repoRoot);
  const model = parseDiff(diff);

  const fileContents = await fetchFileContents(model, {
    baseSha: tour.base_sha,
    headSha: tour.head_sha,
    cwd: repoRoot,
    gitShow,
  });

  const files: BundleFile[] = await Promise.all(
    model.files.map(async (f) => {
      const isRenamed = f.type === "rename" || (!!f.prevName && f.prevName !== f.name);
      const hasChanges = f.hunks.length > 0;
      const isBinary = f.type === "binary";
      const classification = await classifyFile(f.name, {
        cwd: repoRoot,
        isBinary,
        isRenamed,
        hasChanges,
      });

      const contents = fileContents.get(f.name);
      const orphanWindows: { ref: BoundaryRef; fromStart: number; fromEnd: number }[] = [];
      if (contents) {
        const map = computeOrphanWindows(f, comments, {
          oldLineCount: lineCount(contents.oldContent),
          newLineCount: lineCount(contents.newContent),
        });
        for (const [hunkIndex, region] of map) {
          orphanWindows.push({
            ref: hunkIndexToBoundaryRef(hunkIndex, f.hunks.length),
            fromStart: region.fromStart,
            fromEnd: region.fromEnd,
          });
        }
      }

      return {
        name: f.name,
        prevName: f.prevName,
        type: f.type,
        hunks: f.hunks,
        oldContent: contents?.oldContent,
        newContent: contents?.newContent,
        classification,
        orphanWindows,
      };
    }),
  );

  return { kind: "ok", tour, comments, diff, files };
}
