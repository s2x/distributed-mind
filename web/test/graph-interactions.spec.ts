import { describe, expect, test } from 'bun:test';

import {
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
  updateGraphPointerGesture,
} from '../src/features/graph/interactions.js';

// Minimal JSDOM-like mock for testing isGraphNodeTarget
const createMockCircle = role => ({
  tagName: 'circle',
  getAttribute: attr => (attr === 'role' ? role : null),
});

const createMockSvg = () => ({
  tagName: 'svg',
  getAttribute: () => null,
});

const createMockText = () => ({
  tagName: 'text',
  getAttribute: () => null,
});

// Import the app.js helper (we'll test it indirectly via its behavior)
// Note: isGraphNodeTarget is in app.js and requires DOM APIs, so we test the logic directly

describe('isGraphNodeTarget logic (extracted for testing)', () => {
  /**
   * This mirrors the logic in app.js isGraphNodeTarget function
   * @param {any} target
   */
  function isGraphNodeTarget(target) {
    if (!target) return false;
    const tagName = target.tagName?.toLowerCase?.() ?? '';
    return tagName === 'circle' && target.getAttribute?.('role') === 'button';
  }

  test('returns true for circle with role=button (graph node)', () => {
    const node = createMockCircle('button');
    expect(isGraphNodeTarget(node)).toBe(true);
  });

  test('returns false for circle without role attribute', () => {
    const circle = createMockCircle(null);
    expect(isGraphNodeTarget(circle)).toBe(false);
  });

  test('returns false for SVG element (graph background)', () => {
    const svg = createMockSvg();
    expect(isGraphNodeTarget(svg)).toBe(false);
  });

  test('returns false for text element (graph label)', () => {
    const text = createMockText();
    expect(isGraphNodeTarget(text)).toBe(false);
  });

  test('returns false for null target', () => {
    expect(isGraphNodeTarget(null)).toBe(false);
  });

  test('returns false for undefined target', () => {
    expect(isGraphNodeTarget(undefined)).toBe(false);
  });
});

