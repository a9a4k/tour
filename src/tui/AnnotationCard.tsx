import type { Annotation, AuthorKind } from "../core/types.js";
import { theme } from "../core/theme.js";
import { ageMs, isStale, type ReplyLock } from "../core/reply-lock.js";

interface AnnotationCardProps {
  annotation: Annotation;
  isCurrent: boolean;
  replies?: Annotation[];
  repliesCollapsed?: boolean;
  replyLock?: ReplyLock | null;
  now?: number;
  /** 1-based position in the top-level nav order. null when not in
   *  topLevel; the counter is omitted when null or when navTotal is 0. */
  navIndex?: number | null;
  navTotal?: number;
}

function rangeLabel(ann: Annotation): string {
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
  annotation: Annotation,
  replies: Annotation[] | undefined,
  lock: ReplyLock,
): boolean {
  if (lock.responding_to === annotation.id) return true;
  if (!replies) return false;
  return replies.some((r) => r.id === lock.responding_to);
}

export function AnnotationCard({
  annotation,
  isCurrent,
  replies,
  repliesCollapsed,
  replyLock,
  now,
  navIndex,
  navTotal,
}: AnnotationCardProps) {
  const visibleReplies = repliesCollapsed ? [] : replies ?? [];
  const hiddenCount = repliesCollapsed ? replies?.length ?? 0 : 0;
  const showPill =
    replyLock && pillTargetsThisCard(annotation, replies, replyLock);
  // Selection is signalled redundantly along three axes (borderStyle,
  // backgroundColor, header `●` glyph) so the cue survives palette drift,
  // colour blindness, and low-contrast displays — a single delta isn't enough.
  return (
    <box
      id={`annotation-${annotation.id}`}
      borderStyle={isCurrent ? "heavy" : "single"}
      borderColor={theme.fg.accent}
      backgroundColor={isCurrent ? theme.bg.accentCurrent.tui : theme.bg.accentSubtle.tui}
      flexDirection="column"
      paddingX={1}
    >
      <box flexDirection="row" flexWrap="wrap">
        {isCurrent ? (
          <text fg={theme.fg.accent} bold>
            {"● "}
          </text>
        ) : null}
        {navIndex != null && navTotal != null && navTotal > 0 ? (
          <text fg={theme.fg.muted} bold>
            {`${navIndex} / ${navTotal} `}
          </text>
        ) : null}
        <text fg={authorKindColor(annotation.author_kind)} bold>
          {`[${annotation.author_kind}]`}
        </text>
        <text fg={theme.fg.accent} bold>
          {` ${annotation.file}:${rangeLabel(annotation)}`}
        </text>
        {annotation.author !== annotation.author_kind ? (
          <text fg={theme.fg.accent} bold>
            {` (${annotation.author})`}
          </text>
        ) : null}
      </box>
      <box flexGrow={1}>
        <text fg={theme.fg.default} wrapMode="word">{annotation.body}</text>
      </box>
      {visibleReplies.map((r) => (
        <box
          key={r.id}
          id={`annotation-${r.id}`}
          flexDirection="column"
          marginTop={1}
          paddingLeft={2}
        >
          <box flexDirection="row" flexWrap="wrap">
            <text fg={authorKindColor(r.author_kind)} bold>
              {`[${r.author_kind}]`}
            </text>
            {r.author !== r.author_kind ? (
              <text fg={theme.fg.muted}>{` (${r.author})`}</text>
            ) : null}
          </box>
          <text fg={theme.fg.default} wrapMode="word">{r.body}</text>
        </box>
      ))}
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
