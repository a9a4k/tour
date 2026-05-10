import type { Annotation } from "./types.js";

export interface Thread {
  root: Annotation;
  replies: Annotation[];
}

function compareAnnotations(a: Annotation, b: Annotation): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// Walk the replies_to chain up to the top-level annotation. Returns null if
// the chain hits an unknown id (orphan) or a cycle (malformed input).
function findRoot(start: Annotation, byId: Map<string, Annotation>): Annotation | null {
  let cur = start;
  const seen = new Set<string>([cur.id]);
  while (cur.replies_to !== undefined) {
    const parent = byId.get(cur.replies_to);
    if (!parent) return null;
    if (seen.has(parent.id)) return null;
    seen.add(parent.id);
    cur = parent;
  }
  return cur;
}

export function buildThreads(annotations: Annotation[]): Thread[] {
  const byId = new Map<string, Annotation>();
  for (const a of annotations) byId.set(a.id, a);

  const threadsByRootId = new Map<string, Thread>();
  for (const a of annotations) {
    if (a.replies_to === undefined) {
      threadsByRootId.set(a.id, { root: a, replies: [] });
    }
  }

  for (const a of annotations) {
    if (a.replies_to === undefined) continue;
    const root = findRoot(a, byId);
    if (!root) continue;
    const t = threadsByRootId.get(root.id);
    if (!t) continue;
    t.replies.push(a);
  }

  for (const t of threadsByRootId.values()) {
    t.replies.sort(compareAnnotations);
  }

  return [...threadsByRootId.values()].sort((a, b) =>
    compareAnnotations(a.root, b.root),
  );
}

export function isTopLevel(a: Annotation): boolean {
  return a.replies_to === undefined;
}

export function topLevelAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations.filter(isTopLevel);
}
