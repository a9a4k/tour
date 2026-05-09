import { useCallback, useEffect, useRef, useState } from "react";
import type { PickerRow } from "../../core/tour-list.js";

interface TourPickerProps {
  rows: PickerRow[];
  currentTourId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function initialCursor(rows: PickerRow[], currentTourId: string | null): number {
  if (rows.length === 0) return 0;
  const idx = rows.findIndex((r) => r.id !== currentTourId);
  return idx === -1 ? 0 : idx;
}

export function TourPicker({
  rows,
  currentTourId,
  onSelect,
  onClose,
}: TourPickerProps): React.JSX.Element {
  const [cursor, setCursor] = useState<number>(() => initialCursor(rows, currentTourId));
  const cardRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const commit = useCallback(
    (idx: number) => {
      const r = rows[idx];
      if (!r) return;
      onSelect(r.id);
    },
    [rows, onSelect],
  );

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
        setCursor((c) => Math.min(rows.length - 1, c + 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commit(cursor);
      }
    },
    [rows.length, cursor, commit, onClose],
  );

  useEffect(() => {
    const el = rowRefs.current.get(cursor);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

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
              <button
                key={r.id}
                type="button"
                ref={(el) => {
                  if (el) rowRefs.current.set(i, el);
                  else rowRefs.current.delete(i);
                }}
                className={cls}
                role="option"
                aria-selected={isCursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(i)}
              >
                <span className={`picker-glyph ${r.status}`}>{r.glyph}</span>
                <span className="picker-age">{r.age}</span>
                <span className="picker-title">{r.title}</span>
                {r.annotationCount > 0 ? (
                  <span className="badge">{r.annotationCount}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
