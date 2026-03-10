import { describe, expect, test } from 'bun:test';

import {
    buildGraphLayerOrder,
    computeLabelY,
    computeLabelFontSize,
    layoutGraph,
    truncateGraphLabel,
    zoomTransformAtAnchor,
} from '../../web/public/graph-math.js';

describe('Neural map graph math', () => {
    test('keeps pointer anchor fixed when wheel-zooming', () => {
        const next = zoomTransformAtAnchor(
            { scale: 1, tx: 0, ty: 0 },
            {
                factor: 1.1,
                anchorX: 250,
                anchorY: 120,
                minScale: 0.45,
                maxScale: 2.8,
            }
        );

        expect(next.scale).toBeCloseTo(1.1, 6);
        expect(next.tx).toBeCloseTo(-25, 6);
        expect(next.ty).toBeCloseTo(-12, 6);
    });

    test('anchors button zoom at center point and respects scale bounds', () => {
        const zoomedIn = zoomTransformAtAnchor(
            { scale: 2.7, tx: 5, ty: -3 },
            {
                factor: 1.2,
                anchorX: 500,
                anchorY: 500,
                minScale: 0.45,
                maxScale: 2.8,
            }
        );

        expect(zoomedIn.scale).toBe(2.8);

        const zoomedOut = zoomTransformAtAnchor(
            { scale: 0.5, tx: 1, ty: 1 },
            {
                factor: 0.5,
                anchorX: 500,
                anchorY: 500,
                minScale: 0.45,
                maxScale: 2.8,
            }
        );

        expect(zoomedOut.scale).toBe(0.45);
    });

    test('computes clamped label font size by zoom level', () => {
        expect(computeLabelFontSize(0.2)).toBeCloseTo(8, 6);
        expect(computeLabelFontSize(1)).toBeCloseTo(11, 6);
        expect(computeLabelFontSize(10)).toBeCloseTo(16, 6);
    });

    test('truncates visible graph labels to 25 chars and appends ellipsis', () => {
        const longName = 'abcdefghijklmnopqrstuvwxyz012345';
        expect(truncateGraphLabel(longName)).toBe('abcdefghijklmnopqrstuvwxy…');
        expect(truncateGraphLabel('short-name')).toBe('short-name');
    });

    test('places labels slightly closer to node circles', () => {
        expect(computeLabelY(200, 20)).toBe(176);
    });

    test('keeps labels in a dedicated top render layer', () => {
        expect(buildGraphLayerOrder()).toEqual(['rings', 'edges', 'nodes', 'labels']);
    });

    test('produces deterministic best-effort spacing for dense tier layouts', () => {
        const nodes = Array.from({ length: 40 }, (_, index) => ({
            id: index + 1,
            tier: 2,
            name: `Node ${index + 1}`,
            links_to: [],
            linked_by: [],
        }));

        const first = layoutGraph(nodes);
        const second = layoutGraph(nodes);

        for (const node of nodes) {
            const p1 = first.get(node.id);
            const p2 = second.get(node.id);
            expect(p1).toEqual(p2);
        }

        const points = nodes.map((node) => first.get(node.id)).filter(Boolean);
        let minDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const dx = points[i].x - points[j].x;
                const dy = points[i].y - points[j].y;
                const distance = Math.hypot(dx, dy);
                if (distance < minDistance) minDistance = distance;
            }
        }

        expect(minDistance).toBeGreaterThan(6);
    });
});
