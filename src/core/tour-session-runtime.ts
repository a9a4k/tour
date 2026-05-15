import type { TourBundle } from "./tour-bundle.js";
import type { ReplyLock } from "./reply-lock.js";
import type { Comment } from "./types.js";
import {
  isBundleResolved,
  type ComposerTarget,
  type ScrollCursorTarget,
  type ScrollMotion,
  type ScrollPlacement,
  type TourSessionStore,
} from "./tour-session.js";
import {
  buildWriteCommentInput,
  type WriteCommentInput,
} from "./write-comment-input.js";
import { deriveTourSessionView, type ViewOptions } from "./tour-session-view.js";

// The TourEvent vocabulary is the existing watcher / SSE event set. The
// adapter normalises both the TUI's `TourWatcher` events and the web's
// `EventSource` messages into this shape so the runtime stays substrate-
// agnostic.
export type TourEvent =
  | { type: "comment-changed" }
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
  writeComment(tourId: string, input: WriteCommentInput): Promise<Comment>;
  requestReply(args: { tourId: string; commentId: string }): Promise<void>;
  subscribeTourEvents(tourId: string, handler: TourEventHandler): () => void;
  scrollToCard(id: string, placement: ScrollPlacement, behavior: ScrollMotion): void;
  scrollToRow(
    anchor: ScrollRowAnchor,
    placement: ScrollPlacement,
    behavior: ScrollMotion,
  ): void;
  /** Issue #320: pulls an in-flight Composer back into view (scroll +
   *  textarea focus). Dispatched by `composer.recall`. */
  scrollToComposer(target: ComposerTarget): void;
  scrollToPickerRow(idx: number): void;
  revealFileInSidebar(file: string): void;
  mirrorTourUrl(id: string): void;
  mirrorAnnUrl(id: string | null): void;
}

/**
 * The impure half of the Tour-session triple (reducer + view + runtime).
 * Subscribes to `store.onIntent` and to `adapter.subscribeTourEvents`;
 * realises intents and tour events as reducer dispatches.
 *
 * Slice 2 (PRD #278) wired the watcher path. Slice 3 wires the `loadTour`
 * intent — emitted by `picker.commit` and by `bundle.loading` (the action
 * popstate / auto-pick / initial mount dispatch).
 */
export class TourSessionRuntime {
  private intentUnsub: (() => void) | null = null;
  private stateUnsub: (() => void) | null = null;
  private eventUnsub: (() => void) | null = null;
  private subscribedTourId: string | null = null;

  constructor(
    private readonly store: TourSessionStore,
    private readonly adapter: TourSessionAdapter,
    // ViewOptions threaded through to `deriveTourSessionView` for the
    // `revalidateCursor` intent (PRD #278 slice 5). The TUI passes
    // `{ hunkHeaderCursorStop: false }`; the webapp uses defaults.
    private readonly viewOptions: ViewOptions = {},
  ) {}

