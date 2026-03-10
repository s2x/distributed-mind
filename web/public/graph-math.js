(function (root, factory) {
    const api = factory();
    root.graphMath = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const TWO_PI = Math.PI * 2;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function zoomTransformAtAnchor(transform, options) {
        const { factor, anchorX, anchorY, minScale, maxScale } = options;
        const currentScale = transform.scale;
        const nextScale = clamp(currentScale * factor, minScale, maxScale);

        if (nextScale === currentScale) {
            return { scale: currentScale, tx: transform.tx, ty: transform.ty };
        }

        const ratio = nextScale / currentScale;
        const nextTx = anchorX - (anchorX - transform.tx) * ratio;
        const nextTy = anchorY - (anchorY - transform.ty) * ratio;

        return { scale: nextScale, tx: nextTx, ty: nextTy };
    }

    function computeLabelFontSize(scale, base = 11, min = 8, max = 16) {
        return clamp(base * scale, min, max);
    }

    function truncateGraphLabel(name, maxVisibleChars = 25) {
        if (typeof name !== 'string') return '';
        if (maxVisibleChars <= 0) return '…';
        if (name.length <= maxVisibleChars) return name;
        return `${name.slice(0, maxVisibleChars)}…`;
    }

    function computeLabelY(nodeY, nodeRadius, gap = 4) {
        return nodeY - nodeRadius - gap;
    }

    function buildGraphLayerOrder() {
        return ['rings', 'edges', 'nodes', 'labels'];
    }

    function computeNodeCircleRadius(_degree) {
        return 12;
    }

    function computeNodeFillOpacity(degree) {
        return clamp(0.45 + Math.max(0, degree) * 0.08, 0.45, 0.95);
    }

    function buildNeighborhoodFocus(nodes, selectedNodeId) {
        const emptyFocus = {
            active: false,
            centerNodeId: null,
            relatedNodeIds: new Set(),
            incidentEdgeKeys: new Set(),
        };

        if (selectedNodeId == null) {
            return emptyFocus;
        }

        const selectedNode = (nodes ?? []).find((node) => node.id === selectedNodeId);
        if (!selectedNode) {
            return emptyFocus;
        }

        const relatedNodeIds = new Set([selectedNode.id]);
        const incidentEdgeKeys = new Set();

        for (const targetId of selectedNode.links_to ?? []) {
            relatedNodeIds.add(targetId);
            incidentEdgeKeys.add(`${selectedNode.id}->${targetId}`);
        }

        for (const sourceId of selectedNode.linked_by ?? []) {
            relatedNodeIds.add(sourceId);
            incidentEdgeKeys.add(`${sourceId}->${selectedNode.id}`);
        }

        return {
            active: true,
            centerNodeId: selectedNode.id,
            relatedNodeIds,
            incidentEdgeKeys,
        };
    }

    function layoutGraph(nodes, options = {}) {
        const centerX = options.centerX ?? 500;
        const centerY = options.centerY ?? 500;
        const tierRadius = options.tierRadius ?? { 1: 130, 2: 230, 3: 330, 4: 430 };
        const byTier = { 1: [], 2: [], 3: [], 4: [] };

        for (const node of nodes ?? []) {
            if (!byTier[node.tier]) continue;
            byTier[node.tier].push(node);
        }

        const positions = new Map();
        for (const tier of [1, 2, 3, 4]) {
            const tierNodes = byTier[tier];
            if (tierNodes.length === 0) continue;
            placeTierNodes(tierNodes, tierRadius[tier], centerX, centerY, positions);
        }

        return positions;
    }

    function placeTierNodes(nodes, baseRadius, centerX, centerY, positions) {
        const sortedNodes = [...nodes].sort((a, b) => a.id - b.id);
        const laneCount = sortedNodes.length > 24 ? 3 : sortedNodes.length > 12 ? 2 : 1;
        const laneSpacing = 18;
        const bucketCount = Math.max(72, sortedNodes.length * 8);
        const occupied = new Uint8Array(bucketCount);

        for (let index = 0; index < sortedNodes.length; index++) {
            const node = sortedNodes[index];
            const nodeRadius = computeNodeCircleRadius();

            const laneIndex = index % laneCount;
            const laneOffset = (laneIndex - (laneCount - 1) / 2) * laneSpacing;
            const radius = baseRadius + laneOffset + ((node.id % 5) - 2) * 2;
            const baseAngle = ((index / sortedNodes.length) * TWO_PI + seededOffset(node.id)) % TWO_PI;

            const requiredArc = 2 * Math.asin(Math.min(0.92, (nodeRadius + 8) / Math.max(1, radius)));
            const clearance = Math.max(1, Math.ceil((requiredArc / TWO_PI) * bucketCount));
            const angle = resolveFreeAngle(baseAngle, occupied, clearance);

            occupy(occupied, angle, clearance);

            positions.set(node.id, {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
            });
        }
    }

    function resolveFreeAngle(baseAngle, occupied, clearance) {
        const bucketCount = occupied.length;
        const baseBucket = angleToBucket(baseAngle, bucketCount);

        if (isBucketRangeFree(occupied, baseBucket, clearance)) {
            return bucketToAngle(baseBucket, bucketCount);
        }

        const maxSteps = Math.min(64, Math.floor(bucketCount / 2));
        for (let step = 1; step <= maxSteps; step++) {
            for (const direction of [1, -1]) {
                const candidateBucket = normalizeBucket(baseBucket + direction * step, bucketCount);
                if (!isBucketRangeFree(occupied, candidateBucket, clearance)) continue;
                return bucketToAngle(candidateBucket, bucketCount);
            }
        }

        return bucketToAngle(baseBucket, bucketCount);
    }

    function occupy(occupied, angle, clearance) {
        const bucketCount = occupied.length;
        const bucket = angleToBucket(angle, bucketCount);
        for (let delta = -clearance; delta <= clearance; delta++) {
            occupied[normalizeBucket(bucket + delta, bucketCount)] = 1;
        }
    }

    function isBucketRangeFree(occupied, bucket, clearance) {
        const bucketCount = occupied.length;
        for (let delta = -clearance; delta <= clearance; delta++) {
            const index = normalizeBucket(bucket + delta, bucketCount);
            if (occupied[index] === 1) return false;
        }
        return true;
    }

    function normalizeBucket(bucket, count) {
        return ((bucket % count) + count) % count;
    }

    function angleToBucket(angle, count) {
        const normalized = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
        return Math.round((normalized / TWO_PI) * (count - 1));
    }

    function bucketToAngle(bucket, count) {
        const normalizedBucket = normalizeBucket(bucket, count);
        return (normalizedBucket / count) * TWO_PI;
    }

    function seededOffset(id) {
        const value = Math.abs(Math.sin(id * 12.9898) * 43758.5453);
        return (value - Math.floor(value)) * 0.6;
    }

    return {
        buildGraphLayerOrder,
        computeLabelY,
        zoomTransformAtAnchor,
        computeLabelFontSize,
        truncateGraphLabel,
        computeNodeCircleRadius,
        computeNodeFillOpacity,
        buildNeighborhoodFocus,
        layoutGraph,
    };
});
