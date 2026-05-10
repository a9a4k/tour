import { userInfo } from "node:os";
import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile } from "../core/diff-model.js";
import { getTour, listTours, resolveIdPrefix } from "../core/tour-store.js";
import { appendAnnotation, readAnnotations } from "../core/annotations-store.js";
import { getDiff, gitShow, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile, type FileClassification } from "../core/file-classifier.js";
import { generateId } from "../core/ids.js";
import { assertShippedAgent } from "../agents/index.js";
import { readReplyLock, type ReplyLock } from "../core/reply-lock.js";
import { fetchFileContents, type FileContentPair } from "../core/file-content-provider.js";
import { orphanSeedWindows } from "../core/orphan-window.js";
import type { OrphanWindow } from "../core/expansion-state.js";

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
  fileContents: Map<string, FileContentPair>;
  orphanWindows: OrphanWindow[];
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  // Match webapp's lineCount (server.ts): trailing newline doesn't add an
  // empty trailing line. Keeps both surfaces' orphan-window math identical.
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n").length;
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
  let fileContents: Map<string, FileContentPair> = new Map();
  let orphanWindows: OrphanWindow[] = [];

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

    // Load full file contents per side for Hidden-context expansion (PRD #108).
    // The webapp's bundle build does the same via the same provider; symmetry
    // keeps the two surfaces resolving identical line text on expansion.
    fileContents = await fetchFileContents(model, {
      baseSha: tour.base_sha,
      headSha: tour.head_sha,
      cwd,
      gitShow,
    });

    // Pre-compute orphan-annotation auto-windows (issue #114). Each window
    // mirrors a `±10`-line region around an Annotation whose anchor lives in
    // Hidden context. The TUI App seeds these into the per-tour expansion
    // state at bundle load so orphan annotations resolve to inline rows
    // without user expansion.
    for (const f of files) {
      const contents = fileContents.get(f.name);
      if (!contents) continue;
      const windows = orphanSeedWindows(f, annotations, {
        oldLineCount: lineCount(contents.oldContent),
        newLineCount: lineCount(contents.newContent),
      });
      orphanWindows.push(...windows);
    }
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
    fileContents,
    orphanWindows,
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
  // Hard-fail at startup if the requested reply-agent isn't shipped, with
  // the list of available names — misconfiguration must surface up-front,
  // not at first reply (PRD #73, ADR 0012). Shipped agents are bundled in
  // the binary; there is no on-disk fallback.
  if (args.replyAgent) {
    assertShippedAgent(args.replyAgent);
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
