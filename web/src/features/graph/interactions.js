// @ts-check

const GRAPH_PAN_DRAG_THRESHOLD_PX = 6;

/** @typedef {'idle'|'tracking'|'panning'} GraphGesturePhase */

/**
 * @typedef {Object} GraphInteractionState
 * @property {GraphGesturePhase} phase
 * @property {number|null} activePointerId
 * @property {number|null} dragButton
 * @property {number} startX
 * @property {number} startY
 * @property {number} originTx
 * @property {number} originTy
 * @property {boolean} dragMoved
 */

/** @returns {GraphInteractionState} */
function createGraphInteractionState() {
  return {
    phase: 'idle',
    activePointerId: null,
    dragButton: null,
    startX: 0,
    startY: 0,
    originTx: 0,
    originTy: 0,
    dragMoved: false,
  };
}

/** @param {number} button */
function canStartGraphPan(button) {
  return button === 0 || button === 2;
}

/** @param {{ button?: number, shiftKey?: boolean }} input */
function shouldStartGraphPan(input) {
  if (!input) return false;
  if (input.button === 2 && input.shiftKey) return false;
  return canStartGraphPan(input.button ?? -1);
}

/**
 * @param {{
 *  start?: {x:number, y:number} | null,
 *  end?: {x:number, y:number} | null,
 *  thresholdPx?: number,
 * }} input
 */
function graphDragMoved(input) {
  if (!input?.start || !input?.end) return false;

  const deltaX = input.end.x - input.start.x;
  const deltaY = input.end.y - input.start.y;
  const distance = Math.hypot(deltaX, deltaY);
  const threshold = input.thresholdPx ?? GRAPH_PAN_DRAG_THRESHOLD_PX;

  return distance > threshold;
}

/**
 * @param {GraphInteractionState} state
 * @param {{ pointerId:number, button:number, shiftKey:boolean, clientX:number, clientY:number, tx:number, ty:number }} input
 * @returns {GraphInteractionState}
 */
function beginGraphPointerGesture(state, input) {
  if (state.activePointerId !== null) return state;
  if (!shouldStartGraphPan({ button: input.button, shiftKey: input.shiftKey })) {
    return {
      ...state,
    };
  }

  return {
    phase: 'tracking',
    activePointerId: input.pointerId,
    dragButton: input.button,
    startX: input.clientX,
    startY: input.clientY,
    originTx: input.tx,
    originTy: input.ty,
    dragMoved: false,
  };
}

/**
 * @param {GraphInteractionState} state
 * @param {{ pointerId:number, clientX:number, clientY:number }} input
 * @returns {GraphInteractionState}
 */
function updateGraphPointerGesture(state, input) {
  if (state.activePointerId !== input.pointerId) return state;
  if (state.phase === 'idle') return state;

  const dragMovedNow = graphDragMoved({
    start: { x: state.startX, y: state.startY },
    end: { x: input.clientX, y: input.clientY },
  });
  const dragMoved = state.dragMoved || dragMovedNow;

  return {
    ...state,
    phase: dragMoved ? 'panning' : 'tracking',
    dragMoved,
  };
}

/**
 * @param {GraphInteractionState} state
 * @param {{ pointerId:number }} input
 * @returns {GraphInteractionState}
 */
function endGraphPointerGesture(state, input) {
  if (state.activePointerId !== input.pointerId) return state;
  return {
    ...state,
    phase: 'idle',
    activePointerId: null,
    dragButton: null,
    startX: 0,
    startY: 0,
    originTx: 0,
    originTy: 0,
    dragMoved: false,
  };
}

/**
 * @param {GraphInteractionState} state
 * @param {{ pointerId:number, clientX:number, clientY:number }} input
 * @returns {{tx:number, ty:number} | null}
 */
function currentGraphPanTransform(state, input) {
  if (state.phase !== 'panning') return null;
  if (state.activePointerId !== input.pointerId) return null;
  return {
    tx: state.originTx + (input.clientX - state.startX),
    ty: state.originTy + (input.clientY - state.startY),
  };
}

/** @param {{ shiftKey?: boolean }} input */
function shouldPreventGraphContextMenu(input) {
  return !input?.shiftKey;
}

/** @param {{ button?: number }} input */
function shouldSelectGraphNodeOnClick(input) {
  return input?.button === 0;
}

/**
 * @param {GraphInteractionState} state
 * @param {{ shiftKey:boolean }} input
 * @returns {{ state: GraphInteractionState, shouldPrevent: boolean }}
 */
function handleGraphContextMenu(state, input) {
  const shouldPrevent = shouldPreventGraphContextMenu({ shiftKey: input.shiftKey });
  return {
    state,
    shouldPrevent,
  };
}

export {
  GRAPH_PAN_DRAG_THRESHOLD_PX,
  beginGraphPointerGesture,
  canStartGraphPan,
  createGraphInteractionState,
  currentGraphPanTransform,
  endGraphPointerGesture,
  graphDragMoved,
  handleGraphContextMenu,
  shouldSelectGraphNodeOnClick,
  shouldStartGraphPan,
  shouldPreventGraphContextMenu,
  updateGraphPointerGesture,
};
