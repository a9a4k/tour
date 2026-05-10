import { queryAllAcrossShadow, shadowRootsDeep } from "./dom-walk.js";

/**
 * Mounts a real-DOM `<button class="tour-plus-button">` next to every cell
 * currently flagged `data-tour-cursor="true"` or `data-tour-hover="true"`.
 * Click on the button calls `onClick` with the cell's anchor —
 * `{ file, side, line }` — derived from the file's `[data-file]` ancestor,
 * the cell's `data-tour-cursor-side` (cursor case) or `data-line-type`
 * (hover case), and the cell's `data-line`.
 *
 * The button is the GitHub-style affordance from PRD #136 — it is the only
 * mouse path to the top-level Annotation composer. Row clicks no longer
 * open the composer; they only move the cursor (App.tsx). Keyboard `a`
 * remains a one-step path through `openTopLevelComposer`.
 *
 * Composer-open suppression: when `composerOpen=true`, any existing buttons
 * are stripped immediately and subsequent attribute flips are ignored, so
 * mouse motion mid-edit cannot tempt the reviewer to a different row.
 *
 * Side derivation:
 *   - Cell carries `data-tour-cursor` → side comes from `data-tour-cursor-side`
 *     (single source of truth for the cursor anchor).
 *   - Cell carries only `data-tour-hover` → side derives from
 *     `data-line-type` via the same convention `findAnnotatableLine` uses
 *     (context → "additions"). Mirrors `sideFromLineType` in App.tsx.
 *
 * Returns a cleanup function that detaches MutationObservers and removes
 * every mounted button.
 */
export function syncPlusButtonOverlay(
  root: ParentNode,
  onClick: (anchor: { file: string; side: "additions" | "deletions"; line: number }) => void,
  composerOpen: boolean,
): () => void {
  // Composer-open suppression: the overlay is a complete no-op while the
  // composer is open — no observers, no buttons. The prior effect's
  // cleanup has already stripped any buttons mounted during the
  // composerOpen=false phase, so mouse motion mid-edit cannot tempt the
  // reviewer to a different row.
  if (composerOpen) return () => {};

  const buttons = new Map<HTMLElement, HTMLButtonElement>();
  const observers: MutationObserver[] = [];

  const addOrUpdate = (cell: HTMLElement): void => {
    if (!cell.hasAttribute("data-tour-cursor") && !cell.hasAttribute("data-tour-hover")) {
      const stale = buttons.get(cell);
      if (stale) {
        stale.remove();
        buttons.delete(cell);
      }
      return;
    }
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
      attributeFilter: ["data-tour-cursor", "data-tour-hover", "data-tour-cursor-side"],
      subtree: true,
    });
    observers.push(observer);
  };

  observe(root);
  for (const sr of shadowRootsDeep(root)) observe(sr);

  for (const cell of queryAllAcrossShadow(root, "[data-tour-cursor], [data-tour-hover]")) {
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
  const side = sideFor(cell);
  if (!side) return null;
  return { file, side, line };
}

function sideFor(cell: HTMLElement): "additions" | "deletions" | null {
  // Cursor side is the single source of truth when the cursor is anchored
  // here — the cursor-overlay sets it explicitly per ADR 0012's column-
  // disambiguation rule (issue #134). Falls through to data-line-type
  // when the cell is keyed only by hover.
  const cursorSide = cell.getAttribute("data-tour-cursor-side");
  if (cursorSide === "additions" || cursorSide === "deletions") return cursorSide;
  return sideFromLineType(cell.dataset.lineType);
}

// Mirror of App.tsx's sideFromLineType — context rows annotate as
// `additions` per ADR 0012. Kept duplicated rather than imported so this
// overlay stays a leaf module (App.tsx imports it, not the reverse).
function sideFromLineType(t: string | undefined): "additions" | "deletions" | null {
  if (t === "addition" || t === "change-addition") return "additions";
  if (t === "deletion" || t === "change-deletion") return "deletions";
  if (t === "context") return "additions";
  return null;
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

