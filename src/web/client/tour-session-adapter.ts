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
    writeAnnotation: async (tourId: string, input: WriteAnnotationInput): Promise<Annotation> => {
      const body = input.body.trim();
      const payload: Record<string, unknown> =
        input.kind === "reply"
          ? { body, replies_to: input.parent.id }
          : {
              body,
              file: input.file,
              side: input.side,
              line_start: input.line_start,
              line_end: input.line_end,
            };
      const res = await fetch(`/api/tours/${tourId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as Annotation;
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
