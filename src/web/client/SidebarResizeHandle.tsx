import React, { useCallback, useRef } from "react";

interface SidebarResizeHandleProps {
  /** Current sidebar width in px. Used as the drag-start baseline. */
  width: number;
  /**
   * Called per `pointermove` frame with the next width (caller clamps).
   * Caller is responsible for applying preserveScreenY before / after
   * the width change — the handle just emits the raw drag math.
   */
  onResize: (next: number) => void;
  /** Called once at drag start. Lets the caller capture a screen-Y snapshot. */
  onResizeStart?: () => void;
  /** Called once at drag end (pointerup / lostpointercapture). */
  onResizeEnd?: () => void;
}

// Issue #323: thin vertical drag-resize strip on the sidebar's right
// edge. The grab area is 8 px wide (positive ergonomics under
// mouse / trackpad); the visible chrome is a single accent line on
// hover. `setPointerCapture` lets the user drag past the window edge
// without losing the drag — the same idiom used by every native
// resize gutter (VS Code, GitHub PR-diff, Figma).
export function SidebarResizeHandle({
  width,
  onResize,
  onResizeStart,
  onResizeEnd,
}: SidebarResizeHandleProps): React.JSX.Element {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Left mouse button only; ignore right-click / middle-click so the
      // browser's native context menu / autoscroll keep working.
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      e.currentTarget.setPointerCapture(e.pointerId);
      onResizeStart?.();
    },
    [width, onResizeStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      onResize(drag.startWidth + dx);
    },
    [onResize],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      // releasePointerCapture is a no-op when not held; safe either way.
      e.currentTarget.releasePointerCapture(e.pointerId);
      onResizeEnd?.();
    },
    [onResizeEnd],
  );

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    />
  );
}
