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

declare const anchorTokenBrand: unique symbol;
export type AnchorToken = { readonly [anchorTokenBrand]: "AnchorToken" };

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
  writeCommentEdit(tourId: string, targetId: string, body: string): Promise<void>;
  /** ADR 0036 Slice D / issue #388. Appends a `comment.deleted` event via
   *  the `createDelete` write seam. Humans-only enforced at the seam — the
   *  TUI / webapp only ever call this for human deletes. */
  deleteComment(args: { tourId: string; targetId: string }): Promise<void>;
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
  captureAnchor(rowId: string): AnchorToken | null;
  applyAnchor(token: AnchorToken): void;
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
 * intent; URL-driven opens now enter through `tour.openedFromUrl`.
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
        case "applyPostSubmitLanding":
          // Issue #392 + #405: split the optimistic bundle fold AND the
          // cursor re-anchor off the same render cycle that closes the
          // composer overlay. The original #392 bug: when an absolute-
          // positioned overlay (`<Composer>`) unmounts while a sibling
          // subtree in the diff scrollbox grows, opentui's yoga layout
          // pass leaves the affected file's content empty — diff rows
          // vanish below the parent's anchor, the new card doesn't
          // render. Symptom is purely visual; disk state and React
          // state are both correct.
          //
          // Fix: defer the bundle + cursor dispatch enough for opentui
          // to fully render + reflow the composer-close commit first.
          // `queueMicrotask` and `setTimeout(0)` (one macrotask) are
          // both insufficient — empirically verified that 16 ms is also
          // too short and 50 ms is the floor that consistently lands
          // the second commit after the first has fully painted.
          // opentui's renderer doesn't expose a post-paint signal we
          // can subscribe to, so a small timer is the pragmatic fix
          // until that primitive lands (or opentui resolves the
          // underlying yoga interaction).
          //
          // Issue #322's goal (no SSE-roundtrip latency before the new
          // card appears) is still preserved: 50 ms is well under the
          // watcher's ~500-600 ms RTT and is sub-perceptual.
          //
          // Issue #405: the cursor re-anchor was previously dispatched
          // synchronously by `composer.submitted`, which created a
          // ~50 ms window in which the cursor pointed at a Comment id
          // not yet in `bundle.comments`. The cursor-reconcile
          // useEffect in App.tsx observed the orphan CardAnchor and
          // cleared the cursor. Bundling the cursor write into the
          // same dispatch as the bundle fold (atomic-landing action)
          // closes the race — there is no commit where cursor.commentId
          // is orphan from bundle.comments.
          setTimeout(() => {
            this.store.dispatch({
              type: "bundle.commentInsertedWithLanding",
              comment: intent.comment,
              preferredSide: intent.preferredSide,
            });
          }, 50);
          return;
        case "scrollToComposer":
          this.adapter.scrollToComposer(intent.target);
          return;
        case "reanchorApply":
          this.adapter.applyAnchor(intent.token);
          return;
        case "mirrorUrl":
          this.adapter.mirrorTourUrl(intent.tourId);
          return;
        case "mirrorAnnUrl":
          this.adapter.mirrorAnnUrl(intent.commentId);
          return;
        case "selectSidebarFile":
          // Nullable reducer intent means "no cursor file"; the existing
          // adapter seam only reveals concrete file rows.
          if (intent.file === null) return;
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
        case "requestEdit":
          void this.handleRequestEdit(intent.tourId, intent.targetId, intent.body);
          return;
        case "deleteComment":
          // ADR 0036 Slice D / issue #388. Realises the `deleteComment`
          // intent by calling the adapter's `deleteComment` seam (which
          // wraps `createDelete`). On success dispatches
          // `deleteConfirm.succeeded`; on rejection dispatches
          // `deleteConfirm.failed` so the modal flips to errored and the
          // user can retry. The watcher's `comment-changed` event drives
          // the bundle refresh that surfaces the C4-cascaded projection.
          void this.handleDeleteComment(intent.tourId, intent.targetId);
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
    const state = this.store.getState();
    if (state.currentTourId !== tourId) return;
    this.store.dispatch({
      type: "tour.switched",
      tourId,
      bundle,
      ...(state.pendingAnnId !== null ? { annId: state.pendingAnnId } : {}),
    });

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
  // `composer.submitted` (the reducer emits `applyPostSubmitLanding`,
  // which this runtime defers ~50 ms and turns into the atomic
  // `bundle.commentInsertedWithLanding` dispatch — issue #405); on
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

  private async handleRequestEdit(
    tourId: string,
    targetId: string,
    body: string,
  ): Promise<void> {
    try {
      await this.adapter.writeCommentEdit(tourId, targetId, body);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.store.dispatch({ type: "composer.editFailed", error });
      return;
    }
    this.store.dispatch({ type: "composer.editSubmitted" });
    try {
      const bundle = await this.adapter.fetchBundle(tourId);
      if (this.store.getState().currentTourId !== tourId) return;
      this.store.dispatch({ type: "bundle.refreshed", bundle });
    } catch {
      // transient — watcher refresh can still surface the edit
    }
  }

  // ADR 0036 Slice D / issue #388. Realises `deleteComment` via the
  // adapter; success dispatches `deleteConfirm.succeeded`, failure
  // dispatches `deleteConfirm.failed` (modal flips to errored — Enter
  // retries, Esc dismisses). The watcher's `comment-changed` event
  // drives the projected (cascaded) bundle refresh.
  private async handleDeleteComment(
    tourId: string,
    targetId: string,
  ): Promise<void> {
    try {
      await this.adapter.deleteComment({ tourId, targetId });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.store.dispatch({ type: "deleteConfirm.failed", error });
      return;
    }
    this.store.dispatch({ type: "deleteConfirm.succeeded", targetId });
  }

  // Realises the `revalidateCursor` intent (PRD #278 slice 5). Projection
  // reshapes can fire before React re-renders, so any surface closure over
  // the prior flat-rows would be stale. The runtime reads `store.getState()`
  // directly and re-derives the view pure-fn against the fresh bundle + state,
  // then dispatches `cursor.set` (anchor changed), `cursor.clear` (anchor went
  // null), or no-ops (anchor still resolves to the same ref).
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
