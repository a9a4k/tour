import type { Annotation } from "../core/types.js";

export interface TopLevelAnchor {
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
}

export type ComposerState =
  | { kind: "top-level"; file: string; side: "additions" | "deletions"; line_start: number; line_end: number }
  | { kind: "reply"; parent: Annotation };

export function buildTopLevelComposer(args: {
  currentAnnotation: Annotation | null;
  fallback: TopLevelAnchor | null;
}): ComposerState | null {
  const a = args.currentAnnotation;
  if (a) {
    return {
      kind: "top-level",
      file: a.file,
      side: a.side,
      line_start: a.line_start,
      line_end: a.line_end,
    };
  }
  if (args.fallback) {
    return { kind: "top-level", ...args.fallback };
  }
  return null;
}

export function buildReplyComposer(args: {
  currentAnnotation: Annotation | null;
}): ComposerState | null {
  if (!args.currentAnnotation) return null;
  return { kind: "reply", parent: args.currentAnnotation };
}
