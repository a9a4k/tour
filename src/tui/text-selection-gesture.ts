import type { MouseEvent } from "@opentui/core";

type ActivationMouseEvent = Pick<
  MouseEvent,
  "button" | "isDragging" | "stopPropagation" | "target" | "x" | "y"
>;

export interface TextSelectionSafeActivation {
  onMouseDown: (event?: ActivationMouseEvent) => void;
  onMouseDrag: (event?: ActivationMouseEvent) => void;
  onMouseUp: (event?: ActivationMouseEvent) => void;
}

function startsTextSelection(event: ActivationMouseEvent | undefined): boolean {
  if (!event) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  return event.target?.selectable === true;
}

export function textSelectionSafeActivation(
  activate: (event?: ActivationMouseEvent) => void,
): TextSelectionSafeActivation {
  let pendingTextClick = false;
  let dragged = false;
  let startX: number | undefined;
  let startY: number | undefined;

  return {
    onMouseDown(event) {
      if (!startsTextSelection(event)) {
        pendingTextClick = false;
        dragged = false;
        startX = undefined;
        startY = undefined;
        activate(event);
        return;
      }

      pendingTextClick = true;
      dragged = false;
      startX = event.x;
      startY = event.y;
      event.stopPropagation();
    },

    onMouseDrag(event) {
      if (!pendingTextClick) return;
      dragged = true;
      event?.stopPropagation();
    },

    onMouseUp(event) {
      if (!pendingTextClick) return;
      const movementKnown =
        startX !== undefined &&
        startY !== undefined &&
        event?.x !== undefined &&
        event.y !== undefined;
      const moved =
        movementKnown && (event.x !== startX || event.y !== startY);
      const shouldActivate =
        !dragged && (event?.isDragging !== true || movementKnown && !moved);
      pendingTextClick = false;
      dragged = false;
      startX = undefined;
      startY = undefined;
      event?.stopPropagation();
      if (shouldActivate) activate(event);
    },
  };
}
