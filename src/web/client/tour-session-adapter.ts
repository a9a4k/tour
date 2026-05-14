import type {
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../../core/tour-session-runtime.js";
import type { TourBundle } from "../../core/tour-bundle.js";
import type { ReplyLock } from "../../core/reply-lock.js";
import type { Annotation } from "../../core/types.js";
import type { ScrollPlacement, TourSessionStore } from "../../core/tour-session.js";
import type { WriteAnnotationInput } from "../../core/write-annotation-input.js";
import { composeUrl } from "./url-routing.js";

// Webapp substrate dependencies the adapter needs. Refs are read at
// intent-fire time so the adapter doesn't trip on pre-mount intents;
// callbacks live in `callbacksRef` so the surface can refresh them per
// render without rebuilding the adapter.
export interface WebTourSessionAdapterDeps {
  store: TourSessionStore;
  annotationRefs: { current: Map<string, HTMLDivElement> };
  callbacksRef: {
    current: {
      findFileBlock: (name: string) => HTMLElement | null;
      setSelectedFile: (file: string | null) => void;
      revealFileAncestors: (file: string) => void;
    } | null;
  };
}

// Cursor-driven scroll behavior derives from the intent's placement (issue
// #293). `nearest` is in-flight navigation (`n`/`p`, `j`/`k`, click-to-
// position, bundle-refresh re-snap) — smooth scroll conveys travel
// distance so adjacent landings keep spatial continuity. `center` is a
// fresh landing (initial materialize, URL `?ann=` restore, stale fallback)
// — instant so the target frames immediately with no prior frame of
// reference to preserve.
function behaviorFor(mode: ScrollPlacement): ScrollBehavior {
  return mode === "nearest" ? "smooth" : "instant";
}

// `TourSessionAdapter` implemented against the webapp's substrate
// (`fetch`, `EventSource`, `window.history`, DOM scroll).
export function createWebTourSessionAdapter(
  deps: WebTourSessionAdapterDeps,
): TourSessionAdapter {
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
    requestReply: async ({ tourId, annotationId }) => {
      // SSE `reply-in-flight` / `reply-cleared` events drive the in-flight
      // pill; transport-level failures (non-2xx or network) reject so the
      // adapter contract matches the TUI's in-process path (issue #291).
      // The runtime's fire-and-forget catch absorbs both. PRD #278 slice 7.
      const res = await fetch(`/api/tours/${tourId}/request-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotation_id: annotationId }),
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
          msg.type === "annotation-changed" ||
          msg.type === "reply-in-flight" ||
          msg.type === "reply-cleared"
        ) {
          handler({ type: msg.type });
        }
      };
      return () => evtSource.close();
    },
    scrollToCard: (id: string, mode: ScrollPlacement) => {
      if (typeof document === "undefined") return;
      requestAnimationFrame(() => {
        deps.annotationRefs.current
          .get(id)
          ?.scrollIntoView({ behavior: behaviorFor(mode), block: mode });
      });
    },
    scrollToRow: (anchor: ScrollRowAnchor, mode: ScrollPlacement) => {
      if (typeof document === "undefined") return;
      requestAnimationFrame(() => {
        const cbs = deps.callbacksRef.current;
        if (!cbs) return;
        const block = cbs.findFileBlock(anchor.file);
        if (!block) return;
        const cell = block.querySelector<HTMLElement>(
          `.tour-row-gutter[data-side="${anchor.side}"][data-line-number="${anchor.lineNumber}"]`,
        );
        cell?.scrollIntoView({ behavior: behaviorFor(mode), block: mode });
      });
    },
    scrollToPickerRow: (idx: number) => {
      if (typeof document === "undefined") return;
      const el = document.querySelector(`[data-picker-row-idx="${idx}"]`);
      el?.scrollIntoView({ block: "nearest" });
    },
    revealFileInSidebar: (file: string) => {
      const cbs = deps.callbacksRef.current;
      if (!cbs) return;
      cbs.setSelectedFile(file);
      cbs.revealFileAncestors(file);
    },
    mirrorTourUrl: (id: string) => {
      if (typeof window === "undefined" || !window.history) return;
      window.history.pushState({ tourId: id }, "", composeUrl(id, null));
    },
    mirrorAnnUrl: (annotationId: string | null) => {
      // `replaceState` (not `pushState`) so back/forward steps over Tour
      // switches, not over every cursor move. Composer reads the store's
      // current tourId so an in-flight tour-switch can't write the wrong
      // tour's URL.
      if (typeof window === "undefined" || !window.history) return;
      const tid = deps.store.getState().currentTourId;
      if (tid === null) return;
      const url = composeUrl(tid, annotationId);
      const current =
        window.location.pathname + window.location.search + window.location.hash;
      if (url === current) return;
      window.history.replaceState(window.history.state, "", url);
    },
  };
}
