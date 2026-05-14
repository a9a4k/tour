import type { TourBundle } from "./tour-bundle.js";
import type { ReplyLock } from "./reply-lock.js";
import type { Annotation } from "./types.js";
import type {
  ScrollCursorTarget,
  ScrollPlacement,
  TourSessionStore,
} from "./tour-session.js";
import type { WriteAnnotationInput } from "./write-annotation-input.js";

// The TourEvent vocabulary is the existing watcher / SSE event set. The
// adapter normalises both the TUI's `TourWatcher` events and the web's
// `EventSource` messages into this shape so the runtime stays substrate-
// agnostic.
export type TourEvent =
  | { type: "annotation-changed" }
  | { type: "reply-in-flight" }
  | { type: "reply-cleared" };

export type TourEventHandler = (event: TourEvent) => void;

// Mirrors `Intent#scrollCursorTarget.target.kind === "row"` — extracted as
// a named type so the adapter signature reads naturally.
export type ScrollRowAnchor = Extract<ScrollCursorTarget, { kind: "row" }>;

// The seam between the runtime and each renderer substrate. The runtime
// depends only on this interface; concrete implementations live next to
// each surface (`src/tui/tour-session-adapter.ts`,
// `src/web/client/tour-session-adapter.ts`). Stub-OK methods exist on the
// interface for future slices — only `fetchBundle`, `fetchReplyLock`, and
// `subscribeTourEvents` are exercised in this slice.
export interface TourSessionAdapter {
  fetchBundle(id: string): Promise<TourBundle>;
  fetchReplyLock(id: string): Promise<ReplyLock | null>;
  writeAnnotation(tourId: string, input: WriteAnnotationInput): Promise<Annotation>;
  requestReply(args: { tourId: string; annotationId: string }): Promise<void>;
  subscribeTourEvents(tourId: string, handler: TourEventHandler): () => void;
  scrollToCard(id: string, mode: ScrollPlacement): void;
  scrollToRow(anchor: ScrollRowAnchor, mode: ScrollPlacement): void;
  scrollToPickerRow(idx: number): void;
  revealFileInSidebar(file: string): void;
  mirrorTourUrl(id: string): void;
  mirrorAnnUrl(id: string | null): void;
}

/**
 * The impure half of the Tour-session triple (reducer + view + runtime).
 * Subscribes to `store.onIntent` and to `adapter.subscribeTourEvents`;
 * realises tour events as reducer dispatches.
 *
 * This slice (PRD #278 slice 2) wires only the watcher path. Intent
 * realisation arrives in later slices.
 */
export class TourSessionRuntime {
  private intentUnsub: (() => void) | null = null;
  private stateUnsub: (() => void) | null = null;
  private eventUnsub: (() => void) | null = null;
  private subscribedTourId: string | null = null;

  constructor(
    private readonly store: TourSessionStore,
    private readonly adapter: TourSessionAdapter,
  ) {}

  /**
   * Wires the runtime to the store and adapter. Returns a teardown function
   * that releases every subscription. Idempotent across construct/start:
   * call once at App mount; call the returned teardown at unmount.
   */
  start(): () => void {
    // Reserved for slices 3-7 — intent handlers (loadTour, submitAnnotation,
    // scrollCursorTarget, ...) land here. Subscribed now so the listener
    // wiring lives in one place from birth.
    this.intentUnsub = this.store.onIntent(() => {});

    this.syncTourSubscription();
    this.stateUnsub = this.store.subscribe(() => this.syncTourSubscription());

    return () => {
      this.intentUnsub?.();
      this.intentUnsub = null;
      this.stateUnsub?.();
      this.stateUnsub = null;
      this.eventUnsub?.();
      this.eventUnsub = null;
      this.subscribedTourId = null;
    };
  }

  // Re-subscribes to the watcher when the current tour id changes. Other
  // state mutations (cursor moves, expansion, composer, ...) are no-ops.
  private syncTourSubscription(): void {
    const nextId = this.store.getState().currentTourId;
    if (nextId === this.subscribedTourId) return;
    this.eventUnsub?.();
    this.eventUnsub = null;
    this.subscribedTourId = nextId;
    if (nextId === null) return;
    this.eventUnsub = this.adapter.subscribeTourEvents(nextId, (event) => {
      void this.handleTourEvent(nextId, event);
    });
  }

  private async handleTourEvent(tourId: string, event: TourEvent): Promise<void> {
    if (event.type === "annotation-changed") {
      try {
        const bundle = await this.adapter.fetchBundle(tourId);
        // Stale-tour guard: a tour-switch may have moved the store off
        // `tourId` while the fetch was in flight. Drop the dispatch — the
        // new tour's load handles its own bundle.
        if (this.store.getState().currentTourId !== tourId) return;
        this.store.dispatch({ type: "bundle.refreshed", bundle });
      } catch {
        // transient — keep current bundle
      }
      return;
    }
    // reply-in-flight | reply-cleared — lock is OUT of the bundle (PRD #135);
    // fetched separately so a lock change doesn't trigger a full hydrate.
    try {
      const lock = await this.adapter.fetchReplyLock(tourId);
      if (this.store.getState().currentTourId !== tourId) return;
      this.store.dispatch({ type: "replyLock.loaded", replyLock: lock });
    } catch {
      // transient — keep current pill state
    }
  }
}
