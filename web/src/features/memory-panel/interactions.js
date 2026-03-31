// @ts-check

const DRAG_CLOSE_GUARD_THRESHOLD_PX = 8;

/**
 * @typedef {{
 *  start?: {x:number, y:number} | null,
 *  end?: {x:number, y:number} | null,
 *  thresholdPx?: number,
 * }} DragInput
 */

/**
 * @typedef {{
 *  isPanelOpen?: boolean,
 *  targetInsidePanel?: boolean,
 *  targetIsMemorySelection?: boolean,
 *  interactionWasDrag?: boolean,
 * }} PanelClickInput
 */

/** @param {DragInput} input */
function interactionWasDrag(input) {
  if (!input?.start || !input?.end) return false;

  const deltaX = input.end.x - input.start.x;
  const deltaY = input.end.y - input.start.y;
  const distance = Math.hypot(deltaX, deltaY);
  const threshold = input.thresholdPx ?? DRAG_CLOSE_GUARD_THRESHOLD_PX;
  return distance > threshold;
}

/** @param {PanelClickInput} input */
function shouldCloseMemoryPanelOnClick(input) {
  if (!input?.isPanelOpen) return false;
  if (input.targetInsidePanel) return false;
  if (input.targetIsMemorySelection) return false;
  if (input.interactionWasDrag) return false;
  return true;
}

export { DRAG_CLOSE_GUARD_THRESHOLD_PX, interactionWasDrag, shouldCloseMemoryPanelOnClick };
