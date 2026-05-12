/**
 * Auto-recall for `r` / `s` on an off-screen Annotation card
 * (PRD #192 / ADR 0022 slice 2). When a card-targeting action fires and
 * the cursor's card is NOT fully in the viewport, smooth-scroll it to
 * centre BEFORE mounting the composer / dispatching the agent. The
 * action *reveals* its target as it commits.
 *
 * Sequencing:
 *   - Card already on-screen: fire `then()` synchronously, no scroll.
 *   - Card missing from DOM (defensive): fire `then()` synchronously.
 *   - Card off-screen: trigger `scrollIntoView({ block: "center",
 *     behavior: "smooth" })`, listen for the next `scrollend` event on
 *     `window`, and call `then()` when it fires. Browsers without
 *     `scrollend` support (Safari < 18 today) fall back to a 250 ms
 *     timeout so the composer / dispatch isn't deferred forever.
 *
 * The implementation guards against double-firing — only the first signal
 * (`scrollend` or timeout) calls `then()`; the other is cancelled.
 */
export function recallCardIntoView(args: {
  cardElement: HTMLElement | null;
  viewportHeight: number;
  then: () => void;
}): void {
  const { cardElement, viewportHeight, then } = args;
  if (!cardElement) {
    then();
    return;
  }
  const rect = cardElement.getBoundingClientRect();
  const inView = rect.top >= 0 && rect.bottom <= viewportHeight;
  if (inView) {
    then();
    return;
  }
  let fired = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    window.removeEventListener("scrollend", fire);
    clearTimeout(timer);
    then();
  };
  window.addEventListener("scrollend", fire, { once: true });
  const timer = setTimeout(fire, 250);
  cardElement.scrollIntoView({ block: "center", behavior: "smooth" });
}
