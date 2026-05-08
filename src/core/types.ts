export interface Review {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string;
  head_sha: string;
  base_sha: string;
  head_source: string;
  base_source: string;
  worktree_snapshot: boolean;
}

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
