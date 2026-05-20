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
  /** PRD #397 / ADR 0038. When true, the Card collapses to a single
   *  one-liner row (chevron + author kind + file:line + first 60 chars
   *  of the parent body + `💬 N` reply count). The in-flight reply pill
   *  still renders below the one-liner so the user keeps the honest
   *  signal even after hiding the Thread. */
  collapsed?: boolean;
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
  /** PRD #397 / ADR 0038. Mouse-click toggle for the header chevron —
   *  `▾` when expanded, `▸` when collapsed. The callback is invoked
   *  with the parent Comment id; the App-side handler dispatches
   *  `thread.toggle`. The chevron is rendered on the top-level header
   *  only (Reply nodes get no chevron), so the id is always a Thread
   *  root — no `threadRootIdOf` normalisation needed at the callback
   *  site. Omitted in unit-test mounts that don't wire the callback
   *  path; the chevron renders as plain text in that case. */
  onToggleCollapse?: (commentId: string) => void;
}

// PRD #397 / ADR 0038 — body preview cap on the collapsed one-liner.
// Matches the GitHub minimize-comment preview length. Newlines fold to
// spaces so the one-liner never wraps mid-collapse; trailing ellipsis
// signals truncation when the body is longer.
const COLLAPSED_PREVIEW_MAX = 60;

function collapsedBodyPreview(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= COLLAPSED_PREVIEW_MAX) return oneLine;
  return `${oneLine.slice(0, COLLAPSED_PREVIEW_MAX - 1)}…`;
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
  // Issue #390 / ADR 0021 addendum: name the worker role so the cue
  // matches the header chip — the in-flight worker is the separate-
  // session peer, not the user's current chat.
  if (stale) {
    return (
      <box marginTop={1} paddingLeft={2}>
        <text fg={theme.fg.attention}>
          {`⚠️ Reply agent (${lock.agent}) is taking unusually long…`}
        </text>
      </box>
    );
  }
  return (
    <box marginTop={1} paddingLeft={2}>
      <text fg={theme.fg.muted}>
        {`✏️ Reply agent (${lock.agent}) is replying… (${seconds}s)`}
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
  collapsed,
  replyLock,
  now,
  navIndex,
  navTotal,
  activeNodeId,
  onToggleCollapse,
}: CommentCardProps) {
  const visibleReplies = collapsed ? [] : replies ?? [];
  const showPill =
    replyLock && pillTargetsThisCard(comment, replies, replyLock);
  // PRD #397 / ADR 0038 — collapsed one-liner. Watcher-delivered lock
  // pills still render below the one-liner ("honest signal over tidy
  // hiding"). `💬 N` counts every live Reply under the projection so
  // `[deleted]` stubs still tick the count (the Thread still has
  // nodes).
  if (collapsed) {
    const replyCount = replies?.length ?? 0;
    const preview = collapsedBodyPreview(comment.body);
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
          {isCurrent ? (
            <text fg={theme.fg.accent} bold selectable={false}>{"● "}</text>
          ) : null}
          {onToggleCollapse ? (
            <box onMouseDown={() => onToggleCollapse(comment.id)}>
              <text fg={theme.fg.muted} selectable={false}>{"▸ "}</text>
            </box>
          ) : (
            <text fg={theme.fg.muted} selectable={false}>{"▸ "}</text>
          )}
          {navIndex != null && navTotal != null && navTotal > 0 ? (
            <text fg={theme.fg.muted} bold>{`${navIndex} / ${navTotal} `}</text>
          ) : null}
          <text fg={authorKindColor(comment.author_kind)} bold>
            {`[${comment.author_kind}]`}
          </text>
          <text fg={theme.fg.accent} bold>{` ${comment.file}:${rangeLabel(comment)}`}</text>
          <text fg={theme.fg.muted}>{`  "${preview}"`}</text>
          {replyCount > 0 ? (
            <text fg={theme.fg.muted}>{`  💬 ${replyCount}`}</text>
          ) : null}
        </box>
        {showPill && replyLock ? <ReplyPill lock={replyLock} now={now ?? Date.now()} /> : null}
      </box>
    );
  }
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
          <text fg={theme.fg.accent} bold selectable={false}>
            {"● "}
          </text>
        ) : null}
        {onToggleCollapse ? (
          <box onMouseDown={() => onToggleCollapse(comment.id)}>
            <text fg={theme.fg.muted} selectable={false}>{"▾ "}</text>
          </box>
        ) : (
          <text fg={theme.fg.muted} selectable={false}>{"▾ "}</text>
        )}
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
                <text fg={theme.fg.accent} bold selectable={false}>
                  {"● "}
                </text>
              ) : null}
              <text fg={authorKindColor(r.author_kind)} bold>
                {`[${r.author_kind}]`}
              </text>
              {r.author !== r.author_kind ? (
                <text fg={theme.fg.muted}>{` (${r.author})`}</text>
              ) : null}
              {r.author_kind === "agent" && r.replies_to ? (
                // Issue #390 / ADR 0021 addendum: reply-agent replies are
                // produced by the dispatch path's `createReply` (always
                // `author_kind: "agent"` + `replies_to`). Mark them with
                // a visible role suffix so the reply-agent reads as a
                // distinct participant from the user's current chat.
                <text fg={theme.fg.muted}>{` · reply-agent`}</text>
              ) : null}
            </box>
            <text fg={theme.fg.default} wrapMode="word">{r.body}</text>
          </box>
        );
      })}
      {showPill && replyLock ? <ReplyPill lock={replyLock} now={now ?? Date.now()} /> : null}
    </box>
  );
}
