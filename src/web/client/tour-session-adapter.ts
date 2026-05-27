import type {
  AnchorToken,
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../../core/tour-session-runtime.js";
import type { TourBundle } from "../../core/tour-bundle.js";
import type { ReplyLock } from "../../core/reply-lock.js";
import type { Comment } from "../../core/types.js";
import {
  isBundleResolved,
  type ScrollMotion,
  type ScrollPlacement,
  type TourSessionState,
  type TourSessionStore,
} from "../../core/tour-session.js";
import type { WriteCommentInput } from "../../core/write-comment-input.js";
import { composeUrl } from "./url-routing.js";

// Webapp substrate dependencies the adapter needs. Refs are read at
// intent-fire time so the adapter doesn't trip on pre-mount intents;
// callbacks live in `callbacksRef` so the surface can refresh them per
// render without rebuilding the adapter.
export interface WebTourSessionAdapterDeps {
  store: TourSessionStore;
  commentRefs: { current: Map<string, HTMLDivElement> };
  callbacksRef: {
    current: {
      findFileBlock: (name: string) => HTMLElement | null;
      revealFileInSidebar: (file: string) => void;
    } | null;
  };
}

// `ScrollMotion` and `ScrollPlacement` are independent axes on the
// `scrollCursorTarget` intent (issue #348). The adapter forwards both
// to the browser's `scrollIntoView` — placement maps to the `block`
// option, motion to `behavior`. Browser-native smooth-scroll already
// interrupts a prior in-flight tween on every new call, so rapid `n`/
// `p` sequences converge on the final target without queueing.
function browserBehaviorOf(motion: ScrollMotion): ScrollBehavior {
  return motion === "smooth" ? "smooth" : "instant";
}

type WebAnchorToken = AnchorToken & {
  readonly rowId: string;
  readonly top: number;
};

function scheduleAfterCommit(fn: () => void): void {
  queueMicrotask(() => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(fn);
      return;
    }
    setTimeout(fn, 0);
  });
}

// Mirror of the view's `isFileFolded || isClassifierCollapsed` rule —
// true when the file's diff rows aren't rendered. (issue #324)
function isFileBodyHidden(
  state: TourSessionState,
  bundle: TourBundle,
  fileName: string,
): boolean {
  const override = state.collapsedOverrides[fileName];
  if (override === true) return true;
  if (override === false) return false;
  if (bundle.kind !== "ok") return false;
  const f = bundle.files.find((x) => x.name === fileName);
  if (!f) return false;
  return f.classification.collapsed === true;
}

