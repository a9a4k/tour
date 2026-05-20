import type { Comment } from "../core/types.js";
import type { DeleteConfirmSlice } from "../core/tour-session.js";
import { theme } from "../core/theme.js";
import { shortId } from "../core/ids.js";
import {
  bodyExcerpt,
  cascadeFor,
  cascadeNote,
  formatRelativeAge,
} from "../core/delete-confirm-preview.js";
import type { Thread } from "../core/threads.js";

interface DeleteConfirmModalProps {
  state: Exclude<DeleteConfirmSlice, { kind: "closed" }>;
  target: Comment | null;
  threads: ReadonlyArray<Thread>;
  now: number;
}

function rangeLabel(line_start: number, line_end: number): string {
  return line_start === line_end ? String(line_start) : `${line_start}-${line_end}`;
}

function contextLabel(target: Comment | null): string {
  if (!target) return " Delete comment ";
  const id = shortId(target.id);
  return ` Delete #${id} · ${target.file}:${rangeLabel(target.line_start, target.line_end)} (${target.side}) `;
}

function hintText(state: DeleteConfirmModalProps["state"]): string {
  if (state.kind === "submitting") return " Deleting…  ·  Esc: cancel ";
  if (state.kind === "errored") {
    return ` Error: ${state.error}  ·  Enter: retry  ·  Esc: dismiss `;
  }
  return " Enter: confirm  ·  Esc: cancel ";
}

export function DeleteConfirmModal({
  state,
  target,
  threads,
  now,
}: DeleteConfirmModalProps) {
  const borderColor =
    state.kind === "errored" ? theme.fg.muted : theme.border.accent;
  // Defensive null fallback — the App-shell only renders the modal when
  // the state is non-closed, but the bundle's comment list can lag a
  // watcher reload by one render. A null target paints a thin "target
  // unknown" header rather than a crash; the next render lands the
  // resolved Comment.
  const headerLine = target
    ? `${target.author} · ${formatRelativeAge(target.created_at, now)}`
    : "target unknown";
  const cascade = target ? cascadeFor(target, threads) : null;
  const note = cascade ? cascadeNote(cascade) : "";
  const excerpt = target ? bodyExcerpt(target.body) : "";

  return (
    <box
      position="absolute"
      bottom={1}
      left="15%"
      right="15%"
      borderStyle="single"
      borderColor={borderColor}
      title={contextLabel(target)}
      flexDirection="column"
      zIndex={100}
      backgroundColor={theme.canvas.default}
    >
      <box paddingX={1} paddingTop={1} flexDirection="column">
        <text fg={theme.fg.muted}>{headerLine}</text>
        <text fg={theme.fg.default}>{excerpt}</text>
        {note && (
          <box paddingTop={1} flexDirection="row">
            <text fg={theme.fg.attention}>{note}</text>
          </box>
        )}
      </box>
      <box height={1} paddingX={1}>
        <text fg={theme.fg.muted} selectable={false}>{hintText(state)}</text>
      </box>
    </box>
  );
}

export type { DeleteConfirmModalProps };
