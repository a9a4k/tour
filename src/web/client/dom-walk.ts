/**
 * `querySelectorAll` that descends into open shadow roots. Pierre attaches
 * an open shadow root per file, so the cursor DOM walkers
 * (`cursor-rows.ts`, `cursor-overlay.ts`) have to cross that boundary to
 * reach the rendered `[data-line]` cells.
 */
export function queryAllAcrossShadow(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [];
  const stack: ParentNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const el of node.querySelectorAll(selector)) out.push(el);
    const all =
      node instanceof Element
        ? [node, ...node.querySelectorAll("*")]
        : [...node.querySelectorAll("*")];
    for (const el of all) {
      const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (shadow) stack.push(shadow);
    }
  }
  return out;
}
