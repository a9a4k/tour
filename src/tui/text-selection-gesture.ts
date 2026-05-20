import type { MouseEvent } from "@opentui/core";

type ActivationMouseEvent = Pick<
  MouseEvent,
  "button" | "isDragging" | "stopPropagation" | "target"
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

  return {
    onMouseDown(event) {
      if (!startsTextSelection(event)) {
        pendingTextClick = false;
        dragged = false;
        activate(event);
        return;
      }

      pendingTextClick = true;
      dragged = false;
      event.stopPropagation();
    },

    onMouseDrag(event) {
      if (!pendingTextClick) return;
      dragged = true;
      event?.stopPropagation();
    },

    onMouseUp(event) {
      if (!pendingTextClick) return;
      const shouldActivate = !dragged && event?.isDragging !== true;
      pendingTextClick = false;
      dragged = false;
      event?.stopPropagation();
      if (shouldActivate) activate(event);
    },
  };
}
