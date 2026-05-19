import { yankToClipboard, type ClipboardSink } from "./clipboard.js";

export type TextSelectionClipboardSink = ClipboardSink;

export interface FinishedTextSelection {
  getSelectedText(): unknown;
}

type ClipboardWriter = (
  text: string,
  sink: TextSelectionClipboardSink,
) => boolean;

export function copyFinishedTextSelection(
  selection: FinishedTextSelection,
  sink: TextSelectionClipboardSink,
  flash: (message: string) => void,
  write: ClipboardWriter = yankToClipboard,
): boolean {
  const text = selection.getSelectedText();
  if (typeof text !== "string" || text.length === 0) return false;

  const copied = write(text, sink);
  if (copied) flash("Copied selection");
  return copied;
}
