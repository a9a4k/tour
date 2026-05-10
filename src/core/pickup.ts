import { buildThreads } from "./threads.js";
import type { Annotation, Tour } from "./types.js";

export interface PickupAnnotation extends Annotation {
  replies: Annotation[];
}

export interface ConversationTree {
  id: string;
  title?: string;
  head_sha: string;
  base_sha: string;
  head_source: string;
  base_source: string;
  status: "open" | "closed";
  annotations: PickupAnnotation[];
}

export function buildConversationTree(
  tour: Tour,
  annotations: Annotation[],
): ConversationTree {
  const threads = buildThreads(annotations);
  const out: ConversationTree = {
    id: tour.id,
    ...(tour.title ? { title: tour.title } : {}),
    head_sha: tour.head_sha,
    base_sha: tour.base_sha,
    head_source: tour.head_source,
    base_source: tour.base_source,
    status: tour.status,
    annotations: threads.map((t) => ({ ...t.root, replies: t.replies })),
  };
  return out;
}
