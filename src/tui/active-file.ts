import type { ScrollBoxRenderable } from "@opentui/core";

/**
 * Issue #307: the TUI's diff pane renders one always-visible "active file"
 * header above the scrollbox. The active file is derived from scroll
 * position (NOT cursor, NOT sidebar selection) — synthesising GitHub's
 * `position: sticky` semantics in OpenTUI, which has no equivalent
 * layout primitive.
 *
 * The derivation is pure: it takes `scrollTop` and a list of per-file-card
 * `{name, contentY, height}` tuples (sorted by render order) and returns
 * the active file's name. The impure half (`collectFileCardOffsets`) walks
 * the scrollbox's renderable tree and harvests the tuples.
 */
export interface FileCardOffset {
  name: string;
  contentY: number;
  height: number;
}

/**
 * GitHub's "previous-file stays sticky until the next reaches the top":
 * the active file is the LAST card whose top edge is at or above the
 * viewport top. Two fallbacks for the edges:
 *  - above the first card's top → first card
 *  - below the last card's bottom → last card
 * Returns `null` for the empty case.
 *
 * `cards` is expected to be ordered by `contentY` (the render order of
 * the diff stream); behaviour for an unsorted list is unspecified.
 */
export function deriveActiveFile(
  scrollTop: number,
  cards: ReadonlyArray<FileCardOffset>,
): string | null {
  if (cards.length === 0) return null;
  if (scrollTop < cards[0].contentY) return cards[0].name;
  let active = cards[0];
  for (const c of cards) {
    if (c.contentY <= scrollTop) active = c;
    else break;
  }
  return active.name;
}

type Node = {
  id?: string;
  y?: number;
  height?: number;
  getChildren?: () => unknown[];
  updateFromLayout?: () => void;
};

/**
 * Walk `sb`'s renderable tree and collect `{contentY, height}` for each
 * `file-card-${name}` node. Returns a list in the input `fileNames`
 * order (matching diff-pane render order) so the derivation upstream
 * doesn't have to re-sort.
 *
 * Mirrors `buildRowYResolver`'s coord-translation: opentui's `child.y`
 * is screen-absolute (same space as `viewport.y`), so contentY =
 * `screenY - viewport.y + scrollTop`. `updateFromLayout()` is called on
 * each visited node so a culled subtree (viewportCulling=true) reports
 * fresh Yoga positions; the call is per-frame guarded inside opentui so
 * already-fresh nodes are a no-op.
 */
export function collectFileCardOffsets(
  sb: ScrollBoxRenderable,
  fileNames: ReadonlyArray<string>,
): FileCardOffset[] {
  const viewportY = sb.viewport.y;
  const scrollTop = sb.scrollTop;
  const wanted = new Map<string, string>();
  for (const name of fileNames) wanted.set(`file-card-${name}`, name);
  const found = new Map<string, FileCardOffset>();
  const stack: Node[] = [sb.content as unknown as Node];
  while (stack.length > 0 && found.size < wanted.size) {
    const node = stack.pop()!;
    node.updateFromLayout?.();
    const id = node.id;
    const name = id ? wanted.get(id) : undefined;
    if (name) {
      const screenY = typeof node.y === "number" ? node.y : 0;
      const height = typeof node.height === "number" ? node.height : 0;
      found.set(name, {
        name,
        contentY: screenY - viewportY + scrollTop,
        height,
      });
    }
    const kids = node.getChildren?.() ?? [];
    for (const c of kids) stack.push(c as Node);
  }
  const out: FileCardOffset[] = [];
  for (const name of fileNames) {
    const c = found.get(name);
    if (c) out.push(c);
  }
  return out;
}
