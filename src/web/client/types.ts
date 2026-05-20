import type { TourBundle, BundleFile } from "../../core/tour-bundle.js";

export type AuthorKind = "agent" | "human";

export interface Comment {
  id: string;
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author: string;
  author_kind: AuthorKind;
  thread_id?: string;
  created_at: string;
  // Issue #389 / ADR 0036 (Slice E): the C4 cascade stamps `deleted`
  // on a parent comment when its body is gone but ≥1 reply survives.
  // The bundle's `comments` array carries the field through verbatim
  // from `readComments`'s `CommentState[]` projection. Fully-deleted
  // threads and leaf-deleted replies are absent from the array
  // entirely; this field only appears on `[deleted]` parent stubs.
  deleted?: { at: string };
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
 * Per-line metadata threaded through Pierre's `lineComments`. A
 * tagged union so the same render slot can host an existing Comment's
 * card OR an inline composer for a new top-level Comment at a
 * specific line.
 */
export type CommentMetadata =
  | { kind: "comment"; comment: Comment; isAnchor: boolean }
  | {
      kind: "composer";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
    };
