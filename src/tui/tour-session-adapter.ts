import type { ScrollBoxRenderable } from "@opentui/core";
import { TourWatcher } from "../core/watcher.js";
import type {
  AnchorToken,
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../core/tour-session-runtime.js";
import type { TourBundle } from "../core/tour-bundle.js";
import type { ReplyLock } from "../core/reply-lock.js";
import type { Comment } from "../core/types.js";
import {
  isBundleResolved,
  type ScrollMotion,
  type ScrollPlacement,
  type TourSessionStore,
} from "../core/tour-session.js";
import type { WriteCommentInput } from "../core/write-comment-input.js";
import {
  buildTree,
  compress,
  revealAncestors,
  revealAndLocate,
} from "../core/file-tree.js";
import {
  applyPreserveScreenY,
  captureScreenYSnapshot,
  centerChildInView,
  scrollChildIntoView,
  type ScreenYSnapshot,
} from "./scroll-into-view.js";
import {
  animatedCenterChildInView,
  animatedScrollChildIntoView,
  SMOOTH_SCROLL_DEFAULT_DURATION_MS,
} from "./smooth-scroll.js";
import { requestReply as runRequestReply } from "../core/reply-runner.js";

// TUI substrate dependencies the adapter needs. The renderer-bound
// ScrollBoxRenderable refs are filled lazily by `<scrollbox ref={...}>`
// — they're read at intent-fire time so the adapter doesn't trip on a
// pre-mount intent. The store handle lets the adapter (a) derive the
// sidebar tree on demand inside `revealFileInSidebar` and (b) retry the
// post-submit scroll once the watcher's `bundle.refreshed` lands.
export interface TuiTourSessionAdapterDeps {
  cwd: string;
  tourStoreRoot?: string;
  store: TourSessionStore;
  loadTour: (id: string) => Promise<TourBundle>;
  loadReplyLock: (id: string) => Promise<ReplyLock | null>;
  writeComment: (tourId: string, input: WriteCommentInput) => Promise<Comment>;
  /** ADR 0036 Slice D / issue #388. Wraps `createDelete`; the CLI binary
   *  binds this to `core/comments-store#createDelete` with the cwd. */
  deleteComment: (tourId: string, targetId: string) => Promise<void>;
  diffScrollBoxRef: { current: ScrollBoxRenderable | null };
  pickerScrollBoxRef: { current: ScrollBoxRenderable | null };
  setSelectedRowIdx: (idx: number) => void;
  /** Notifies the App that an in-flight card scroll started / settled. The
   *  footer-hint pixel probe reads `sb.scrollTop` at render time, but the
   *  scroll-into-view animation mutates `scrollTop` imperatively without
   *  triggering a React re-render — so without this signal the probe sees
   *  pre-scroll state and reports a visible card as off-screen (issue
   *  #302). The App suppresses the directional suffix while `true` and
   *  forces a re-render when the flag flips back to `false` so the probe
   *  re-runs against the settled scrollTop. */
  setScrollPending: (pending: boolean) => void;
  // The renderer-configured reply-agent name (`--reply-agent`). Absent or
  // empty means the renderer was launched without a reply-agent; the
  // `requestReply` adapter call no-ops, mirroring `core/reply-runner`'s
  // `no-reply-agent` seam.
  replyAgent: string | undefined;
}

// Post-submit scroll retry budget. The watcher's `bundle.refreshed` lands
// within a few ms in practice — 20 retries at the default macrotask
// cadence covers a worst-case ~1s window before we silently give up.
const POST_SUBMIT_SCROLL_RETRY_BUDGET = 20;

type TuiAnchorToken = AnchorToken & {
  readonly rowId: string;
  readonly snapshot: ScreenYSnapshot;
};

// `TourSessionAdapter` implemented against the TUI substrate (OpenTUI
// ScrollBox + TourWatcher + props.* callbacks). URL-mirror methods are
// permanent no-ops — the TUI has no URL.
export function createTuiTourSessionAdapter(
  deps: TuiTourSessionAdapterDeps,
): TourSessionAdapter {
  // Defers to the next macrotask so OpenTUI's Yoga relayout completes
  // before we read positions. `requestAnimationFrame` shims to
  // `setImmediate` (or similar) in bun/node and fires BEFORE OpenTUI's
  // render tick — empirically verified that setTimeout(0) is what
  // reliably lands the callback after layout.
  function scheduleScroll(fn: () => void): void {
    setTimeout(fn, 0);
  }

  // Issue #348: placement and motion are independent axes. The adapter
  // takes both and dispatches to the matching helper — `center + smooth`
  // and `nearest + instant` are now first-class combinations.
  //
  //   placement \ motion │ instant                       │ smooth
  //   ───────────────────┼───────────────────────────────┼────────────────────────────
  //   center             │ centerChildInView             │ animatedCenterChildInView
  //   nearest            │ animatedScrollChildIntoView   │ animatedScrollChildIntoView
  //                      │ with `{ animate: false }`     │
  //
  // `nearest + instant` is exercised by the post-submit retry-budget
  // loop (issue #301) — the caller threads `forceInstant = true` so the
  // budgeted retry that lands a successful scroll doesn't spawn a tween
  // every macrotask. All other sites pick motion from the intent.
  function scrollByPlacement(
    sb: ScrollBoxRenderable,
    targetId: string,
    placement: ScrollPlacement,
    behavior: ScrollMotion,
    opts: { forceInstant?: boolean } = {},
  ): void {
    const animate = opts.forceInstant ? false : behavior === "smooth";
    if (placement === "center") {
      if (animate) {
        animatedCenterChildInView(sb, targetId);
      } else {
        centerChildInView(sb, targetId);
      }
    } else {
      animatedScrollChildIntoView(sb, targetId, { animate });
    }
  }

  function scrollCardOnce(
    id: string,
    placement: ScrollPlacement,
    behavior: ScrollMotion,
    opts: { forceInstant?: boolean } = {},
  ): boolean {
    const sb = deps.diffScrollBoxRef.current;
    if (!sb) return false;
    const targetId = `comment-${id}`;
    if (!sb.content.findDescendantById(targetId)) return false;
    scrollByPlacement(sb, targetId, placement, behavior, opts);
    return true;
  }

  return {
    fetchBundle: (id) => deps.loadTour(id),
    fetchReplyLock: (id) => deps.loadReplyLock(id),
    writeComment: (tourId, input) => deps.writeComment(tourId, input),
    deleteComment: ({ tourId, targetId }) => deps.deleteComment(tourId, targetId),
    requestReply: async ({ tourId, commentId }) => {
      // No-op when `--reply-agent` wasn't passed, mirroring `core/reply-
      // runner`'s `no-reply-agent` seam. Rejections propagate; the runtime's
      // intent listener owns the fire-and-forget catch. PRD #278 slice 7.
      if (!deps.replyAgent) return;
      await runRequestReply({
        cwd: deps.cwd,
        tourStoreRoot: deps.tourStoreRoot,
        tourId,
        commentId,
        agent: deps.replyAgent,
      });
    },
    subscribeTourEvents: (tourId, handler: TourEventHandler) => {
      const watcher = new TourWatcher(deps.tourStoreRoot ?? deps.cwd, tourId);
      watcher.on((event) => {
        if (event.type === "comment-changed") {
          handler({ type: "comment-changed" });
        } else if (event.type === "reply-in-flight") {
          handler({ type: "reply-in-flight" });
        } else if (event.type === "reply-cleared") {
          handler({ type: "reply-cleared" });
        }
      });
      watcher.start();
      return () => watcher.stop();
    },
    scrollToCard: (id, placement, behavior) => {
      // Issue #302: signal pending while the scroll-into-view animation
      // runs so the App can suppress the footer-hint off-screen suffix
      // (the probe reads `sb.scrollTop` and the imperative tween that
      // mutates it doesn't trigger a React re-render). Cleared after
      // the smooth-scroll duration + a small buffer; the resulting
      // state flip forces a re-render where the probe sees the settled
      // `scrollTop` and reports the correct relation.
      deps.setScrollPending(true);
      const settle = (): void => {
        setTimeout(() => deps.setScrollPending(false), SMOOTH_SCROLL_DEFAULT_DURATION_MS + 50);
      };
      // Issue #301: only the first attempt honors the intent's motion —
      // once we're retrying (target absent on the first try), we're
      // inside the post-submit "wait for DOM" loop, not an in-flight
      // gesture. Force-instant on retries so the eventual successful
      // write lands instantly instead of spawning a tween per attempt
      // that gets cancelled by the next attempt's macrotask. `n`/`p` to
      // an existing card hits the first-attempt path (target already in
      // DOM) and keeps its animated motion.
      const attempt = (remaining: number, isRetry: boolean): void => {
        scheduleScroll(() => {
          const opts = isRetry ? { forceInstant: true } : {};
          if (scrollCardOnce(id, placement, behavior, opts)) {
            settle();
            return;
          }
          // Target not in DOM yet (post-submit `scrollCursorTarget` fires
          // from the deferred `bundle.commentInsertedWithLanding` dispatch
          // — issue #405 — and React's commit for the new CommentRow may
          // not have flushed by the time this adapter call runs). Retry
          // until the row mounts or the budget runs out.
          if (remaining > 0) {
            attempt(remaining - 1, true);
            return;
          }
          // Retry budget exhausted with no successful scroll — clear
          // pending so the suffix isn't suppressed forever.
          deps.setScrollPending(false);
        });
      };
      attempt(POST_SUBMIT_SCROLL_RETRY_BUDGET, false);
    },
    scrollToRow: (
      anchor: ScrollRowAnchor,
      placement: ScrollPlacement,
      behavior: ScrollMotion,
    ) => {
      scheduleScroll(() => {
        const sb = deps.diffScrollBoxRef.current;
        if (!sb) return;
        const targetId = `diff-row-${anchor.file}-${anchor.side}-${anchor.lineNumber}`;
        scrollByPlacement(sb, targetId, placement, behavior);
      });
    },
    scrollToComposer: (target) => {
      // Issue #320: TUI v1 mirrors `scrollToRow` (top-level) /
      // `scrollToCard` (reply) — textarea focus is a TUI follow-up.
      // Nothing in the TUI dispatches `composer.recall` today (the
      // ghost `+` is mouse-only on the webapp), so this is a defensive
      // implementation against the runtime contract.
      if (target.kind === "reply") {
        scheduleScroll(() => {
          const sb = deps.diffScrollBoxRef.current;
          if (!sb) return;
          const targetId = `comment-${target.thread_id}`;
          if (sb.content.findDescendantById(targetId)) {
            centerChildInView(sb, targetId);
          }
        });
        return;
      }
      scheduleScroll(() => {
        const sb = deps.diffScrollBoxRef.current;
        if (!sb) return;
        const targetId = `diff-row-${target.file}-${target.side}-${target.line_end}`;
        centerChildInView(sb, targetId);
      });
    },
    scrollToPickerRow: (idx: number) => {
      const sb = deps.pickerScrollBoxRef.current;
      if (!sb) return;
      scrollChildIntoView(sb, `picker-row-${idx}`);
    },
    captureAnchor: (rowId: string) => {
      const sb = deps.diffScrollBoxRef.current;
      if (!sb) return null;
      const snapshot = captureScreenYSnapshot(sb, rowId);
      if (!snapshot) return null;
      return { rowId, snapshot } as TuiAnchorToken;
    },
    applyAnchor: (token: AnchorToken) => {
      const { rowId, snapshot } = token as TuiAnchorToken;
      scheduleScroll(() => {
        const sb = deps.diffScrollBoxRef.current;
        if (!sb) return;
        const applied = applyPreserveScreenY(sb, rowId, snapshot);
        if (!applied) scrollChildIntoView(sb, rowId);
      });
    },
    revealFileInSidebar: (file: string) => {
      const state = deps.store.getState();
      const bundle = isBundleResolved(state);
      if (!bundle || bundle.kind !== "ok") return;
      const tree = compress(buildTree([...bundle.files]));
      const commentCounts: Record<string, number> = {};
      for (const a of bundle.comments) {
        if (a.thread_id === undefined) {
          commentCounts[a.file] = (commentCounts[a.file] ?? 0) + 1;
        }
      }
      const collapsedFolders = state.collapsedFolders;
      const ancestors = revealAncestors(tree, file);
      for (const path of ancestors) {
        if (collapsedFolders.has(path)) {
          deps.store.dispatch({ type: "folds.toggleFolder", path });
        }
      }
      const located = revealAndLocate(tree, collapsedFolders, commentCounts, file);
      if (located) deps.setSelectedRowIdx(located.rowIdx);
    },
    mirrorTourUrl: () => {
      // TUI has no URL.
    },
    mirrorAnnUrl: () => {
      // TUI has no URL.
    },
  };
}
