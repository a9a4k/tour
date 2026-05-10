import { queryAllAcrossShadow } from "./dom-walk.js";

/**
 * Soft-affordance hover layer (ADR 0012). Attaches a single delegated
 * `mouseover` / `mouseout` pair on `root` and toggles
 * `data-tour-hover="true"` on the hovered annotatable cell. The hover-
 * tint + "+" gutter pseudo-element CSS rules in `cursor-css.ts` key off
 * that attribute.
 *
 * Annotatable cells share `findAnnotatableLine`'s definition: any cell
 * with `data-line` AND a `data-line-type` of addition / deletion /
 * change-addition / change-deletion / context. Hunk headers, annotation
 * cards, and other non-annotatable rows are silently skipped.
 *
 * Composer-open suppression: when `composerOpen` is true the listeners
 * are still attached but the toggle is a no-op, AND any in-flight
 * `data-tour-hover` attributes are stripped immediately so the affordance
 * disappears the moment the composer opens (mouse motion mid-edit must
 * not tempt the reviewer to a different row).
 *
 * Returns a cleanup function that detaches the listeners and strips any
 * lingering `data-tour-hover` attributes — call it on effect teardown.
 */
export function syncHoverOverlay(root: ParentNode, composerOpen: boolean): () => void {
  if (composerOpen) clearHover(root);

  const onOver = (e: Event): void => {
    if (composerOpen) return;
    const cell = annotatableTargetFromEvent(e);
    if (!cell) return;
    cell.setAttribute("data-tour-hover", "true");
  };
  const onOut = (e: Event): void => {
    const cell = annotatableTargetFromEvent(e);
    if (!cell) return;
    cell.removeAttribute("data-tour-hover");
  };

  // Listeners on document so events from inside Pierre's open shadow
  // roots — which retarget at the host but still bubble in the composed
  // tree — reach a single delegated pair.
  const target = listenerTarget(root);
  target.addEventListener("mouseover", onOver);
  target.addEventListener("mouseout", onOut);

  return (): void => {
    target.removeEventListener("mouseover", onOver);
    target.removeEventListener("mouseout", onOut);
    clearHover(root);
  };
}

const ANNOTATABLE_TYPES = new Set([
  "addition",
  "deletion",
  "change-addition",
  "change-deletion",
  "context",
]);

function annotatableTargetFromEvent(e: Event): HTMLElement | null {
  const path = e.composedPath();
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.dataset.line === undefined) continue;
    const type = node.dataset.lineType;
    if (!type || !ANNOTATABLE_TYPES.has(type)) return null;
    return node;
  }
  return null;
}

function listenerTarget(root: ParentNode): EventTarget {
  // Document is the natural anchor: composed events from open shadow roots
  // (Pierre's per-file scope) bubble up to it. Falls back to root for
  // detached fixtures (tests that hand in a non-document ParentNode).
  if (root instanceof Document) return root;
  if (root instanceof Element) return root.ownerDocument ?? root;
  return root as unknown as EventTarget;
}

function clearHover(root: ParentNode): void {
  for (const el of queryAllAcrossShadow(root, "[data-tour-hover]")) {
    el.removeAttribute("data-tour-hover");
  }
}
