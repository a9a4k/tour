// Shared C4 cascade classification + rendering for the delete-confirm
// surfaces (ADR 0036). The TUI and webapp compute the cascade against
// different input shapes (`Thread[]` in `core/delete-confirm-preview.ts`
// vs flat `Comment[]` in `web/client/delete-cascade-note.ts`), but the
// outcome union and the user-facing strings are identical — lifted here
// so wording changes happen in one place.

export type DeleteCascade =
  // Leaf Reply target: only this Reply leaves the projection.
  | { kind: "reply-only" }
  // Parent target with ≥1 surviving Reply: parent collapses to a
  // `[deleted]` stub and the Replies stay under it.
  | { kind: "parent-stub"; survivorCount: number }
  // Target is the last live node in its Thread — the Thread vanishes
  // from the projection entirely per C4.
  | { kind: "thread-vanishes" };

export function renderDeleteCascade(cascade: DeleteCascade): string {
  switch (cascade.kind) {
    case "reply-only":
      return "this reply will be removed from the thread.";
    case "parent-stub": {
      const noun = cascade.survivorCount === 1 ? "reply" : "replies";
      return `${cascade.survivorCount} ${noun} will remain under [deleted].`;
    }
    case "thread-vanishes":
      return "the thread will vanish.";
  }
}
