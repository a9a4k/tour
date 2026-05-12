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

// The human Annotation that should carry the webapp "Send to {agent}"
// button in a Thread, or null when no Send button should appear anywhere
// (issue #190, PRD #181). At most one Send per Thread.
//
// Rule: the latest Annotation in the Thread (by `created_at`, id
// ascending tiebreak — matching `buildThreads`) is always a leaf in a
// well-formed tree (its parent must have an earlier or equal
// `created_at`). So "latest human leaf" collapses to "latest overall,
// if human; otherwise null". If the latest turn is agent-authored, the
// user is expected to write a human Reply first — which then becomes
// the new latest leaf and surfaces the Send button.
//
// Pure thread-level computation; `canSendToAgent` stays a pure
// per-Annotation predicate, and the gating lives at the render site.
export function latestHumanLeafId(
  topLevel: Annotation,
  descendants: Annotation[],
): string | null {
  let latest: Annotation = topLevel;
  for (const a of descendants) {
    if (compareAnnotations(a, latest) > 0) latest = a;
  }
  return latest.author_kind === "human" ? latest.id : null;
}

export function topLevelAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations.filter(isTopLevel);
}
