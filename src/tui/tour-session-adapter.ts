import { TourWatcher } from "../core/watcher.js";
import type {
  ScrollRowAnchor,
  TourEventHandler,
  TourSessionAdapter,
} from "../core/tour-session-runtime.js";
import type { TourBundle } from "../core/tour-bundle.js";
import type { ReplyLock } from "../core/reply-lock.js";
import type { Annotation } from "../core/types.js";
import type { ScrollPlacement } from "../core/tour-session.js";
import type { WriteAnnotationInput } from "../core/write-annotation-input.js";

// TUI substrate dependencies the adapter needs. Sourced from `StartTuiProps`
// (loadTour / loadReplyLock / writeAnnotation) and the surface's `cwd`.
// Methods that touch OpenTUI scroll / sidebar / focus state arrive in later
// slices — stubbed here so the interface compiles.
export interface TuiTourSessionAdapterDeps {
  cwd: string;
  loadTour: (id: string) => Promise<TourBundle>;
  loadReplyLock: (id: string) => Promise<ReplyLock | null>;
  writeAnnotation: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
}

// `TourSessionAdapter` implemented against the TUI substrate. This slice
// wires only the methods needed for the watcher path
// (`fetchBundle` / `fetchReplyLock` / `subscribeTourEvents`); scroll /
// reveal / mirror methods are no-ops until later slices land their intent
// handlers. The URL mirrors are permanent no-ops — the TUI has no URL.
export function createTuiTourSessionAdapter(
  deps: TuiTourSessionAdapterDeps,
): TourSessionAdapter {
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
    scrollToCard: (_id: string, _mode: ScrollPlacement) => {
      // Slice 6: wire to OpenTUI ScrollBoxRenderable.
    },
    scrollToRow: (_anchor: ScrollRowAnchor, _mode: ScrollPlacement) => {
      // Slice 6: wire to OpenTUI ScrollBoxRenderable.
    },
    scrollToPickerRow: (_idx: number) => {
      // Slice 6: wire to OpenTUI ScrollBoxRenderable.
    },
    revealFileInSidebar: (_file: string) => {
      // Slice 6.
    },
    mirrorTourUrl: () => {
      // TUI has no URL.
    },
    mirrorAnnUrl: () => {
      // TUI has no URL.
    },
  };
}
