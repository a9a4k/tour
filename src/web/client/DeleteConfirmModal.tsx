import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Comment } from "./types.js";
import {
  computeDeleteCascadeNote,
  renderDeleteCascadeNote,
} from "./delete-cascade-note.js";

// Issue #389 / ADR 0036 (Slice E). Webapp delete-confirm modal.
//
// Renders a centred modal previewing the target Comment (author kind,
// optional author token, relative age, body excerpt) and the C4 cascade
// outcome ("this reply will be removed…", "N replies will remain under
// [deleted].", "the thread will vanish."). Two buttons: Cancel
// (dismisses) and Delete (confirms).
//
// Focus trap + Esc dismissal follow the TourPicker pattern: the modal
// card holds tabIndex=-1 + .focus() on mount, the scrim's onMouseDown
// dismisses, and a keydown handler short-circuits Tab to cycle within
// the modal's focusable buttons. The Delete button autofocuses so Enter
// confirms by default.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatAge(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d ago`;
  if (ms < MONTH) return `${Math.floor(ms / WEEK)}w ago`;
  if (ms < YEAR) return `${Math.floor(ms / MONTH)}mo ago`;
  return `${Math.floor(ms / YEAR)}y ago`;
}

const BODY_EXCERPT_MAX = 240;

export function truncateBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= BODY_EXCERPT_MAX) return trimmed;
  return `${trimmed.slice(0, BODY_EXCERPT_MAX)}…`;
}

export interface DeleteConfirmModalProps {
  target: Comment;
  comments: ReadonlyArray<Comment>;
  // Wallclock for the relative-age preview. Defaults to Date.now() at
  // mount time; tests pass an explicit value for determinism.
  now?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({
  target,
  comments,
  now,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const deleteBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    deleteBtnRef.current?.focus();
  }, []);

  const note = useMemo(
    () => computeDeleteCascadeNote(target, comments),
    [target, comments],
  );
  const noteText = renderDeleteCascadeNote(note);

  const wallclock = now ?? Date.now();
  const age = formatAge(wallclock - Date.parse(target.created_at));
  const range =
    target.line_start === target.line_end
      ? `${target.line_start}`
      : `${target.line_start}-${target.line_end}`;
  const showAuthor = target.author !== target.author_kind;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        // Two focusable buttons — trap Tab inside the modal by snapping
        // to whichever isn't currently focused.
        const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onCancel],
  );

  const onScrimMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  return (
    <div
      className="delete-modal-scrim"
      role="presentation"
      onMouseDown={onScrimMouseDown}
    >
      <div
        ref={cardRef}
        className="delete-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id="delete-modal-title" className="delete-modal-title">
          Delete comment?
        </h2>
        <div className="delete-modal-preview">
          <div className="delete-modal-preview-header">
            <span className={`author-kind ${target.author_kind}`}>
              [{target.author_kind}]
            </span>
            {showAuthor ? <> {target.author} ·</> : null}{" "}
            <span className="delete-modal-location">
              {target.file}:{range}
            </span>{" "}
            <span className="delete-modal-age">({age})</span>
          </div>
          <div className="delete-modal-preview-body">
            {truncateBody(target.body)}
          </div>
        </div>
        <div className="delete-modal-cascade">{noteText}</div>
        <div className="delete-modal-actions">
          <button
            type="button"
            className="delete-modal-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            ref={deleteBtnRef}
            className="delete-modal-confirm"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
