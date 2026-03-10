(function (root, factory) {
    const api = factory();
    root.memoryPanelInteractions = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DRAG_CLOSE_GUARD_THRESHOLD_PX = 8;

    function interactionWasDrag(input) {
        if (!input?.start || !input?.end) return false;

        const deltaX = input.end.x - input.start.x;
        const deltaY = input.end.y - input.start.y;
        const distance = Math.hypot(deltaX, deltaY);
        const threshold = input.thresholdPx ?? DRAG_CLOSE_GUARD_THRESHOLD_PX;
        return distance > threshold;
    }

    function shouldCloseMemoryPanelOnClick(input) {
        if (!input?.isPanelOpen) return false;
        if (input.targetInsidePanel) return false;
        if (input.targetIsMemorySelection) return false;
        if (input.interactionWasDrag) return false;
        return true;
    }

    return {
        DRAG_CLOSE_GUARD_THRESHOLD_PX,
        interactionWasDrag,
        shouldCloseMemoryPanelOnClick,
    };
});
