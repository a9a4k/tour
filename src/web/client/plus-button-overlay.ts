import { queryAllAcrossShadow, shadowRootsDeep } from "./dom-walk.js";

/**
 * Mounts a real-DOM `<button class="tour-plus-button">` next to every cell
 * currently flagged `data-tour-cursor="true"`. Click on the button calls
 * `onClick` with the cell's anchor — `{ file, side, line }` — derived from
 * the file's `[data-file]` ancestor, the cell's `data-tour-cursor-side`,
 * and the cell's `data-line`.
 *
 * The button is the GitHub-style affordance from PRD #136 — it is the only
 * mouse path to the top-level Annotation composer. Row clicks no longer
 * open the composer; they only move the cursor (App.tsx). Keyboard `a`
 * remains a one-step path through `openTopLevelComposer`.
 *
 * The hover-driven mount path was removed: the JS plumbing (per-event
 * listeners on document, MutationObserver-driven mount, attribute drift
 * between cell and closure state) was a recurring source of paint lag
 * and stuck-on rows. The cursor is the single trigger now; mouse users
 * click a row to anchor it, then click `+`.
 *
 * Composer-open suppression: when `composerOpen=true`, the overlay is a
 * complete no-op (no observers, no buttons). The prior effect's cleanup
 * has already stripped any buttons mounted during the composerOpen=false
 * phase, so mouse motion mid-edit cannot tempt the reviewer to a
 * different row.
 *
 * Returns a cleanup function that detaches MutationObservers and removes
 * every mounted button.
 */
export function syncPlusButtonOverlay(
  root: ParentNode,
  onClick: (anchor: { file: string; side: "additions" | "deletions"; line: number }) => void,
  composerOpen: boolean,
): () => void {
  if (composerOpen) return () => {};

  const buttons = new Map<HTMLElement, HTMLButtonElement>();
  const observers: MutationObserver[] = [];

  // Persistent mount: once a cell has carried `data-tour-cursor` we leave
  // the button in the DOM permanently and let the cursor-attribute CSS
  // show rule (cursor-css.ts) toggle visibility. Mount-and-tear-down per
  // attribute flip churned compositor layers (transform + z-index promote
  // each `+` to its own layer). The attribute-removal case is now a
  // CSS-only display flip — zero JS work, zero DOM mutation.
  const addOrUpdate = (cell: HTMLElement): void => {
    if (!cell.hasAttribute("data-tour-cursor")) return;
    const anchor = anchorFor(cell);
    if (!anchor) return;
    let btn = buttons.get(cell);
    if (!btn) {
      btn = createButton();
      cell.appendChild(btn);
      buttons.set(cell, btn);
    }
    btn.onclick = (e) => {
      // Stop the row-click handler from also firing on this click — the
      // two-step contract requires only the `+` press opens the composer,
      // so a bubble to onWrapperClick (which now seeds the cursor) would
      // redundantly re-seed at the same anchor. Stops bubbling, allowing
      // the click target itself to remain unambiguous to assistive tech.
      e.stopPropagation();
      onClick(anchor);
    };
  };

  // MutationObservers don't cross shadow-root boundaries, so install one
  // per scope: the root itself, plus every shadow root reachable from it
  // at attach time. Pierre attaches its shadow roots when the file block
  // mounts; this overlay re-attaches on bundle-reload (App.tsx useEffect
  // deps), so newly-attached shadow roots are picked up on the next sync.
  const observe = (target: Node): void => {
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type !== "attributes") continue;
        const t = r.target;
        if (!(t instanceof HTMLElement)) continue;
        addOrUpdate(t);
      }
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["data-tour-cursor", "data-tour-cursor-side"],
      subtree: true,
    });
    observers.push(observer);
  };

  observe(root);
  for (const sr of shadowRootsDeep(root)) observe(sr);

  for (const cell of queryAllAcrossShadow(root, "[data-tour-cursor]")) {
    addOrUpdate(cell as HTMLElement);
  }

  return (): void => {
    for (const o of observers) o.disconnect();
    for (const btn of buttons.values()) btn.remove();
    buttons.clear();
  };
}

function createButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tour-plus-button";
  btn.textContent = "+";
  btn.setAttribute("aria-label", "Add comment on this line");
  return btn;
}

function anchorFor(
  cell: HTMLElement,
): { file: string; side: "additions" | "deletions"; line: number } | null {
  const file = findFile(cell);
  if (!file) return null;
  const lineRaw = cell.dataset.line;
  if (lineRaw === undefined) return null;
  const line = Number(lineRaw);
  if (!Number.isFinite(line)) return null;
  const side = cell.getAttribute("data-tour-cursor-side");
  if (side !== "additions" && side !== "deletions") return null;
  return { file, side, line };
}

function findFile(cell: HTMLElement): string | null {
  // Walk up the composed tree, crossing shadow-root boundaries via
  // `host`, to find the nearest `[data-file]` ancestor. Pierre attaches
  // an open shadow root per file, so the `[data-file]` block lives in
  // the light tree above it.
  let node: Node | null = cell;
  while (node) {
    if (node instanceof HTMLElement) {
      const f = node.dataset.file;
      if (f !== undefined) return f;
    }
    const parent = node.parentNode;
    if (parent instanceof ShadowRoot) {
      node = parent.host;
    } else {
      node = parent;
    }
  }
  return null;
}
