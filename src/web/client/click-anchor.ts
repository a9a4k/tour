// Resolve a row click on the rendered diff DOM to a semantic Annotation
// anchor. Pure: takes the event's composedPath() array, returns the
// {lineNumber, side} the click should seed the Line cursor with, or null
// if the click missed every annotatable row.
//
// See ADR 0012 (Revisions) and CONTEXT.md "Side" entry: in split layout
// a context row is addressable on EITHER column — clicked column wins.

export type Anchor = {
  lineNumber: number;
  side: "additions" | "deletions";
};

export function resolveClickAnchor(path: EventTarget[]): Anchor | null {
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (!(node instanceof HTMLElement)) continue;
    const rawLine = node.dataset.line;
    if (rawLine === undefined) continue;
    const lineNumber = Number(rawLine);
    if (!Number.isFinite(lineNumber)) return null;
    const lineType = node.dataset.lineType;
    const side = resolveSide(lineType, path, i);
    if (!side) return null;
    return { lineNumber, side };
  }
  return null;
}

function resolveSide(
  lineType: string | undefined,
  path: EventTarget[],
  fromIndex: number,
): "additions" | "deletions" | null {
  if (lineType === "addition" || lineType === "change-addition") return "additions";
  if (lineType === "deletion" || lineType === "change-deletion") return "deletions";
  if (lineType === "context") return columnSideFromPath(path, fromIndex) ?? "additions";
  return null;
}

function columnSideFromPath(
  path: EventTarget[],
  fromIndex: number,
): "additions" | "deletions" | null {
  for (let i = fromIndex; i < path.length; i++) {
    const node = path[i];
    if (!(node instanceof HTMLElement)) continue;
    if (node.hasAttribute("data-deletions")) return "deletions";
    if (node.hasAttribute("data-additions")) return "additions";
  }
  return null;
}
