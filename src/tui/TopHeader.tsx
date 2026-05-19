import type { Tour } from "../core/types.js";
import type { DiffStats } from "../core/diff-stats.js";
import { headerSourcePair } from "../core/header-source-pair.js";
import { theme } from "../core/theme.js";
import { HamburgerButtonTui } from "./HamburgerButton.js";

interface TopHeaderTuiProps {
  tour: Tour;
  layout: "split" | "unified";
  currentCommentIdx: number;
  topLevelTotal: number;
  // Tour-level additions / deletions summed across the bundle (issue #266
  // / webapp parity #233). Zero totals render no indicator. Pure-addition
  // / pure-deletion tours render only the non-zero side.
  tourStats: DiffStats;
  sidebarVisible: boolean;
  onToggleSidebarVisibility: () => void;
  onOpenPicker: () => void;
  onPrevComment: () => void;
  onNextComment: () => void;
  onSplit: () => void;
  onUnified: () => void;
}

// Single-line header per parent PRD #91 / #93. Two flex children inside
// the row — left cluster (hamburger + title + sources) anchored to the
// left edge, right cluster (tour-level diff stats + comment-nav pill +
// layout toggle, in that reading order per issue #277) pushed right via
// marginLeft="auto". `flexWrap="wrap"` is a safety net for sub-100-col
// terminals where the row itself can't fit. Title and sources clip with
// truncate + maxWidth so a long title can never push controls off-screen.
//
// The Tour short-id is intentionally omitted (disambiguation lives in the
// Tour picker and `tour list`).
export function TopHeaderTui(props: TopHeaderTuiProps) {
  const {
    tour,
    layout,
    currentCommentIdx,
    topLevelTotal,
    tourStats,
    sidebarVisible,
    onToggleSidebarVisibility,
    onOpenPicker,
    onPrevComment,
    onNextComment,
    onSplit,
    onUnified,
  } = props;
  return (
    <box width="100%" flexDirection="row" flexWrap="wrap" paddingX={1}>
      <box flexDirection="row" alignItems="center" flexShrink={1}>
        <SidebarVisibilityButtonTui
          visible={sidebarVisible}
          onToggle={onToggleSidebarVisibility}
        />
        <HamburgerButtonTui onOpen={onOpenPicker} />
        <box flexDirection="row" alignItems="center" paddingX={1} flexShrink={1}>
          <text
            bold
            fg={tour.title ? theme.fg.default : theme.fg.muted}
            truncate
            maxWidth={60}
          >
            {tour.title || "(untitled)"}
          </text>
          <text
            fg={theme.fg.muted}
            truncate
            maxWidth={60}
          >
            {`  ${headerSourcePair(tour)}`}
          </text>
        </box>
      </box>
      <box flexDirection="row" alignItems="center" marginLeft="auto">
        <TourStatsIndicatorTui
          additions={tourStats.additions}
          deletions={tourStats.deletions}
        />
        <SequencePillTui
          idx={currentCommentIdx}
          total={topLevelTotal}
          onPrev={onPrevComment}
          onNext={onNextComment}
        />
        <box width={1} />
        <LayoutToggleTui layout={layout} onSplit={onSplit} onUnified={onUnified} />
      </box>
    </box>
  );
}

interface SidebarVisibilityButtonTuiProps {
  visible: boolean;
  onToggle: () => void;
}

function SidebarVisibilityButtonTui({ visible, onToggle }: SidebarVisibilityButtonTuiProps) {
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text fg={theme.fg.default} onMouseDown={onToggle}>
        {visible ? "⇤" : "⇥"}
      </text>
      <text fg={theme.fg.muted}>{"]"}</text>
    </box>
  );
}

interface LayoutToggleTuiProps {
  layout: "split" | "unified";
  onSplit: () => void;
  onUnified: () => void;
}

function LayoutToggleTui({ layout, onSplit, onUnified }: LayoutToggleTuiProps) {
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text
        fg={layout === "split" ? theme.fg.accent : theme.fg.muted}
        bold={layout === "split"}
        onMouseDown={onSplit}
      >
        {"Split"}
      </text>
      <text fg={theme.fg.muted}>{" | "}</text>
      <text
        fg={layout === "unified" ? theme.fg.accent : theme.fg.muted}
        bold={layout === "unified"}
        onMouseDown={onUnified}
      >
        {"Unified"}
      </text>
      <text fg={theme.fg.muted}>{"]"}</text>
    </box>
  );
}

interface SequencePillTuiProps {
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

interface TourStatsIndicatorTuiProps {
  additions: number;
  deletions: number;
}

// Tour-level (PR-equivalent) `+N -M` diff-stats indicator (issue #266 /
// webapp parity #233). Display-only; no click handler. Sides are
// independently omitted when their count is zero — a pure-addition /
// pure-deletion tour renders only the non-zero side. Renders nothing
// when both counts are zero (a degenerate empty-diff tour would otherwise
// pay a `+0 -0` cost for no signal). Text-only by design; no proportion
// bar — the TUI is text-only anyway and the count itself carries the
// signal. A trailing single-column spacer keeps a gap from the
// SequencePill's `[` that immediately follows (issue #277 reorder placed
// the indicator at the leading edge of the right cluster).
function TourStatsIndicatorTui({ additions, deletions }: TourStatsIndicatorTuiProps) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <box flexDirection="row">
      {additions > 0 ? <text fg={theme.fg.success}>{`+${additions}`}</text> : null}
      {additions > 0 && deletions > 0 ? <text>{" "}</text> : null}
      {deletions > 0 ? <text fg={theme.fg.danger}>{`-${deletions}`}</text> : null}
      <box width={1} />
    </box>
  );
}

function SequencePillTui({ idx, total, onPrev, onNext }: SequencePillTuiProps) {
  if (total === 0) return null;
  // PRD #192 / ADR 0022: idx === -1 means the unified cursor is NOT on a
  // card (row anchor or null cursor). The pill renders `—/M` and keeps
  // the prev/next arrows live — pressing either advances onto the first
  // card via the card-lane walker.
  const onCard = idx >= 0;
  const prevDisabled = onCard && idx <= 0;
  const nextDisabled = onCard && idx >= total - 1;
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text
        fg={prevDisabled ? theme.fg.subtle : theme.fg.default}
        onMouseDown={prevDisabled ? undefined : onPrev}
      >
        {"←"}
      </text>
      <text fg={theme.fg.default}>{onCard ? ` ${idx + 1}/${total} ` : ` —/${total} `}</text>
      <text
        fg={nextDisabled ? theme.fg.subtle : theme.fg.default}
        onMouseDown={nextDisabled ? undefined : onNext}
      >
        {"→"}
      </text>
      <text fg={theme.fg.muted}>{"]"}</text>
    </box>
  );
}
