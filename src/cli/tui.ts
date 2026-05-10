import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import { getTour, listTours, resolveIdPrefix } from "../core/tour-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile, type FileClassification } from "../core/file-classifier.js";
import { assertAdapterExists } from "../core/agent-adapter.js";
import { readReplyLock, type ReplyLock } from "../core/reply-lock.js";

interface TuiArgs {
  tourId?: string;
  cwd: string;
  replyAgent?: string;
}

interface LoadedBundle {
  tour: Tour;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
  classifications: Record<string, FileClassification>;
  replyLock: ReplyLock | null;
}

async function loadTourBundle(cwd: string, tourId: string): Promise<LoadedBundle> {
  const tour = await getTour(cwd, tourId);
  const annotations = await readAnnotations(cwd, tourId);

  const headResolvable = await isShaResolvable(tour.head_sha, cwd);
  const baseResolvable = await isShaResolvable(tour.base_sha, cwd);
  const snapshotLost = !headResolvable || !baseResolvable;

  let rawDiff = "";
  let files: DiffFile[] = [];
  let classifications: Record<string, FileClassification> = {};

  if (!snapshotLost) {
    rawDiff = await getDiff(tour.base_sha, tour.head_sha, cwd);
    const model = parseDiff(rawDiff);
    files = model.files;

    const entries = await Promise.all(
      model.files.map(async (f) => {
        const isRenamed = f.type === "rename" || (!!f.prevName && f.prevName !== f.name);
        const hasChanges = f.hunks.length > 0;
        const isBinary = f.type === "binary";
        const cls = await classifyFile(f.name, { cwd, isBinary, isRenamed, hasChanges });
        return [f.name, cls] as const;
      }),
    );
    classifications = Object.fromEntries(entries);
  }

  const replyLock = await readReplyLock(cwd, tourId);

  return {
    tour,
    diff: rawDiff,
    files,
    annotations,
    snapshotLost,
    classifications,
    replyLock,
  };
}

export async function tui(args: TuiArgs): Promise<void> {
  // Hard-fail at startup if the requested reply-agent's adapter is missing,
  // per the PRD. Misconfiguration must surface up-front, not at first reply.
  if (args.replyAgent) {
    assertAdapterExists(args.replyAgent);
  }

  let tourId: string;

  if (args.tourId) {
    tourId = await resolveIdPrefix(args.cwd, args.tourId);
  } else {
    const tours = await listTours(args.cwd, { status: "open" });
    if (tours.length === 0) {
      throw new Error("No open tours. Create one with: tour create --head HEAD");
    }
    tourId = tours[tours.length - 1].id;
  }

  const initial = await loadTourBundle(args.cwd, tourId);

  const tuiModule = "../tui/app.js";
  const { startTui } = await import(/* @vite-ignore */ tuiModule) as {
    startTui: (props: LoadedBundle & {
      loadTour: (id: string) => Promise<LoadedBundle>;
      loadTours: () => Promise<{ tours: Tour[]; annotationCounts: Record<string, number> }>;
      cwd: string;
      replyAgent?: string;
    }) => Promise<void>;
  };
  await startTui({
    ...initial,
    loadTour: (id) => loadTourBundle(args.cwd, id),
    loadTours: async () => {
      const tours = await listTours(args.cwd, { status: "all" });
      const counts: Record<string, number> = {};
      await Promise.all(
        tours.map(async (t) => {
          try {
            const ann = await readAnnotations(args.cwd, t.id);
            counts[t.id] = ann.length;
          } catch {
            counts[t.id] = 0;
          }
        }),
      );
      return { tours, annotationCounts: counts };
    },
    cwd: args.cwd,
    replyAgent: args.replyAgent,
  });
}
