import type { Tour } from "../core/types.js";
import { theme } from "../core/theme.js";
import { HamburgerButtonTui } from "./HamburgerButton.js";

interface TopHeaderTuiProps {
  tour: Tour;
  layout: "split" | "unified";
  currentAnnotationIdx: number;
  topLevelTotal: number;
  // Full untruncated path of the row currently selected in the sidebar.
  // Surfaces information that the sidebar's middle-truncation may have
  // chipped away (issue #156). Renders nothing when undefined or empty.
  selectedPath?: string;
  onOpenPicker: () => void;
  onPrevAnnotation: () => void;
  onNextAnnotation: () => void;
  onSplit: () => void;
  onUnified: () => void;
}

// Single-line header per parent PRD #91 / #93. Two flex children — left
// cluster (hamburger + title + sources) anchored to the left edge, right
// cluster (pill + layout toggle) pushed right via marginLeft="auto". The
// outer box uses flexWrap so an 80-col terminal naturally drops the right
// cluster to row 2 (still right-aligned). Title and sources clip with
// truncate + maxWidth so a long title can never push controls off-screen.
// The Tour short-id is intentionally omitted (disambiguation lives in the
// Tour picker and `tour list`).
export function TopHeaderTui(props: TopHeaderTuiProps) {
  const {
    tour,
    layout,
    currentAnnotationIdx,
    topLevelTotal,
    selectedPath,
    onOpenPicker,
    onPrevAnnotation,
    onNextAnnotation,
    onSplit,
    onUnified,
  } = props;
  return (
    <box width="100%" flexDirection="row" flexWrap="wrap" paddingX={1}>
      <box flexDirection="row" alignItems="center" flexShrink={1}>
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
            {`  ${tour.base_source} ← ${tour.head_source}`}
          </text>
          {selectedPath ? (
            <text fg={theme.fg.muted} truncate maxWidth={80}>
              {`  · ${selectedPath}`}
            </text>
          ) : null}
        </box>
      </box>
      <box flexDirection="row" alignItems="center" marginLeft="auto">
        <SequencePillTui
          idx={currentAnnotationIdx}
          total={topLevelTotal}
          onPrev={onPrevAnnotation}
          onNext={onNextAnnotation}
        />
        <box width={1} />
        <LayoutToggleTui layout={layout} onSplit={onSplit} onUnified={onUnified} />
      </box>
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

function SequencePillTui({ idx, total, onPrev, onNext }: SequencePillTuiProps) {
  if (total === 0) return null;
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= total - 1;
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text
        fg={prevDisabled ? theme.fg.subtle : theme.fg.default}
        onMouseDown={prevDisabled ? undefined : onPrev}
      >
        {"←"}
      </text>
      <text fg={theme.fg.default}>{` ${idx + 1}/${total} `}</text>
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