// `TourSessionAdapter` implemented against the webapp's substrate
// (`fetch`, `EventSource`, `window.history`, DOM scroll).
export function createWebTourSessionAdapter(
  deps: WebTourSessionAdapterDeps,
): TourSessionAdapter {
  function findAnchorElement(rowId: string): HTMLElement | null {
    if (typeof document === "undefined") return null;
    if (rowId.startsWith("comment-")) {
      return deps.commentRefs.current.get(rowId.slice("comment-".length)) ?? null;
    }
    const cbs = deps.callbacksRef.current;
    if (!cbs) return null;
    if (rowId.startsWith("file-card-")) {
      return cbs.findFileBlock(rowId.slice("file-card-".length));
    }
    const match = /^diff-row-(.*)-(additions|deletions)-(\d+)$/.exec(rowId);
    if (!match) return null;
    const [, file, side, lineNumber] = match;
    const block = cbs.findFileBlock(file);
    if (!block) return null;
    return block.querySelector<HTMLElement>(
      `.tour-row-gutter[data-side="${side}"][data-line-number="${lineNumber}"]`,
    );
  }

  return {
    fetchBundle: async (id) => {
      const res = await fetch(`/api/tours/${id}`);
      const data = (await res.json()) as TourBundle | { error: string };
      if ("error" in data) throw new Error(data.error);
      return data;
    },
    fetchReplyLock: async (id) => {
      const res = await fetch(`/api/tours/${id}/reply-lock`);
      const data = (await res.json()) as ReplyLock | { error: string } | null;
      if (data && typeof data === "object" && "error" in data) return null;
      return data as ReplyLock | null;
    },
    writeComment: async (tourId: string, input: WriteCommentInput): Promise<Comment> => {
      const body = input.body.trim();
      const payload: Record<string, unknown> =
        input.kind === "reply"
          ? { body, thread_id: input.parent.id }
          : {
              body,
              file: input.file,
              side: input.side,
              line_start: input.line_start,
              line_end: input.line_end,
            };
      const res = await fetch(`/api/tours/${tourId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as Comment;
    },
    writeCommentEdit: async (
      tourId: string,
      targetId: string,
      body: string,
    ): Promise<void> => {
      const res = await fetch(`/api/tours/${tourId}/edit-comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: targetId, body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    },
    deleteComment: async ({ tourId, targetId }) => {
      // ADR 0036 Slice D / issue #388. Webapp trash icon + modal land in
      // a follow-up slice (issue #389); the seam is wired here against
      // the eventual `DELETE /api/tours/<id>/comments/<comment-id>`
      // endpoint so the interface stays uniform across surfaces. The TUI
      // (this slice) is the only caller for now.
      const res = await fetch(`/api/tours/${tourId}/comments/${targetId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    },
    requestReply: async ({ tourId, commentId }) => {
      // SSE `reply-in-flight` / `reply-cleared` events drive the in-flight
      // pill; transport-level failures (non-2xx or network) reject so the
      // adapter contract matches the TUI's in-process path (issue #291).
      // The runtime's fire-and-forget catch absorbs both. PRD #278 slice 7.
      const res = await fetch(`/api/tours/${tourId}/request-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: commentId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    },
    subscribeTourEvents: (tourId, handler: TourEventHandler) => {
      const evtSource = new EventSource(`/api/tours/${tourId}/events`);
      evtSource.onmessage = (event) => {
        let msg: { type: string };
        try {
          msg = JSON.parse(event.data) as { type: string };
        } catch {
          return;
        }
        if (
          msg.type === "comment-changed" ||
          msg.type === "reply-in-flight" ||
          msg.type === "reply-cleared"
        ) {
          handler({ type: msg.type });
        }
      };
      return () => evtSource.close();
    },
    scrollToCard: (id: string, placement: ScrollPlacement, motion: ScrollMotion) => {
      if (typeof document === "undefined") return;
      requestAnimationFrame(() => {
        deps.commentRefs.current
          .get(id)
          ?.scrollIntoView({ behavior: browserBehaviorOf(motion), block: placement });
      });
    },
    scrollToRow: (
      anchor: ScrollRowAnchor,
      placement: ScrollPlacement,
      motion: ScrollMotion,
    ) => {
      if (typeof document === "undefined") return;
      requestAnimationFrame(() => {
        const cbs = deps.callbacksRef.current;
        if (!cbs) return;
        const block = cbs.findFileBlock(anchor.file);
        if (!block) return;
        const cell = block.querySelector<HTMLElement>(
          `.tour-row-gutter[data-side="${anchor.side}"][data-line-number="${anchor.lineNumber}"]`,
        );
        cell?.scrollIntoView({ behavior: browserBehaviorOf(motion), block: placement });
      });
    },
    scrollToComposer: (target) => {
      // Issue #320: scroll the anchor row in + focus the inline Composer's
      // textarea. Top-level anchors at a (file, side, line_end) gutter cell;
      // reply anchors at the parent comment's card via the comment refs.
      // Issue #324: if the anchor file is folded, force-reveal first so React
      // commits the body before the rAF-deferred gutter-cell query lands —
      // same explicit-reveal pattern as `n`/`p`/URL `?ann=` restore.
      if (typeof document === "undefined") return;
      const state = deps.store.getState();
      const bundle = isBundleResolved(state);
      let anchorFile: string | null = null;
      if (target.kind === "reply") {
        if (bundle !== null && bundle.kind === "ok") {
          const parent = bundle.comments.find((a) => a.id === target.thread_id);
          anchorFile = parent?.file ?? null;
        }
      } else {
        anchorFile = target.file;
      }
      if (
        anchorFile !== null &&
        bundle !== null &&
        isFileBodyHidden(state, bundle, anchorFile)
      ) {
        deps.store.dispatch({
          type: "folds.setOverride",
          file: anchorFile,
          value: false,
        });
      }
      requestAnimationFrame(() => {
        const cbs = deps.callbacksRef.current;
        if (!cbs) return;
        if (target.kind === "reply") {
          const replyAnchor = deps.commentRefs.current.get(target.thread_id);
          replyAnchor?.scrollIntoView({ behavior: "instant", block: "center" });
          replyAnchor
            ?.querySelector<HTMLTextAreaElement>("textarea")
            ?.focus();
          return;
        }
        const block = cbs.findFileBlock(target.file);
        if (!block) return;
        const cell = block.querySelector<HTMLElement>(
          `.tour-row-gutter[data-side="${target.side}"][data-line-number="${target.line_end}"]`,
        );
        cell?.scrollIntoView({ behavior: "instant", block: "center" });
        const composerCard = block.querySelector<HTMLElement>(
          '.tour-card[data-composer="true"]',
        );
        composerCard
          ?.querySelector<HTMLTextAreaElement>("textarea")
          ?.focus();
      });
    },
    scrollToPickerRow: (idx: number) => {
      if (typeof document === "undefined") return;
      const el = document.querySelector(`[data-picker-row-idx="${idx}"]`);
      el?.scrollIntoView({ block: "nearest" });
    },
    captureAnchor: (rowId: string) => {
      const el = findAnchorElement(rowId);
      if (!el) return null;
      return { rowId, top: el.getBoundingClientRect().top } as WebAnchorToken;
    },
    applyAnchor: (token: AnchorToken) => {
      const { rowId, top } = token as WebAnchorToken;
      scheduleAfterCommit(() => {
        if (typeof window === "undefined") return;
        const el = findAnchorElement(rowId);
        if (!el) return;
        const delta = el.getBoundingClientRect().top - top;
        if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
          el.scrollIntoView({ behavior: "instant", block: "center" });
        }
      });
    },
    revealFileInSidebar: (file: string) => {
      const cbs = deps.callbacksRef.current;
      if (!cbs) return;
      cbs.revealFileInSidebar(file);
    },
    mirrorTourUrl: (id: string) => {
      if (typeof window === "undefined" || !window.history) return;
      window.history.pushState({ tourId: id }, "", composeUrl(id, null));
    },
    mirrorAnnUrl: (commentId: string | null) => {
      // `replaceState` (not `pushState`) so back/forward steps over Tour
      // switches, not over every cursor move. Composer reads the store's
      // current tourId so an in-flight tour-switch can't write the wrong
      // tour's URL.
      if (typeof window === "undefined" || !window.history) return;
      const tid = deps.store.getState().currentTourId;
      if (tid === null) return;
      const url = composeUrl(tid, commentId);
      const current =
        window.location.pathname + window.location.search + window.location.hash;
      if (url === current) return;
      window.history.replaceState(window.history.state, "", url);
    },
  };
}
