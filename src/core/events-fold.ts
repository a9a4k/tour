import type { CommentState, TourEvent } from "./types.js";

// Pure projection from the on-disk event log to the current Comment
// state (ADR 0036). No I/O. The fold is the single place where the
// C4 cascade lives:
//
//   - A deleted leaf Reply is removed from the projection entirely.
//   - A deleted parent with ≥1 surviving Reply projects as a
//     `[deleted]` stub Comment that retains the anchor + id; surviving
//     Replies follow in their original positions.
//   - A Thread where every node (parent + every Reply) is deleted
//     vanishes from the projection entirely.
//
// Defence-in-depth: delete events whose `target_id` doesn't match any
// known comment are ignored. Duplicate deletes for the same target are
// idempotent (first delete wins for the `at` timestamp). Append order
// is truth; `at` timestamps are display metadata, not the ordering key.
// Output preserves event-append order — Thread grouping happens
// downstream in `buildThreads`.
export function foldEventsToComments(events: TourEvent[]): CommentState[] {
  const created: Map<string, CommentState> = new Map();
  const deletions: Map<string, string> = new Map();
  const order: string[] = [];

  for (const ev of events) {
    if (ev.kind === "comment.created") {
      if (created.has(ev.id)) continue;
      created.set(ev.id, {
        id: ev.id,
        file: ev.file,
        side: ev.side,
        line_start: ev.line_start,
        line_end: ev.line_end,
        body: ev.body,
        author: ev.author,
        author_kind: ev.author_kind,
        created_at: ev.at,
      });
      order.push(ev.id);
    } else if (ev.kind === "reply.created") {
      if (created.has(ev.id)) continue;
      // Anchor inheritance is deferred until after every event is
      // processed — the parent may not be known at this point in the
      // stream (append order is truth, but the event stream is not
      // guaranteed to be DAG-ordered).
      created.set(ev.id, {
        id: ev.id,
        file: "",
        side: "additions",
        line_start: 0,
        line_end: 0,
        body: ev.body,
        author: ev.author,
        author_kind: ev.author_kind,
        replies_to: ev.replies_to,
        created_at: ev.at,
      });
      order.push(ev.id);
    } else if (ev.kind === "comment.deleted") {
      if (!deletions.has(ev.target_id)) deletions.set(ev.target_id, ev.at);
    }
  }

  // Resolve reply anchors against the final created set.
  for (const id of order) {
    const c = created.get(id);
    if (!c || c.replies_to === undefined) continue;
    const parent = created.get(c.replies_to);
    if (!parent) continue;
    c.file = parent.file;
    c.side = parent.side;
    c.line_start = parent.line_start;
    c.line_end = parent.line_end;
  }

  // Stamp deletions on known comments; ignore deletes targeting unknown ids.
  for (const [target, at] of deletions) {
    const c = created.get(target);
    if (!c) continue;
    c.deleted = { at };
  }

  // Parents with at least one surviving reply — the cascade emits a
  // `[deleted]` stub for these on parent-deletion; parents with no
  // surviving replies vanish with their (now-empty) Thread.
  const parentsWithSurvivingReplies = new Set<string>();
  for (const id of order) {
    const c = created.get(id);
    if (!c || c.replies_to === undefined || c.deleted) continue;
    parentsWithSurvivingReplies.add(c.replies_to);
  }

  const out: CommentState[] = [];
  for (const id of order) {
    const c = created.get(id);
    if (!c) continue;
    if (c.replies_to !== undefined) {
      // Reply: emit iff not deleted.
      if (c.deleted) continue;
      out.push(c);
    } else {
      // Top-level: emit as-is, or as a `[deleted]` stub, or skip when
      // the whole Thread has been retracted.
      if (c.deleted) {
        if (!parentsWithSurvivingReplies.has(c.id)) continue;
        out.push({ ...c, body: "" });
      } else {
        out.push(c);
      }
    }
  }

  return out;
}
