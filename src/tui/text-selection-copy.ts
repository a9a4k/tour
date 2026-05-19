import type { Selection } from "@opentui/core";
import { yankToClipboard, type ClipboardSink } from "./clipboard.js";

type ClipboardWriter = (
  text: string,
  sink: ClipboardSink,
) => boolean;

export function copyFinishedTextSelection(
  selection: Pick<Selection, "getSelectedText">,
  sink: ClipboardSink,
  flash: (message: string) => void,
  write: ClipboardWriter = yankToClipboard,
): boolean {
  const text = selection.getSelectedText();
  if (text.length === 0) return false;

  const copied = write(text, sink);
  if (copied) flash("Copied selection");
  return copied;
}
