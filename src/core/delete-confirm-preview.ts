import type { Comment, CommentState } from "./types.js";
import type { Thread } from "./threads.js";
import type { DeleteCascade } from "./delete-cascade.js";
export { renderDeleteCascade as cascadeNote } from "./delete-cascade.js";
export type { DeleteCascade } from "./delete-cascade.js";

// Pure projection from `(targetId, threads)` to the data the delete-confirm
// modal renders (ADR 0036 Slice D / issue #388). Decoupled from the
// renderer so the cascade rules — the only piece with real product logic
// — can be unit-tested without an OpenTUI fixture. The outcome union and
// the rendered string both live in `core/delete-cascade.ts` so the TUI
// and webapp share wording verbatim; only the input-shape adapter — this
// `cascadeFor` over `Thread[]` — is TUI-local.

// `cascadeFor` classifies the delete's downstream effect on the C4
// projection. The rules mirror `events-fold.ts`:
//   - reply leaf  → "this reply will be removed from the thread."
//   - parent with surviving replies → "N replies will remain under [deleted]"
//   - any node that, once deleted, leaves the thread fully retracted →
//     "the thread will vanish."
// The third case subsumes both (a) a parent with no replies and (b) a
// reply that is the only live descendant of an already-`[deleted]`-stub
// parent — both retract the whole Thread.
export function cascadeFor(
  target: Comment,
  threads: ReadonlyArray<Thread>,
): DeleteCascade {
  if (target.thread_id !== undefined) {
    // Reply target. Find its parent Thread. If the parent is deleted
    // AND no other live reply survives the removal, the Thread vanishes.
    const thread = threads.find((t) => t.root.id === target.thread_id);
    if (!thread) return { kind: "reply-only" };
    // The fold removes a deleted leaf Reply from the projection, but the
    // modal previews the *next* projection — `target` is still in
    // `thread.replies` here. Count siblings excluding `target` itself.
    const otherLiveReplies = thread.replies.filter((r) => r.id !== target.id);
    const parentIsLive = !isDeletedStub(thread.root);
    if (otherLiveReplies.length === 0 && !parentIsLive) {
      return { kind: "thread-vanishes" };
    }
    return { kind: "reply-only" };
  }
  // Parent target. Live replies under this parent surface as `[deleted]`
  // stub + N replies; zero live replies retracts the Thread.
  const thread = threads.find((t) => t.root.id === target.id);
  const liveReplies = thread ? thread.replies : [];
  if (liveReplies.length === 0) return { kind: "thread-vanishes" };
  return { kind: "parent-stub", survivorCount: liveReplies.length };
}

// The projection's `[deleted]` stub: a parent comment with an empty body
// and a `deleted` stamp (set by the fold). Reply nodes never project as
// stubs — they either survive or vanish. `Thread.root` is typed `Comment`
// but at runtime carries `CommentState` (the comments-store now returns
// the projected shape) — the cast just narrows to the projection field.
function isDeletedStub(c: Comment): boolean {
  return (c as CommentState).deleted !== undefined;
}

// Truncate the body to a reasonable fixed length for the modal preview.
// Mirrors the yank-preview ceiling (60) — long enough to identify the
// Comment, short enough to keep the modal compact on narrow terminals.
const BODY_EXCERPT_MAX = 120;

export function bodyExcerpt(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= BODY_EXCERPT_MAX) return oneLine;
  return `${oneLine.slice(0, BODY_EXCERPT_MAX)}…`;
}

// Relative-age formatter — copied shape from `core/tour-list.ts`'s
// `formatAge`. Pulled inline rather than imported so the helper stays
// self-contained (Tour-list's `formatAge` is not exported, and exposing
// it would widen its surface for the wrong reason).
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeAge(createdAt: string, now: number): string {
  const delta = Math.max(0, now - Date.parse(createdAt));
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`;
  if (delta < MONTH) return `${Math.floor(delta / WEEK)}w ago`;
  if (delta < YEAR) return `${Math.floor(delta / MONTH)}mo ago`;
  return `${Math.floor(delta / YEAR)}y ago`;
}
