import type { ScrollBoxRenderable } from "@opentui/core";
import { TourWatcher } from "../core/watcher.js";
import type {
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../core/tour-session-runtime.js";
import type { TourBundle } from "../core/tour-bundle.js";
import type { ReplyLock } from "../core/reply-lock.js";
import type { Annotation } from "../core/types.js";
import {
  isBundleResolved,
  type ScrollPlacement,
  type TourSessionStore,
} from "../core/tour-session.js";
import type { WriteAnnotationInput } from "../core/write-annotation-input.js";
import { isTopLevel } from "../core/threads.js";
import {
  buildTree,
  compress,
  revealAncestors,
  revealAndLocate,
} from "../core/file-tree.js";
import { centerChildInView, scrollChildIntoView } from "./scroll-into-view.js";
import { animatedScrollChildIntoView } from "./smooth-scroll.js";
import { requestReply as runRequestReply } from "../core/reply-runner.js";

// TUI substrate dependencies the adapter needs. The renderer-bound
// ScrollBoxRenderable refs are filled lazily by `<scrollbox ref={...}>`
// — they're read at intent-fire time so the adapter doesn't trip on a
// pre-mount intent. The store handle lets the adapter (a) derive the
// sidebar tree on demand inside `revealFileInSidebar` and (b) retry the
// post-submit scroll once the watcher's `bundle.refreshed` lands.
export interface TuiTourSessionAdapterDeps {
  cwd: string;
  store: TourSessionStore;
  loadTour: (id: string) => Promise<TourBundle>;
  loadReplyLock: (id: string) => Promise<ReplyLock | null>;
  writeAnnotation: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
  diffScrollBoxRef: { current: ScrollBoxRenderable | null };
  pickerScrollBoxRef: { current: ScrollBoxRenderable | null };
  setSelectedRowIdx: (idx: number) => void;
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

  // Issue #296: placement-driven helper choice, anchor-kind-agnostic.
  // `center` → instant frame (fresh landings: cursor materialize, URL
  // restore, tour-switch, send-to-agent recall). `nearest` → in-flight
  // navigation (`j`/`k`/`n`/`p`/click-to-position), always animated.
  // `opts.animate === false` is the caller-level escape hatch (used by
  // the post-submit retry-budget below — issue #301) that forces the
  // nearest branch to write instantly without spawning a tween.
  function scrollByPlacement(
    sb: ScrollBoxRenderable,
    targetId: string,
    mode: ScrollPlacement,
    opts: { animate?: boolean } = {},
  ): void {
    if (mode === "center") {
      centerChildInView(sb, targetId);
    } else {
      animatedScrollChildIntoView(sb, targetId, opts);
    }
  }

  function scrollCardOnce(
    id: string,
    mode: ScrollPlacement,
    opts: { animate?: boolean } = {},
  ): boolean {
    const sb = deps.diffScrollBoxRef.current;
    if (!sb) return false;
    const targetId = `annotation-${id}`;
    if (!sb.content.findDescendantById(targetId)) return false;
    scrollByPlacement(sb, targetId, mode, opts);
    return true;
  }

  return {
    fetchBundle: (id) => deps.loadTour(id),
    fetchReplyLock: (id) => deps.loadReplyLock(id),
    writeAnnotation: (tourId, input) => deps.writeAnnotation(tourId, input),
    requestReply: async ({ tourId, annotationId }) => {
      // No-op when `--reply-agent` wasn't passed, mirroring `core/reply-
      // runner`'s `no-reply-agent` seam. Rejections propagate; the runtime's
      // intent listener owns the fire-and-forget catch. PRD #278 slice 7.
      if (!deps.replyAgent) return;
      await runRequestReply({
        cwd: deps.cwd,
        tourId,
        annotationId,
        agent: deps.replyAgent,
      });
    },
    subscribeTourEvents: (tourId, handler: TourEventHandler) => {
      const watcher = new TourWatcher(deps.cwd, tourId);
      watcher.on((event) => {
        if (event.type === "annotation-changed") {
          handler({ type: "annotation-changed" });
        } else if (event.type === "reply-in-flight") {
          handler({ type: "reply-in-flight" });
        } else if (event.type === "reply-cleared") {
          handler({ type: "reply-cleared" });
        }
      });
      watcher.start();
      return () => watcher.stop();
    },
    scrollToCard: (id, mode) => {
      // Issue #301: only the first attempt honors the placement's
      // animate default — once we're retrying (target absent on the
      // first try), we're inside the post-submit "wait for DOM" loop,
      // not an in-flight gesture. Pass `animate: false` on retries so
      // the eventual successful write lands instantly instead of
      // spawning a tween per attempt that gets cancelled by the next
      // attempt's macrotask. `n`/`p` to an existing card hits the
      // first-attempt path (target already in DOM) and keeps its
      // animated motion.
      const attempt = (remaining: number, isRetry: boolean): void => {
        scheduleScroll(() => {
          const opts = isRetry ? { animate: false } : {};
          if (scrollCardOnce(id, mode, opts)) return;
          // Target not in DOM yet (post-submit `scrollToAnnotation` fires
          // synchronously inside `composer.submitted`, before the watcher
          // delivers the freshly-written card). Retry until the bundle
          // refreshes or the budget runs out.
          if (remaining > 0) attempt(remaining - 1, true);
        });
      };
      attempt(POST_SUBMIT_SCROLL_RETRY_BUDGET, false);
    },
    scrollToRow: (anchor: ScrollRowAnchor, mode: ScrollPlacement) => {
      scheduleScroll(() => {
        const sb = deps.diffScrollBoxRef.current;
        if (!sb) return;
        const targetId = `diff-row-${anchor.file}-${anchor.side}-${anchor.lineNumber}`;
        scrollByPlacement(sb, targetId, mode);
      });
    },
    scrollToPickerRow: (idx: number) => {
      const sb = deps.pickerScrollBoxRef.current;
      if (!sb) return;
      scrollChildIntoView(sb, `picker-row-${idx}`);
    },
    revealFileInSidebar: (file: string) => {
      const state = deps.store.getState();
      const bundle = isBundleResolved(state);
      if (!bundle || bundle.kind !== "ok") return;
      const tree = compress(buildTree([...bundle.files]));
      const annotationCounts: Record<string, number> = {};
      for (const a of bundle.annotations) {
        if (isTopLevel(a)) {
          annotationCounts[a.file] = (annotationCounts[a.file] ?? 0) + 1;
        }
      }
      const collapsedFolders = state.collapsedFolders;
      const ancestors = revealAncestors(tree, file);
      for (const path of ancestors) {
        if (collapsedFolders.has(path)) {
          deps.store.dispatch({ type: "folds.toggleFolder", path });
        }
      }
      const located = revealAndLocate(tree, collapsedFolders, annotationCounts, file);
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
