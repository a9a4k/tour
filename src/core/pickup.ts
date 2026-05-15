import { buildThreads } from "./threads.js";
import type { Comment, Tour } from "./types.js";

export interface PickupComment extends Comment {
  replies: Comment[];
}

export interface ConversationTree {
  id: string;
  title?: string;
  head_sha: string;
  base_sha: string;
  head_source: string;
  base_source: string;
  status: "open" | "closed";
  comments: PickupComment[];
}

export function buildConversationTree(
  tour: Tour,
  comments: Comment[],
): ConversationTree {
  const threads = buildThreads(comments);
  return {
    id: tour.id,
    ...(tour.title ? { title: tour.title } : {}),
    head_sha: tour.head_sha,
    base_sha: tour.base_sha,
    head_source: tour.head_source,
    base_source: tour.base_source,
    status: tour.status,
    comments: threads.map((t) => ({ ...t.root, replies: t.replies })),
  };
}
