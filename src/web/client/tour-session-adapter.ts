import type {
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../../core/tour-session-runtime.js";
import type { TourBundle } from "../../core/tour-bundle.js";
import type { ReplyLock } from "../../core/reply-lock.js";
import type { Annotation } from "../../core/types.js";
import type { ScrollPlacement } from "../../core/tour-session.js";
import type { WriteAnnotationInput } from "../../core/write-annotation-input.js";

// `TourSessionAdapter` implemented against the webapp's substrate
// (`fetch`, `EventSource`, `window.history`, DOM scroll). Only the watcher
// path (`fetchBundle` / `fetchReplyLock` / `subscribeTourEvents`) is
// wired in this slice; scroll / reveal / mirror methods land in later
// slices alongside their runtime intent handlers.
export function createWebTourSessionAdapter(): TourSessionAdapter {
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
    writeAnnotation: async (_tourId: string, _input: WriteAnnotationInput): Promise<Annotation> => {
      // Slice 4 lifts `submitAnnotation` into the runtime; the webapp's
      // POST currently lives in App.tsx's intent listener.
      throw new Error("writeAnnotation not yet wired through the runtime");
    },
    requestReply: async () => {
      // Slice 7 wires the explicit reply-agent send path through the runtime.
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
          msg.type === "annotation-changed" ||
          msg.type === "reply-in-flight" ||
          msg.type === "reply-cleared"
        ) {
          handler({ type: msg.type });
        }
      };
      return () => evtSource.close();
    },
    scrollToCard: (_id: string, _mode: ScrollPlacement) => {
      // Slice 6: DOM scrollIntoView via annotationRefs.
    },
    scrollToRow: (_anchor: ScrollRowAnchor, _mode: ScrollPlacement) => {
      // Slice 6: DOM scrollIntoView via the row gutter selector.
    },
    scrollToPickerRow: (_idx: number) => {
      // Slice 6: DOM scrollIntoView via `[data-picker-row-idx="<idx>"]`.
    },
    revealFileInSidebar: (_file: string) => {
      // Slice 6.
    },
    mirrorTourUrl: (_id: string) => {
      // Slice 6: window.history.pushState via composeUrl.
    },
    mirrorAnnUrl: (_id: string | null) => {
      // Slice 6: window.history.replaceState via composeUrl.
    },
  };
}
