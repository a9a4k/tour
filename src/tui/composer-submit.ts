import type { Annotation } from "../core/types.js";
import type { TourBundle } from "../core/tour-bundle.js";
import type { ComposerState } from "./composer-state.js";
import type { WriteAnnotationInput } from "./app.js";

/**
 * Arguments for a single composer submit attempt. The submitter dismisses
 * the composer synchronously (before any awaits) so a rapid second Enter
 * cannot deliver to the still-focused <input> — see issue #159.
 *
 * `bundle` rides along for the top-level write so the annotations-store
 * doesn't have to reload the same TourBundle the TUI is already rendering
 * (PRD #140, slice 4 #144).
 */
export interface ComposerSubmitArgs {
  composer: ComposerState | null;
  body: string;
  tourId: string;
  bundle: TourBundle;
  writeAnnotation?: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
  loadTour?: (tourId: string) => Promise<TourBundle>;
  dismiss: () => void;
  applyBundleReload?: (bundle: TourBundle) => void;
  applyTopLevelCreated?: (id: string) => void;
}

/**
 * Build a reentrant-safe submit function for the TUI Composer.
 *
 * The returned function closes over a single in-flight flag. While a submit
 * is awaiting the disk write + bundle reload, further invocations return
 * immediately as no-ops — the second Enter is silently dropped, matching
 * issue #159's acceptance criterion: exactly one annotation per Enter
 * press regardless of how fast the user presses Enter.
 *
 * Two layers of defence:
 *   1. Synchronous `dismiss()` before the first await — unmounts the
 *      focused <input> on the next React render so most second-Enter
 *      events never even reach this function.
 *   2. Module-internal `inFlight` flag — catches the racy case where a
 *      second Enter slips in before React's render flushes (different
 *      event loops / batching strategies can blur the timing).
 *
 * If `writeAnnotation` throws, the composer stays dismissed (draft lost,
 * matches the previous `finally`-block behavior) and the flag is cleared
 * so a follow-up submit isn't stuck.
 */
export function createComposerSubmitter(): (args: ComposerSubmitArgs) => Promise<void> {
  let inFlight = false;
  return async (args) => {
    if (inFlight) return;
    if (!args.composer) return;
    const trimmed = args.body.trim();
    // Empty submissions are silently treated as cancel — no zero-length notes.
    // No in-flight set: this path is fully synchronous, so it cannot race
    // with itself.
    if (trimmed.length === 0 || !args.writeAnnotation) {
      args.dismiss();
      return;
    }
    inFlight = true;
    args.dismiss();
    try {
      const c = args.composer;
      if (c.kind === "top-level") {
        const created = await args.writeAnnotation(args.tourId, {
          kind: "top-level",
          file: c.file,
          side: c.side,
          line_start: c.line_start,
          line_end: c.line_end,
          body: trimmed,
          bundle: args.bundle,
        } as WriteAnnotationInput);
        args.applyTopLevelCreated?.(created.id);
      } else {
        await args.writeAnnotation(args.tourId, {
          kind: "reply",
          parent: c.parent,
          body: trimmed,
        });
      }
      if (args.loadTour && args.applyBundleReload) {
        const refreshed = await args.loadTour(args.tourId);
        args.applyBundleReload(refreshed);
      }
    } catch {
      // Composer is already dismissed; the draft is lost. Matches the
      // previous finally-block behavior in app.tsx — acceptance criterion
      // #5 of issue #159.
    } finally {
      inFlight = false;
    }
  };
}
