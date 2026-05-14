import type { ScrollBoxRenderable } from "@opentui/core";
import { TourWatcher } from "../core/watcher.js";
import type {
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../core/tour-session-runtime.js";
import type { TourBundle, BundleFile } from "../core/tour-bundle.js";
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

  function scrollCardOnce(id: string, mode: ScrollPlacement): boolean {
    const sb = deps.diffScrollBoxRef.current;
    if (!sb) return false;
    const targetId = `annotation-${id}`;
    if (!sb.content.findDescendantById(targetId)) return false;
    if (mode === "center") centerChildInView(sb, targetId);
    else scrollChildIntoView(sb, targetId);
    return true;
  }

  return {
    fetchBundle: (id) => deps.loadTour(id),
    fetchReplyLock: (id) => deps.loadReplyLock(id),
    writeAnnotation: (tourId, input) => deps.writeAnnotation(tourId, input),
    requestReply: async () => {
      // Slice 7 wires the explicit reply-agent send path through the runtime.
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
      const attempt = (remaining: number): void => {
        scheduleScroll(() => {
          if (scrollCardOnce(id, mode)) return;
          // Target not in DOM yet (post-submit `scrollToAnnotation` fires
          // synchronously inside `composer.submitted`, before the watcher
          // delivers the freshly-written card). Retry until the bundle
          // refreshes or the budget runs out.
          if (remaining > 0) attempt(remaining - 1);
        });
      };
      attempt(POST_SUBMIT_SCROLL_RETRY_BUDGET);
    },
    scrollToRow: (anchor: ScrollRowAnchor, _mode: ScrollPlacement) => {
      scheduleScroll(() => {
        const sb = deps.diffScrollBoxRef.current;
        if (!sb) return;
        scrollChildIntoView(
          sb,
          `diff-row-${anchor.file}-${anchor.side}-${anchor.lineNumber}`,
        );
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
      const tree = compress(buildTree([...(bundle.files as ReadonlyArray<BundleFile>)]));
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
