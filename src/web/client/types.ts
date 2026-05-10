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

export interface DiffFileInfo {
  name: string;
  prevName?: string;
  type: string;
  hunks: { content: { type: "context" | "addition" | "deletion" | "change" }[] }[];
  classification?: FileClassification;
  oldContent?: string;
  newContent?: string;
}

export interface TourSummary {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
}

export interface TourData {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
  base_sha: string;
  head_sha: string;
  base_source: string;
  head_source: string;
  annotations: Annotation[];
  diff: string;
  diffModel: { files: DiffFileInfo[] };
  snapshotLost: boolean;
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
