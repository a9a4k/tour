import type { Comment, AuthorKind } from "../core/types.js";
import { theme } from "../core/theme.js";
import { ageMs, isStale, type ReplyLock } from "../core/reply-lock.js";

interface CommentCardProps {
  comment: Comment;
  /** True when the cursor sits on any node of this Thread (parent or
   *  Reply, per ADR 0037). Drives the Card chrome (heavy border +
   *  accent background). The narrower within-Card active-node
   *  highlight reads from `activeNodeId`. */
  isCurrent: boolean;
  replies?: Comment[];
  repliesCollapsed?: boolean;
  replyLock?: ReplyLock | null;
  now?: number;
  /** 1-based position in the top-level nav order. null when not in
   *  topLevel; the counter is omitted when null or when navTotal is 0. */
  navIndex?: number | null;
  navTotal?: number;
  /** ADR 0037 — the specific Comment id the cursor sits on within this
   *  Thread (parent or Reply). null when `isCurrent` is false. Drives
   *  the within-Card `●` glyph + emphasis: parent header is highlighted
   *  when `activeNodeId === comment.id`; a reply is highlighted when
   *  `activeNodeId === reply.id`. */
  activeNodeId?: string | null;
}

function rangeLabel(ann: Comment): string {
  return ann.line_start === ann.line_end
    ? String(ann.line_start)
    : `${ann.line_start}-${ann.line_end}`;
}

// Author-kind cue: human entries paint accent; agent entries stay muted. Same
// rule on both surfaces (see webapp `.author-kind.human`/`.author-kind.agent`)
// so the conversation reads identically across TUI and SPA.
function authorKindColor(kind: AuthorKind): string {
  return kind === "human" ? theme.fg.accent : theme.fg.muted;
}

interface PillProps {
  lock: ReplyLock;
  now: number;
}

function ReplyPill({ lock, now }: PillProps) {
  const seconds = Math.floor(ageMs(lock, now) / 1000);
  const stale = isStale(lock, now);
  if (stale) {
    return (
      <box marginTop={1} paddingLeft={2}>
        <text fg={theme.fg.attention}>
          {`⚠️ ${lock.agent} is taking unusually long…`}
        </text>
      </box>
    );
  }
  return (
    <box marginTop={1} paddingLeft={2}>
      <text fg={theme.fg.muted}>
        {`✏️ ${lock.agent} is replying… (${seconds}s)`}
      </text>
    </box>
  );
}

function pillTargetsThisCard(
  comment: Comment,
  replies: Comment[] | undefined,
  lock: ReplyLock,
): boolean {
  if (lock.responding_to === comment.id) return true;
  if (!replies) return false;
  return replies.some((r) => r.id === lock.responding_to);
}

export function CommentCard({
  comment,
  isCurrent,
  replies,
  repliesCollapsed,
  replyLock,
  now,
  navIndex,
  navTotal,
  activeNodeId,
}: CommentCardProps) {
  const visibleReplies = repliesCollapsed ? [] : replies ?? [];
  const hiddenCount = repliesCollapsed ? replies?.length ?? 0 : 0;
  const showPill =
    replyLock && pillTargetsThisCard(comment, replies, replyLock);
  // ADR 0037 — within-Card active-node highlight. The Card chrome
  // (heavy border + accent background) still tracks `isCurrent` (any
  // node in the Thread is the cursor), but the `●` glyph and tinted
  // reply chrome narrow to the specific node the cursor points at.
  // When no `activeNodeId` is provided, fall back to the parent so
  // pre-ADR call sites read identically.
  const activeId = activeNodeId ?? (isCurrent ? comment.id : null);
  const parentActive = isCurrent && activeId === comment.id;
  // Selection is signalled redundantly along three axes (borderStyle,
  // backgroundColor, header `●` glyph) so the cue survives palette drift,
  // colour blindness, and low-contrast displays — a single delta isn't enough.
  return (
    <box
      id={`comment-${comment.id}`}
      borderStyle={isCurrent ? "heavy" : "single"}
      borderColor={theme.fg.accent}
      backgroundColor={isCurrent ? theme.bg.accentCurrent.tui : theme.bg.accentSubtle.tui}
      flexDirection="column"
      paddingX={1}
    >
      <box flexDirection="row" flexWrap="wrap">
        {parentActive ? (
          <text fg={theme.fg.accent} bold>
            {"● "}
          </text>
        ) : null}
        {navIndex != null && navTotal != null && navTotal > 0 ? (
          <text fg={theme.fg.muted} bold>
            {`${navIndex} / ${navTotal} `}
          </text>
        ) : null}
        <text fg={authorKindColor(comment.author_kind)} bold>
          {`[${comment.author_kind}]`}
        </text>
        <text fg={theme.fg.accent} bold>
          {` ${comment.file}:${rangeLabel(comment)}`}
        </text>
        {comment.author !== comment.author_kind ? (
          <text fg={theme.fg.accent} bold>
            {` (${comment.author})`}
          </text>
        ) : null}
      </box>
      <box flexGrow={1}>
        <text fg={theme.fg.default} wrapMode="word">{comment.body}</text>
      </box>
      {visibleReplies.map((r) => {
        const replyActive = isCurrent && activeId === r.id;
        return (
          <box
            key={r.id}
            id={`comment-${r.id}`}
            flexDirection="column"
            marginTop={1}
            paddingLeft={2}
            backgroundColor={replyActive ? theme.bg.accentCurrent.tui : undefined}
          >
            <box flexDirection="row" flexWrap="wrap">
              {replyActive ? (
                <text fg={theme.fg.accent} bold>
                  {"● "}
                </text>
              ) : null}
              <text fg={authorKindColor(r.author_kind)} bold>
                {`[${r.author_kind}]`}
              </text>
              {r.author !== r.author_kind ? (
                <text fg={theme.fg.muted}>{` (${r.author})`}</text>
              ) : null}
            </box>
            <text fg={theme.fg.default} wrapMode="word">{r.body}</text>
          </box>
        );
      })}
      {hiddenCount > 0 && (
        <box marginTop={1} paddingLeft={2}>
          <text fg={theme.fg.muted}>
            {`[${hiddenCount} ${hiddenCount === 1 ? "reply" : "replies"} collapsed — c to expand]`}
          </text>
        </box>
      )}
      {showPill && replyLock ? <ReplyPill lock={replyLock} now={now ?? Date.now()} /> : null}
    </box>
  );
}
