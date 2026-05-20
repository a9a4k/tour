import { useCallback, useEffect, useRef } from "react";
import type { PickerRow } from "../../core/tour-list.js";
import {
  consumeTextSelectionDrag,
  createTextSelectionDragState,
  recordTextSelectionMouseDown,
  recordTextSelectionMouseMove,
  TEXT_SELECTABLE_CLASS,
} from "./text-selection.js";

interface TourPickerProps {
  rows: PickerRow[];
  cursor: number;
  currentTourId: string | null;
  // Move cursor by `delta` (clamped at edges). Slice-1 reducer accepts any
  // integer delta so row-hover / row-click can jump straight to the target
  // idx without a chain of ±1 dispatches.
  onMove: (delta: number) => void;
  onCommit: () => void;
  onClose: () => void;
}

// Controlled picker. Cursor + open state live in the Tour-session store
// (slice 1 of PRD #207); this component renders rows and forwards
// keymap / click events via the props it receives. The store's
// `scrollPickerRow` intent is realized in App.tsx by querying the
// `data-picker-row-idx` attribute — no per-row ref plumbing.
export function TourPicker({
  rows,
  cursor,
  currentTourId,
  onMove,
  onCommit,
  onClose,
}: TourPickerProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textSelectionDrag = useRef(createTextSelectionDragState());

  const handleSelectableMouseDown = (event: React.MouseEvent) => {
    recordTextSelectionMouseDown(textSelectionDrag.current, event.nativeEvent);
  };
  const handleSelectableMouseMove = (event: React.MouseEvent) => {
    recordTextSelectionMouseMove(textSelectionDrag.current, event.nativeEvent);
  };
  const suppressAfterTextSelectionDrag = (event: React.MouseEvent): boolean => {
    if (!consumeTextSelectionDrag(textSelectionDrag.current)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "t") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        onMove(1);
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        onMove(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onCommit();
      }
    },
    [onMove, onCommit, onClose],
  );

  const onScrimClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div
      className="picker-scrim"
      role="presentation"
      onMouseDown={onScrimClick}
    >
      <div
        ref={cardRef}
        className="picker-card"
        role="dialog"
        aria-modal="true"
        aria-label="Tour picker"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="picker-list" role="listbox">
          {rows.map((r, i) => {
            const isCurrent = r.id === currentTourId;
            const isCursor = i === cursor;
            const cls = [
              "picker-row",
              isCurrent ? "current" : "",
              isCursor ? "cursor" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={r.id}
                data-picker-row-idx={i}
                className={cls}
                role="option"
                aria-selected={isCursor}
                onMouseEnter={(event) => {
                  handleSelectableMouseMove(event);
                  if (!textSelectionDrag.current.active && event.buttons !== 1) {
                    onMove(i - cursor);
                  }
                }}
                onMouseDown={handleSelectableMouseDown}
                onMouseMove={handleSelectableMouseMove}
                onMouseUp={handleSelectableMouseMove}
                onClick={(event) => {
                  if (suppressAfterTextSelectionDrag(event)) return;
                  // Click commits the clicked row; align cursor first so the
                  // reducer's picker.commit (which reads state.picker.cursor)
                  // resolves to the clicked id.
                  if (i !== cursor) onMove(i - cursor);
                  onCommit();
                }}
              >
                <span className={`picker-glyph ${r.status}`}>{r.glyph}</span>
                <span className={`picker-age ${TEXT_SELECTABLE_CLASS}`}>
                  {r.age}
                </span>
                <span className={`picker-title ${TEXT_SELECTABLE_CLASS}`}>
                  {r.title}
                </span>
                {r.commentCount > 0 ? (
                  <span className={`badge ${TEXT_SELECTABLE_CLASS}`}>
                    {r.commentCount}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
