/**
 * `querySelectorAll` that descends into open shadow roots. Pierre attaches
 * an open shadow root per file, so the cursor DOM walkers
 * (`cursor-rows.ts`, `cursor-overlay.ts`) have to cross that boundary to
 * reach the rendered `[data-line]` cells.
 *
 * Uses a TreeWalker to discover shadow-root hosts in a single linear pass
 * instead of the prior `[node, ...node.querySelectorAll("*")]` spread,
 * which materialised the descendant set twice per scope and dominated
 * input latency on large diffs.
 */
export function queryAllAcrossShadow(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [];
  const stack: ParentNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const el of node.querySelectorAll(selector)) out.push(el);
    for (const sr of shadowRootsIn(node)) stack.push(sr);
  }
  return out;
}

/**
 * Yield every open shadow root reachable from `node` without crossing
 * shadow boundaries (the caller recurses). Iterates the live NodeList
 * from `querySelectorAll("*")` directly so we don't materialise the
 * whole descendant set into an Array — the prior `[node, ...]` spread
 * was the dominant cost on large diffs.
 */
export function shadowRootsIn(node: ParentNode): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  if (node instanceof Element) {
    const self = (node as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (self) out.push(self);
  }
  const all = node.querySelectorAll("*");
  for (const el of all) {
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) out.push(sr);
  }
  return out;
}

/**
 * Every open shadow root reachable from `node`, recursing across shadow
 * boundaries. Use when callers need to install per-scope listeners /
 * observers (which don't cross shadow-DOM boundaries) on every shadow
 * scope under `node`.
 */
export function shadowRootsDeep(node: ParentNode): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const stack: ParentNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const sr of shadowRootsIn(cur)) {
      out.push(sr);
      stack.push(sr);
    }
  }
  return out;
}
