import { listTours, resolveIdPrefix } from "../core/tour-store.js";
import {
  createComment,
  createReply,
  readComments,
} from "../core/comments-store.js";
import { assertShippedAgent } from "../agents/index.js";
import { readReplyLock } from "../core/reply-lock.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import type {
  StartTuiProps,
  WriteCommentInput,
} from "../core/write-comment-input.js";

interface TuiArgs {
  tourId?: string;
  cwd: string;
  replyAgent?: string;
}

// Re-export so the single source-of-truth import path stays `src/cli/tui.js`
// for downstream callers that don't reach across into `src/core/*` directly.
export type { WriteCommentInput };

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

  const initialBundle = await loadTourBundle(args.cwd, tourId);
  const initialReplyLock = await readReplyLock(args.cwd, tourId);

  // Static-string specifier so Bun --compile embeds the TUI module; cast hides
  // the path from tsc since src/tui is excluded (JSX). The cast's TYPES are
  // sourced from `core/write-comment-input.ts` so the cast can't lie about
  // the props shape — pre-fix the cast inlined an `input: WriteCommentInput`
  // signature that diverged from the App's local copy (top-level missing
  // `bundle`), and the writer crashed at runtime when `input.bundle` came
  // through `undefined`. Issue #254.
  const { startTui } = (await import("../tui/app.js" as string)) as {
    startTui: (props: StartTuiProps) => Promise<void>;
  };
  await startTui({
    bundle: initialBundle,
    replyLock: initialReplyLock,
    loadTour: (id) => loadTourBundle(args.cwd, id),
    loadReplyLock: (id) => readReplyLock(args.cwd, id),
    writeComment: (id, input) => {
      if (input.kind === "reply") {
        return createReply(args.cwd, id, {
          replies_to: input.parent.id,
          body: input.body,
          author_kind: "human",
        });
      }
      // The bundle the App is currently rendering is the source of truth
      // for anchor validation — no second bundle load on the TUI write
      // path (PRD #140 / slice 4 #144).
      return createComment(
        args.cwd,
        id,
        {
          file: input.file,
          side: input.side,
          line_start: input.line_start,
          line_end: input.line_end,
          body: input.body,
          author_kind: "human",
        },
        input.bundle,
      );
    },
    loadTours: async () => {
      const tours = await listTours(args.cwd, { status: "all" });
      const counts: Record<string, number> = {};
      await Promise.all(
        tours.map(async (t) => {
          try {
            const ann = await readComments(args.cwd, t.id);
            counts[t.id] = ann.length;
          } catch {
            counts[t.id] = 0;
          }
        }),
      );
      return { tours, commentCounts: counts };
    },
    cwd: args.cwd,
    replyAgent: args.replyAgent,
  });
}
