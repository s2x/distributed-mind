import { afterEach, describe, expect, test } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import { createSpaceTools } from '../src/mcp/tools/spaces';
import type { MindStore } from '../src/store/mind-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

// =============================================================================
// RED Phase: Tests for Phase 2.1 — Spaces Tools Redesign
// These tests define the NEW expected behavior.
// =============================================================================

describe('Phase 2.1: Spaces Tools Redesign', () => {
    describe('space.create — tags REQUIRED', () => {
        test('2.1.1 space.create without tags throws "tags is required"', async () => {
            store = createTestStore();
            const tools = createSpaceTools(store);

            await expect(
                tools.space_create.handler({
                    name: 'myproject',
                    description: 'My project',
                })
            ).rejects.toThrow('tags is required');
        });

        test('2.1.2 space.create with empty tags [] throws "at least 1 tag"', async () => {
            store = createTestStore();
            const tools = createSpaceTools(store);

            await expect(
                tools.space_create.handler({
                    name: 'myproject',
                    description: 'My project',
                    tags: [],
                })
            ).rejects.toThrow('at least 1 tag');
        });

        test('space.create with valid tags succeeds', async () => {
            store = createTestStore();
            const tools = createSpaceTools(store);

            const res = await tools.space_create.handler({
                name: 'myproject',
                description: 'My project',
                tags: ['type:project'],
            });

            expect(res.content[0]?.text).toContain('created');
            expect(res.space?.tags).toContain('type:project');
        });
    });

    describe('space.get — +hot_memories preview', () => {
        test('2.1.3 space.get returns hot_memories array with all T1 + T2', async () => {
            store = createTestStore();
            store.createSpace('myproject', 'My project', ['test']);
            // Add T1 memory
            await store.addMemory('myproject', 'hot1', 'hot content', { tier: 1, tags: ['test'] });
            // Add T2 memory (default)
            await store.addMemory('myproject', 'warm1', 'warm content', { tier: 2, tags: ['test'] });
            // Add T3 memory (should NOT appear in hot_memories)
            await store.addMemory('myproject', 'cold1', 'cold content', { tier: 3, tags: ['test'] });

            const tools = createSpaceTools(store);
            const res = await tools.space_get.handler({ name: 'myproject' });

            expect(res.hot_memories).toBeDefined();
            expect(Array.isArray(res.hot_memories)).toBe(true);
            expect(res.hot_memories.length).toBe(2);
        });

        test('2.1.4 space.get hot_memories includes {id, name, tier, tags, pinned, updated_at}', async () => {
            store = createTestStore();
            store.createSpace('myproject', 'My project', ['test']);
            await store.addMemory('myproject', 'hot1', 'hot content', {
                tier: 1,
                tags: ['cat:decision'],
                pinned: true,
            });

            const tools = createSpaceTools(store);
            const res = await tools.space_get.handler({ name: 'myproject' });

            const hot = res.hot_memories[0];
            expect(hot).toBeDefined();
            expect(typeof hot.id).toBe('number');
            expect(hot.name).toBe('hot1');
            expect(hot.tier).toBe(1);
            expect(hot.tags).toContain('cat:decision');
            expect(hot.pinned).toBe(true);
            expect(typeof hot.updated_at).toBe('string');
        });

        test('space.get returns hot_memories empty when no hot memories', async () => {
            store = createTestStore();
            store.createSpace('myproject', 'My project', ['test']);

            const tools = createSpaceTools(store);
            const res = await tools.space_get.handler({ name: 'myproject' });

            expect(res.hot_memories).toBeDefined();
            expect(res.hot_memories.length).toBe(0);
        });
    });

    describe('space.update — tags optional', () => {
        test('2.1.5 space.update with tags replaces entire array', async () => {
            store = createTestStore();
            store.createSpace('myproject', 'My project', ['type:project', 'cat:decision']);

            const tools = createSpaceTools(store);
            const res = await tools.space_update.handler({
                name: 'myproject',
                tags: ['new:tag'],
            });

            const space = store.getSpace('myproject');
            expect(space?.tags).toEqual(['new:tag']);
        });

        test('2.1.6 space.update without tags does not modify existing tags', async () => {
            store = createTestStore();
            store.createSpace('myproject', 'My project', ['type:project', 'cat:decision']);

            const tools = createSpaceTools(store);
            await tools.space_update.handler({
                name: 'myproject',
                description: 'Updated description',
            });

            const space = store.getSpace('myproject');
            // Tags order may vary due to DB storage, so sort before comparing
            expect(space?.tags.slice().sort()).toEqual(['cat:decision', 'type:project']);
        });

        test('space.update with empty tags [] clears all tags', async () => {
            store = createTestStore();
            store.createSpace('myproject', 'My project', ['type:project']);

            const tools = createSpaceTools(store);
            await tools.space_update.handler({
                name: 'myproject',
                tags: [],
            });

            const space = store.getSpace('myproject');
            expect(space?.tags).toEqual([]);
        });
    });

    describe('Removed tools — space_rename, space_tag_add, space_tag_remove', () => {
        test('2.1.7 space_rename no longer exists (tool not found)', async () => {
            store = createTestStore();
            const tools = createSpaceTools(store);

            expect(tools.space_rename).toBeUndefined();
        });

        test('2.1.8 space_tag_add no longer exists (tool not found)', async () => {
            store = createTestStore();
            const tools = createSpaceTools(store);

            expect(tools.space_tag_add).toBeUndefined();
        });

        test('2.1.9 space_tag_remove no longer exists (tool not found)', async () => {
            store = createTestStore();
            const tools = createSpaceTools(store);

            expect(tools.space_tag_remove).toBeUndefined();
        });
    });
});
