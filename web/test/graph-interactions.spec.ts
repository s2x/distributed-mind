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
