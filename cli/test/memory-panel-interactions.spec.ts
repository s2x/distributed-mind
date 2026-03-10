import { describe, expect, test } from 'bun:test';

import {
    DRAG_CLOSE_GUARD_THRESHOLD_PX,
    interactionWasDrag,
    shouldCloseMemoryPanelOnClick,
} from '../../web/public/memory-panel-interactions.js';

describe('memory panel drag detection', () => {
    test('treats movement beyond threshold as drag', () => {
        expect(
            interactionWasDrag({
                start: { x: 10, y: 10 },
                end: { x: 19, y: 10 },
                thresholdPx: DRAG_CLOSE_GUARD_THRESHOLD_PX,
            })
        ).toBe(true);
    });

    test('treats movement at threshold as quick click', () => {
        expect(
            interactionWasDrag({
                start: { x: 10, y: 10 },
                end: { x: 18, y: 10 },
                thresholdPx: DRAG_CLOSE_GUARD_THRESHOLD_PX,
            })
        ).toBe(false);
    });
});

describe('memory panel click-away interactions', () => {
    test('does not close when outside interaction was a drag release', () => {
        expect(
            shouldCloseMemoryPanelOnClick({
                isPanelOpen: true,
                targetInsidePanel: false,
                targetIsMemorySelection: false,
                interactionWasDrag: true,
            })
        ).toBe(false);
    });

    test('closes when outside interaction was a quick click release', () => {
        expect(
            shouldCloseMemoryPanelOnClick({
                isPanelOpen: true,
                targetInsidePanel: false,
                targetIsMemorySelection: false,
                interactionWasDrag: false,
            })
        ).toBe(true);
    });

    test('closes when panel is open and interaction is outside panel', () => {
        expect(
            shouldCloseMemoryPanelOnClick({
                isPanelOpen: true,
                targetInsidePanel: false,
                targetIsMemorySelection: false,
            })
        ).toBe(true);
    });

    test('does not close when interaction happens inside panel', () => {
        expect(
            shouldCloseMemoryPanelOnClick({
                isPanelOpen: true,
                targetInsidePanel: true,
                targetIsMemorySelection: false,
            })
        ).toBe(false);
    });

    test('does not close when interaction selects memory from list/map', () => {
        expect(
            shouldCloseMemoryPanelOnClick({
                isPanelOpen: true,
                targetInsidePanel: false,
                targetIsMemorySelection: true,
            })
        ).toBe(false);
    });

    test('does not close when panel is already closed', () => {
        expect(
            shouldCloseMemoryPanelOnClick({
                isPanelOpen: false,
                targetInsidePanel: false,
                targetIsMemorySelection: false,
            })
        ).toBe(false);
    });
});
