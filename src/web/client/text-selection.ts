export const TEXT_SELECTABLE_CLASS = "tour-text-selectable";

export interface TextSelectionDragState {
  active: boolean;
  dragged: boolean;
  startX: number;
  startY: number;
}

const DRAG_THRESHOLD_PX = 4;

export function createTextSelectionDragState(): TextSelectionDragState {
  return { active: false, dragged: false, startX: 0, startY: 0 };
}

function closestSelectableElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target.closest(`.${TEXT_SELECTABLE_CLASS}`);
  }
  if (target instanceof Node && target.parentElement) {
    return target.parentElement.closest(`.${TEXT_SELECTABLE_CLASS}`);
  }
  return null;
}

export function recordTextSelectionMouseDown(
  state: TextSelectionDragState,
  event: Pick<MouseEvent, "target" | "clientX" | "clientY">,
): void {
  state.active = closestSelectableElement(event.target) !== null;
  state.dragged = false;
  state.startX = event.clientX;
  state.startY = event.clientY;
}

export function recordTextSelectionMouseMove(
  state: TextSelectionDragState,
  event: Pick<MouseEvent, "clientX" | "clientY">,
): void {
  if (!state.active) return;
  const dx = Math.abs(event.clientX - state.startX);
  const dy = Math.abs(event.clientY - state.startY);
  if (dx >= DRAG_THRESHOLD_PX || dy >= DRAG_THRESHOLD_PX) {
    state.dragged = true;
  }
}

export function consumeTextSelectionDrag(
  state: TextSelectionDragState,
): boolean {
  const dragged = state.active && state.dragged;
  state.active = false;
  state.dragged = false;
  return dragged;
}
