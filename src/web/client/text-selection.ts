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

export function recordTextSelectionMouseDown(
  state: TextSelectionDragState,
  event: Pick<MouseEvent, "target" | "clientX" | "clientY">,
): void {
  state.active =
    event.target instanceof Element &&
    event.target.closest(`.${TEXT_SELECTABLE_CLASS}`) !== null;
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
