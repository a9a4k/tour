// Issue #389 / ADR 0036 (Slice E).
//
// Transport wrapper for the webapp's delete-confirm modal. The DELETE
// `/api/tours/<id>/comments/<comment-id>` endpoint wraps the shared
// `createDelete` seam (the same one the CLI's `--delete` flag uses in
// Slice C); the webapp's delete is implicitly human — no `--as-agent`
// equivalent surface here, by design.
//
// Returns `{ ok: true }` on success, `{ ok: false, message }` otherwise.
// Callers surface the message into the footer-flash channel; the server
// pipes the seam's error string through verbatim.

export interface DeleteCommentResult {
  ok: boolean;
  message?: string;
}

export async function dispatchDeleteComment(
  tourId: string,
  commentId: string,
): Promise<DeleteCommentResult> {
  let res: Response;
  try {
    res = await fetch(`/api/tours/${tourId}/comments/${commentId}`, {
      method: "DELETE",
    });
  } catch {
    return { ok: false, message: "Delete failed: server unreachable" };
  }
  if (res.ok) return { ok: true };
  const data = (await res
    .json()
    .catch(() => ({ error: "server error" }))) as { error?: string };
  return { ok: false, message: `Delete failed: ${data.error ?? "server error"}` };
}
