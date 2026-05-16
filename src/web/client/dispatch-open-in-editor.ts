// Issue #383 / ADR 0035 / PRD #349 (ADR 0032).
//
// One transport wrapper for the three webapp callers of the open-in-editor
// endpoint: the keyboard `o` handler (App.tsx), the annotation card's
// filename link, and the file-header `↗` icon. All three pipe the server's
// `message` field verbatim into the footer-flash channel — the server
// stays the source of truth for user-facing strings (matches the wording
// the TUI surfaces from core/editor-spawn). Adding a fourth caller in the
// future is a one-line wire-up, not a copy/paste of the fetch + footer
// glue.

export type OpenInEditorSide = "additions" | "deletions";

export async function dispatchOpenInEditor(
  tourId: string,
  file: string,
  line: number,
  side: OpenInEditorSide,
  flashFooterStatus: (message: string) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/tours/${tourId}/open-in-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, line, side }),
    });
  } catch {
    flashFooterStatus("o: server unreachable");
    return;
  }
  const data = (await res
    .json()
    .catch(() => ({ message: "o: server error" }))) as { message?: string };
  flashFooterStatus(data.message ?? "o: server error");
}
