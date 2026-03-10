import { afterEach, describe, expect, test } from 'bun:test';
import { matchApiRoute } from '../src/api/router';
import { createTestStore } from './mocks/test-store';
import type { MindStore } from '../src/store/mind-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

async function requestJson(path: string): Promise<any> {
    const req = new Request(`http://localhost${path}`, { method: 'GET' });
    const res = await matchApiRoute(req, store);
    if (!res) throw new Error('Route not matched');
    return res.json();
}

describe('API Routes — Space Graph', () => {
    test('returns minimal graph payload including T4 memories', async () => {
        store = createTestStore();
        store.createSpace('proj', 'Project');

        const t1 = await store.addMemory('proj', 'hot', 'h', { tier: 1 });
        const t2 = await store.addMemory('proj', 'warm', 'w', { tier: 2 });
        const t4 = await store.addMemory('proj', 'frozen', 'f', { tier: 3 });
        store.demote(t4.id); // T3 -> T4

        store.link(t1.id, t2.id);
        store.link(t4.id, t1.id);

        const payload = await requestJson('/api/spaces/proj/graph');
        expect(payload.meta.total_nodes).toBe(3);
        expect(payload.nodes).toHaveLength(3);

        const frozenNode = payload.nodes.find((node: any) => node.id === t4.id);
        expect(frozenNode).toBeTruthy();
        expect(frozenNode.tier).toBe(4);

        const firstNodeKeys = Object.keys(payload.nodes[0] ?? {}).sort();
        expect(firstNodeKeys).toEqual(['id', 'linked_by', 'links_to', 'name', 'tier']);
    });

    test('applies guardrail cap and returns truncation metadata', async () => {
        store = createTestStore();
        store.createSpace('proj', 'Project');

        for (let i = 0; i < 6; i++) {
            await store.addMemory('proj', `m-${i}`, `content-${i}`, { tier: 3 });
        }

        const payload = await requestJson('/api/spaces/proj/graph?limit=2');
        expect(payload.meta.requested_limit).toBe(2);
        expect(payload.meta.applied_limit).toBe(2);
        expect(payload.meta.total_nodes).toBe(6);
        expect(payload.meta.returned_nodes).toBe(2);
        expect(payload.meta.truncated).toBe(true);
        expect(payload.nodes).toHaveLength(2);
    });
});
