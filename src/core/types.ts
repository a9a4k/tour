export interface Tour {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string;
  head_sha: string;
  base_sha: string;
  head_source: string;
  base_source: string;
  wip_snapshot: boolean;
}

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
  replies_to?: string;
  created_at: string;
}
