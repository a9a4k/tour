import type { TourBundle, BundleFile } from "../../core/tour-bundle.js";

export type AuthorKind = "agent" | "human";

export interface Annotation {
  id: string;
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author: string;
  author_kind: AuthorKind;
  replies_to?: string;
  created_at: string;
}

export interface FileClassification {
  collapsed: boolean;
  reason?: string;
}

// Re-export the bundle types from core so the webapp client speaks the
// same vocabulary as the server (PRD #135). The bundle is a JSON-friendly
// discriminated union — the wire format is the value `loadTourBundle`
// returns, no translation layer.
export type { TourBundle, BundleFile };

export interface TourSummary {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
}

/**
 * Per-line metadata threaded through Pierre's `lineAnnotations`. A
 * tagged union so the same render slot can host an existing Annotation's
 * card OR an inline composer for a new top-level Annotation at a
 * specific line.
 */
export type AnnotationMetadata =
  | { kind: "annotation"; annotation: Annotation; isAnchor: boolean }
  | {
      kind: "composer";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
    };