  /**
   * Wires the runtime to the store and adapter. Returns a teardown function
   * that releases every subscription. Idempotent across construct/start:
   * call once at App mount; call the returned teardown at unmount.
   */
  start(): () => void {
    this.intentUnsub = this.store.onIntent((intent) => {
      switch (intent.type) {
        case "loadTour":
          void this.handleLoadTour(intent.tourId);
          return;
        case "submitComment":
          this.handleSubmitComment(intent.tourId, intent.target, intent.body);
          return;
        case "scrollPickerRow":
          this.adapter.scrollToPickerRow(intent.idx);
          return;
        case "scrollCursorTarget":
          if (intent.target.kind === "card") {
            this.adapter.scrollToCard(
              intent.target.commentId,
              intent.placement,
              intent.behavior,
            );
          } else {
            this.adapter.scrollToRow(intent.target, intent.placement, intent.behavior);
          }
          return;
        case "scrollToComment":
          // Post-submit landing (composer.submitted → scrollToComment):
          // fresh card materialises into view; always center + instant
          // (PRD #348 — same shape as cursor.materialize).
          this.adapter.scrollToCard(intent.commentId, "center", "instant");
          return;
        case "scrollToComposer":
          this.adapter.scrollToComposer(intent.target);
          return;
        case "mirrorUrl":
          this.adapter.mirrorTourUrl(intent.tourId);
          return;
        case "mirrorAnnUrl":
          this.adapter.mirrorAnnUrl(intent.commentId);
          return;
        case "selectSidebarFile":
          // Sidebar selection only — issue #310 split out the implicit
          // `folds.setOverride { value: false }` that turned a `j`/`k`
          // traversal into a classifier-collapsed file into an unwanted
          // auto-unfold (560+ rows of lockfile churn appear, cursor parks
          // on row 1). Explicit-reveal callsites (sidebar click, n/p
          // comment jump, URL `?ann=` restore) dispatch `folds.setOverride`
          // themselves alongside the `cursor.set`, mirroring the existing
          // pattern for comment navigation.
          this.adapter.revealFileInSidebar(intent.file);
          return;
        case "revalidateCursor":
          this.handleRevalidateCursor();
          return;
        case "requestReply":
          // Fire-and-forget — the watcher's reply-* events drive the in-flight
          // pill and the landed Reply Comment. Adapter rejections are
          // swallowed at the seam (transient transport failures shouldn't
          // escape to the React layer). PRD #278 slice 7.
          this.adapter
            .requestReply({ tourId: intent.tourId, commentId: intent.commentId })
            .catch(() => {
              // transient — the watcher's reload surfaces any state change
            });
          return;
      }
    });

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

  // Realises the `loadTour` intent (PRD #278 slice 3). Fetches the bundle,
  // dispatches `tour.switched` on success (the reducer's branch owns the
  // CONTEXT-pinned reset cascade — picker / replyLock / cursor / expansion /
  // composer / folds), then fetches the reply-lock and dispatches
  // `replyLock.loaded`. On fetchBundle failure dispatches `bundle.failed`.
  // Reply-lock fetch errors are swallowed (transient — keep current pill
  // state; the tour-switched reset already moved replyLock to idle).
  //
  // Stale-tour guard: every dispatch is gated on the store's current tour
  // still matching `tourId`. A loadTour for tour A whose fetch resolves
  // after the user switched to tour B is dropped — the new tour's load
  // owns its own bundle / lock.
  private async handleLoadTour(tourId: string): Promise<void> {
    let bundle: TourBundle;
    try {
      bundle = await this.adapter.fetchBundle(tourId);
    } catch (e) {
      if (this.store.getState().currentTourId !== tourId) return;
      const error = e instanceof Error ? e.message : String(e);
      this.store.dispatch({ type: "bundle.failed", tourId, error });
      return;
    }
    if (this.store.getState().currentTourId !== tourId) return;
    this.store.dispatch({ type: "tour.switched", tourId, bundle });

    let lock: ReplyLock | null;
    try {
      lock = await this.adapter.fetchReplyLock(tourId);
    } catch {
      // transient — keep current pill state
      return;
    }
    if (this.store.getState().currentTourId !== tourId) return;
    this.store.dispatch({ type: "replyLock.loaded", replyLock: lock });
  }

  // Realises the `submitComment` intent (PRD #278 slice 4). Trim-and-
  // reject for whitespace-only bodies (PRD #140 — every surface treats an
  // empty submit as cancel, not a disk write). Resolves the reply parent
  // (or attaches the live bundle for top-level) via the shared
  // `buildWriteCommentInput` builder so both surfaces converge on the
  // same `WriteCommentInput` shape. On success dispatches
  // `composer.submitted` (the reducer emits `scrollToComment`); on
  // rejection dispatches `composer.failed`.
  private handleSubmitComment(
    tourId: string,
    target: ComposerTarget,
    body: string,
  ): void {
    if (body.trim().length === 0) {
      this.store.dispatch({ type: "composer.close" });
      return;
    }
    const liveBundle = isBundleResolved(this.store.getState());
    if (!liveBundle) {
      this.store.dispatch({
        type: "composer.failed",
        error: "Tour bundle is no longer loaded",
      });
      return;
    }
    const built = buildWriteCommentInput({ target, body, bundle: liveBundle });
    if (built.kind === "parent-missing") {
      this.store.dispatch({
        type: "composer.failed",
        error: "Parent comment no longer exists",
      });
      return;
    }
    void this.writeCommentAndDispatch(tourId, built.input);
  }

  private async writeCommentAndDispatch(
    tourId: string,
    input: WriteCommentInput,
  ): Promise<void> {
    let created: Comment;
    try {
      created = await this.adapter.writeComment(tourId, input);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.store.dispatch({ type: "composer.failed", error });
      return;
    }
    this.store.dispatch({ type: "composer.submitted", comment: created });
  }

  // Realises the `revalidateCursor` intent (PRD #278 slice 5). Fires
  // synchronously inside `bundle.refreshed`'s dispatch — React hasn't
  // re-rendered, so any surface closure over the prior flat-rows would be
  // stale. The runtime reads `store.getState()` directly and re-derives the
  // view pure-fn against the fresh bundle + state, then dispatches
  // `cursor.set` (anchor changed) / `cursor.clear` (anchor went null) /
  // no-op (anchor still resolves to the same ref).
  private handleRevalidateCursor(): void {
    const state = this.store.getState();
    const cursor = state.cursor;
    if (cursor === null) return;
    const bundle = isBundleResolved(state);
    if (!bundle || bundle.kind !== "ok") return;
    const fresh = deriveTourSessionView(bundle, state, this.viewOptions);
    if (fresh.kind !== "ok") return;
    const validated = fresh.cursor.anchor;
    if (validated === cursor) return;
    if (validated === null) {
      this.store.dispatch({ type: "cursor.clear" });
    } else {
      this.store.dispatch({ type: "cursor.set", anchor: validated });
    }
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
    if (event.type === "comment-changed") {
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
