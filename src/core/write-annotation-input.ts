import type { Annotation, Tour } from "./types.js";
import type { TourBundle } from "./tour-bundle.js";
import type { ComposerTarget } from "./tour-session.js";
import type { ReplyLock } from "./reply-lock.js";

// The payload a TUI / CLI surface hands to its `writeAnnotation` callback.
// The top-level variant carries the live `bundle` so the validator inside
// `createAnnotation` can resolve the file + line range without a second
// disk read (PRD #140 / slice 4 #144). The reply variant carries the
// resolved parent Annotation — `createReply` re-reads `annotations.jsonl`
// to prove the parent at write time, so passing the parent here is purely
// for routing and the reply-payload shape `createReply` expects.
//
// Single source of truth, imported by both `src/cli/tui.ts` (the writer's
// implementation) and `src/tui/app.tsx` (the input's constructor). Pre-fix
// this type was declared twice — the App's copy was missing `bundle`,
// which the CLI's writer then dereferenced and crashed. Issue #254.
export type WriteAnnotationInput =
  | {
      kind: "top-level";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
      body: string;
      bundle: TourBundle;
    }
  | { kind: "reply"; parent: Annotation; body: string };

// The cross-process bridge from `src/cli/tui.ts` to `src/tui/app.tsx`.
// Co-located here so the dynamic-import cast in `src/cli/tui.ts` can't lie
// about the shape of the props the App expects — both sides import from
// this file and a divergence becomes a tsc error. `src/tui/*` is excluded
// from tsc (opentui JSX intrinsics), so a static import isn't an option;
// pinning the type to a shared module is the next-best guard. Issue #254.
export interface StartTuiProps {
  bundle: TourBundle;
  replyLock: ReplyLock | null;
  loadTour: (id: string) => Promise<TourBundle>;
  loadReplyLock: (id: string) => Promise<ReplyLock | null>;
  loadTours: () => Promise<{ tours: Tour[]; annotationCounts: Record<string, number> }>;
  writeAnnotation: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
  cwd: string;
  replyAgent?: string;
}

export type BuildWriteAnnotationInputResult =
  | { kind: "ok"; input: WriteAnnotationInput }
  | { kind: "parent-missing" };

// Pure builder for the input the surface passes to its writer. Centralised
// here so removing the bundle (or renaming it, or skipping it) from the
// top-level payload becomes a tsc error rather than a runtime TypeError at
// submit time. The App layer's intent listener calls this and routes the
// result; the surface translates `parent-missing` into a
// `composer.failed` dispatch rather than calling the writer with a stale
// target.
export function buildWriteAnnotationInput(args: {
  target: ComposerTarget;
  body: string;
  bundle: TourBundle;
  annotations: ReadonlyArray<Annotation>;
}): BuildWriteAnnotationInputResult {
  const target = args.target;
  if (target.kind === "top-level") {
    return {
      kind: "ok",
      input: {
        kind: "top-level",
        file: target.file,
        side: target.side,
        line_start: target.line_start,
        line_end: target.line_end,
        body: args.body,
        bundle: args.bundle,
      },
    };
  }
  const parent = args.annotations.find((a) => a.id === target.replies_to);
  if (!parent) return { kind: "parent-missing" };
  return {
    kind: "ok",
    input: { kind: "reply", parent, body: args.body },
  };
}