describe('graph interactions', () => {
  test('allows graph pan start for primary and secondary mouse buttons only', () => {
    expect(canStartGraphPan(0)).toBe(true);
    expect(canStartGraphPan(2)).toBe(true);
    expect(canStartGraphPan(1)).toBe(false);
  });

  test('detects drag movement only when pointer moved beyond threshold', () => {
    expect(
      graphDragMoved({
        start: { x: 50, y: 50 },
        end: { x: 60, y: 50 },
        thresholdPx: GRAPH_PAN_DRAG_THRESHOLD_PX,
      })
    ).toBe(true);

    expect(
      graphDragMoved({
        start: { x: 50, y: 50 },
        end: { x: 50 + GRAPH_PAN_DRAG_THRESHOLD_PX, y: 50 },
        thresholdPx: GRAPH_PAN_DRAG_THRESHOLD_PX,
      })
    ).toBe(false);
  });

  test('graph drag state tracks left-button drag movement', () => {
    // Simulate left-click (button 0) drag on graph
    const started = beginGraphPointerGesture(createGraphInteractionState(), {
      pointerId: 1,
      button: 0, // left click
      shiftKey: false,
      clientX: 100,
      clientY: 100,
      tx: 0,
      ty: 0,
    });

    // Move beyond threshold to simulate drag
    const moved = updateGraphPointerGesture(started, {
      pointerId: 1,
      clientX: 100 + GRAPH_PAN_DRAG_THRESHOLD_PX + 5,
      clientY: 100,
    });

    // Verify drag state is captured
    expect(moved.dragMoved).toBe(true);
    expect(moved.phase).toBe('panning');
  });

  test('graph drag state tracks right-button drag movement', () => {
    // Simulate right-click (button 2) drag on graph
    const started = beginGraphPointerGesture(createGraphInteractionState(), {
      pointerId: 2,
      button: 2, // right click
      shiftKey: false,
      clientX: 100,
      clientY: 100,
      tx: 0,
      ty: 0,
    });

    // Move beyond threshold to simulate drag
    const moved = updateGraphPointerGesture(started, {
      pointerId: 2,
      clientX: 100 + GRAPH_PAN_DRAG_THRESHOLD_PX + 5,
      clientY: 100,
    });

    // Verify drag state is captured for right-click too
    expect(moved.dragMoved).toBe(true);
    expect(moved.phase).toBe('panning');
  });

  test('graph drag state is false for quick click without movement', () => {
    // Simulate left-click without drag
    const started = beginGraphPointerGesture(createGraphInteractionState(), {
      pointerId: 1,
      button: 0,
      shiftKey: false,
      clientX: 100,
      clientY: 100,
      tx: 0,
      ty: 0,
    });

    // Small movement below threshold
    const moved = updateGraphPointerGesture(started, {
      pointerId: 1,
      clientX: 105, // under threshold
      clientY: 100,
    });

    expect(moved.dragMoved).toBe(false);
    expect(moved.phase).toBe('tracking');
  });

  test('allows native context menu for shift+right-click', () => {
    expect(shouldStartGraphPan({ button: 2, shiftKey: true })).toBe(false);
    const contextMenuDecision = handleGraphContextMenu(createGraphInteractionState(), {
      shiftKey: true,
    });
    expect(contextMenuDecision.shouldPrevent).toBe(false);
  });

  test('suppresses native context menu on graph for plain right-click', () => {
    const contextMenuDecision = handleGraphContextMenu(createGraphInteractionState(), {
      shiftKey: false,
    });
    expect(contextMenuDecision.shouldPrevent).toBe(true);
  });

  test('starts right-button pan tracking even for quick right-click', () => {
    const started = beginGraphPointerGesture(createGraphInteractionState(), {
      pointerId: 11,
      button: 2,
      shiftKey: false,
      clientX: 30,
      clientY: 30,
      tx: 0,
      ty: 0,
    });
    expect(started.activePointerId).toBe(11);
    expect(started.dragButton).toBe(2);
  });

  test('quick right-click on graph node does not trigger selection/open', () => {
    expect(shouldSelectGraphNodeOnClick({ button: 2 })).toBe(false);
  });

  test('does not leak active pointer state between gestures', () => {
    const rightDrag = updateGraphPointerGesture(
      beginGraphPointerGesture(createGraphInteractionState(), {
        pointerId: 5,
        button: 2,
        shiftKey: false,
        clientX: 10,
        clientY: 10,
        tx: 0,
        ty: 0,
      }),
      {
        pointerId: 5,
        clientX: 10 + GRAPH_PAN_DRAG_THRESHOLD_PX + 1,
        clientY: 10,
      }
    );
    const ended = endGraphPointerGesture(rightDrag, { pointerId: 5 });

    const nextGesture = beginGraphPointerGesture(ended, {
      pointerId: 6,
      button: 0,
      shiftKey: false,
      clientX: 20,
      clientY: 20,
      tx: 0,
      ty: 0,
    });

    expect(nextGesture.activePointerId).toBe(6);
    expect(nextGesture.dragButton).toBe(0);
  });

  test('left-drag remains supported after crossing threshold', () => {
    const started = beginGraphPointerGesture(createGraphInteractionState(), {
      pointerId: 1,
      button: 0,
      shiftKey: false,
      clientX: 50,
      clientY: 50,
      tx: 12,
      ty: 18,
    });
    const moved = updateGraphPointerGesture(started, {
      pointerId: 1,
      clientX: 50 + GRAPH_PAN_DRAG_THRESHOLD_PX + 2,
      clientY: 56,
    });

    expect(currentGraphPanTransform(moved, { pointerId: 1, clientX: 64, clientY: 60 })).toEqual({
      tx: 26,
      ty: 28,
    });
  });
});
