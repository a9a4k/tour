import { userInfo } from "node:os";
import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import { getTour, listTours, resolveIdPrefix } from "../core/tour-store.js";
import { appendAnnotation, readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile, type FileClassification } from "../core/file-classifier.js";
import { generateId } from "../core/ids.js";
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

export type WriteAnnotationInput =
  | {
      kind: "top-level";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
      body: string;
    }
  | { kind: "reply"; parent: Annotation; body: string };

// In-process annotate path used by the TUI inline composer. Routes through
// `appendAnnotation` (the same primitive `tour annotate` uses underneath) so
// human-authored notes are indistinguishable on disk from CLI-authored ones.
// Replies inherit the parent's anchor — same rule as the CLI's `--reply-to`
// path, applied at write time so readers don't have to walk chains.
async function writeAnnotationFromTui(
  cwd: string,
  tourId: string,
  input: WriteAnnotationInput,
): Promise<Annotation> {
  const author = humanAuthor();
  const now = new Date().toISOString();
  if (input.kind === "reply") {
    const ann: Annotation = {
      id: generateId(),
      file: input.parent.file,
      side: input.parent.side,
      line_start: input.parent.line_start,
      line_end: input.parent.line_end,
      body: input.body,
      author,
      author_kind: "human",
      replies_to: input.parent.id,
      created_at: now,
    };
    await appendAnnotation(cwd, tourId, ann);
    return ann;
  }
  const ann: Annotation = {
    id: generateId(),
    file: input.file,
    side: input.side,
    line_start: input.line_start,
    line_end: input.line_end,
    body: input.body,
    author,
    author_kind: "human",
    created_at: now,
  };
  await appendAnnotation(cwd, tourId, ann);
  return ann;
}

function humanAuthor(): string {
  try {
    const username = userInfo().username;
    return username || "human";
  } catch {
    return "human";
  }
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
      writeAnnotation: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
      cwd: string;
      replyAgent?: string;
    }) => Promise<void>;
  };
  await startTui({
    ...initial,
    loadTour: (id) => loadTourBundle(args.cwd, id),
    writeAnnotation: (id, input) => writeAnnotationFromTui(args.cwd, id, input),
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
