import { getTour, listTours, resolveIdPrefix } from "../core/tour-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile, type FileClassification } from "../core/file-classifier.js";

interface TuiArgs {
  tourId?: string;
  cwd: string;
}

export async function tui(args: TuiArgs): Promise<void> {
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

  const tour = await getTour(args.cwd, tourId);
  const annotations = await readAnnotations(args.cwd, tourId);

  const headResolvable = await isShaResolvable(tour.head_sha, args.cwd);
  const baseResolvable = await isShaResolvable(tour.base_sha, args.cwd);
  const snapshotLost = !headResolvable || !baseResolvable;

  let rawDiff = "";
  let files: { name: string; prevName?: string; type: string; hunks: unknown[] }[] = [];
  let classifications: Record<string, FileClassification> = {};

  if (!snapshotLost) {
    rawDiff = await getDiff(tour.base_sha, tour.head_sha, args.cwd);
    const model = parseDiff(rawDiff);
    files = model.files;

    const entries = await Promise.all(
      model.files.map(async (f) => {
        const isRenamed = f.type === "rename" || (!!f.prevName && f.prevName !== f.name);
        const hasChanges = f.hunks.length > 0;
        const isBinary = f.type === "binary";
        const cls = await classifyFile(f.name, { cwd: args.cwd, isBinary, isRenamed, hasChanges });
        return [f.name, cls] as const;
      }),
    );
    classifications = Object.fromEntries(entries);
  }

  const tuiModule = "../tui/app.js";
  const { startTui } = await import(/* @vite-ignore */ tuiModule) as {
    startTui: (props: {
      tour: typeof tour;
      diff: string;
      files: typeof files;
      annotations: typeof annotations;
      snapshotLost: boolean;
      classifications: Record<string, FileClassification>;
    }) => Promise<void>;
  };
  await startTui({ tour, diff: rawDiff, files, annotations, snapshotLost, classifications });
}
