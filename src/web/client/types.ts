export interface Annotation {
  id: string;
  file: string;
  side: "additions" | "deletions";
  line_start: number;
  line_end: number;
  body: string;
  author: string;
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

export interface AnnotationMetadata {
  annotation: Annotation;
  isAnchor: boolean;
}
