import { describe, expect, test, afterEach, spyOn } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import type { MindStore } from '../src/store/mind-store';
import * as ragHelpers from '../src/helpers/rag';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

describe('MindStore — Spaces', () => {
    test('should create and retrieve a space', () => {
        store = createTestStore();
        store.createSpace('test', 'A test space', ['project', 'dev']);

        const space = store.getSpace('test');
        expect(space).not.toBeNull();
        expect(space!.name).toBe('test');
        expect(space!.description).toBe('A test space');
        expect(space!.tags).toContain('project');
        expect(space!.tags).toContain('dev');
    });

    test('should throw when creating duplicate space', () => {
        store = createTestStore();
        store.createSpace('test', 'A test space');
        expect(() => store.createSpace('test', 'Another')).toThrow('already exists');
    });

    test('should list spaces', () => {
        store = createTestStore();
        store.createSpace('alpha', 'First');
        store.createSpace('beta', 'Second');

        const spaces = store.listSpaces();
        expect(spaces.length).toBe(2);
        expect(spaces[0]!.name).toBe('alpha');
        expect(spaces[1]!.name).toBe('beta');
    });

    test('should list spaces filtered by tag', () => {
        store = createTestStore();
        store.createSpace('proj-a', 'Project A', ['project']);
        store.createSpace('personal', 'Personal', ['personal']);

        const projects = store.listSpaces({ tag: 'project' });
        expect(projects.length).toBe(1);
        expect(projects[0]!.name).toBe('proj-a');
    });

    test('should delete a space and all its memories', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem1', 'content');
        store.deleteSpace('test');

        expect(store.getSpace('test')).toBeNull();
    });

    test('should rename a space', async () => {
        store = createTestStore();
        store.createSpace('old', 'Old space');
        await store.addMemory('old', 'mem1', 'content');
        store.renameSpace('old', 'new');

        expect(store.getSpace('old')).toBeNull();
        expect(store.getSpace('new')).not.toBeNull();
        // Memories should follow
        expect(store.getMemory('new', 'mem1')).not.toBeNull();
    });

    test('should update space description', () => {
        store = createTestStore();
        store.createSpace('test', 'Old description');
        store.updateSpace('test', { description: 'New description' });

        const space = store.getSpace('test');
        expect(space!.description).toBe('New description');
    });

    test('should add and remove space tags', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addSpaceTag('test', 'project');
        store.addSpaceTag('test', 'active');

        let space = store.getSpace('test');
        expect(space!.tags).toContain('project');
        expect(space!.tags).toContain('active');

        store.removeSpaceTag('test', 'active');
        space = store.getSpace('test');
        expect(space!.tags).not.toContain('active');
        expect(space!.tags).toContain('project');
    });
});

describe('MindStore — Memories', () => {
    test('should add and retrieve a memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'auth-flow', 'JWT auth', { tags: ['backend', 'security'], tier: 1 });

        expect(mem.name).toBe('auth-flow');
        expect(mem.content).toBe('JWT auth');
        expect(mem.tier).toBe(1);
        expect(mem.tags).toContain('backend');
        expect(mem.tags).toContain('security');
        expect(mem.changed_at).toBeTruthy();

        const retrieved = store.getMemory('test', 'auth-flow');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(mem.id);
    });

    test('should not update changed_at on read access', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });
        const before = store.getMemoryById(mem.id)!;

        await new Promise((resolve) => setTimeout(resolve, 1100));
        store.recordAccess(mem.id);

        const after = store.getMemoryById(mem.id)!;
        expect(after.changed_at).toBe(before.changed_at);
        expect(after.tier).toBe(2); // still auto-promotes
    });

    test('should update changed_at on semantic memory changes', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content');
        const before = store.getMemoryById(mem.id)!;

        await new Promise((resolve) => setTimeout(resolve, 1100));
        await store.updateMemory(mem.id, { content: 'new content' });

        const after = store.getMemoryById(mem.id)!;
        expect(after.changed_at).not.toBe(before.changed_at);
    });

    test('should default to tier 2', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content');
        expect(mem.tier).toBe(2);
    });

    test('should list memories — default returns T1+T2 only', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'hot', 'content', { tier: 1 });
        await store.addMemory('test', 'warm', 'content', { tier: 2 });
        await store.addMemory('test', 'cold', 'content', { tier: 3 });

        const active = store.listMemories('test');
        expect(active.length).toBe(2);
        expect(active[0]!.tier).toBe(1);
        expect(active[1]!.tier).toBe(2);
        // cold (T3) should not appear
        expect(active.some((m) => m.name === 'cold')).toBe(false);
    });

    test('should list memories — explicit tier 3 returns cold', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'hot', 'content', { tier: 1 });
        await store.addMemory('test', 'cold', 'content', { tier: 3 });

        const cold = store.listMemories('test', { tier: 3 });
        expect(cold.length).toBe(1);
        expect(cold[0]!.name).toBe('cold');
    });

    test('should list memories — tier 4 returns empty', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem', 'content', { tier: 2 });

        const t4 = store.listMemories('test', { tier: 4 });
        expect(t4.length).toBe(0);
    });

    test('should filter memories by tier', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'hot', 'content', { tier: 1 });
        await store.addMemory('test', 'warm', 'content', { tier: 2 });

        const tier1 = store.listMemories('test', { tier: 1 });
        expect(tier1.length).toBe(1);
        expect(tier1[0]!.name).toBe('hot');
    });

    test('should filter memories by tag', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem1', 'content', { tags: ['backend'] });
        await store.addMemory('test', 'mem2', 'content', { tags: ['frontend'] });

        const backend = store.listMemories('test', { tag: 'backend' });
        expect(backend.length).toBe(1);
        expect(backend[0]!.name).toBe('mem1');
    });

    test('should update memory content', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'old content');
        await store.updateMemory(mem.id, { content: 'new content' });

        const updated = store.getMemoryById(mem.id);
        expect(updated!.content).toBe('new content');
    });

    test('should delete memory by name', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem1', 'content');
        store.deleteMemoryByName('test', 'mem1');
        expect(store.getMemory('test', 'mem1')).toBeNull();
    });

    test('should add and remove memory tags', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content');

        store.addMemoryTag(mem.id, 'important');
        let retrieved = store.getMemoryById(mem.id);
        expect(retrieved!.tags).toContain('important');

        store.removeMemoryTag(mem.id, 'important');
        retrieved = store.getMemoryById(mem.id);
        expect(retrieved!.tags).not.toContain('important');
    });
});

describe('MindStore — Tiers', () => {
    test('should promote a memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });

        store.promote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(2);

        store.promote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(1);
    });

    test('should not promote beyond tier 1', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 1 });
        expect(() => store.promote(mem.id)).toThrow('highest tier');
    });

    test('should demote a memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 1 });

        store.demote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(2);

        store.demote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(3);
    });

    test('should demote from T3 to T4', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });
        store.demote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(4);
    });

    test('should not demote beyond tier 4', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        // Add at T3 then demote to T4 manually via demote
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });
        store.demote(mem.id); // T3 → T4
        expect(() => store.demote(mem.id)).toThrow('lowest tier');
    });

    test('should pin and unpin', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content');

        store.pin(mem.id);
        expect(store.getMemoryById(mem.id)!.pinned).toBe(true);

        store.unpin(mem.id);
        expect(store.getMemoryById(mem.id)!.pinned).toBe(false);
    });

    test('should auto-promote tier 3 to 2 on read', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });

        store.recordAccess(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(2);
    });

    test('should auto-promote tier 4 to 3 on read', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });
        store.demote(mem.id); // T3 → T4

        store.recordAccess(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(3);
    });

    test('should not auto-promote pinned memory on read', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3 });
        store.pin(mem.id);

        store.recordAccess(mem.id);
        // Pinned: stays at T3
        expect(store.getMemoryById(mem.id)!.tier).toBe(3);
    });

    test('should bump access count on read', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content');

        store.recordAccess(mem.id);
        store.recordAccess(mem.id);
        store.recordAccess(mem.id);

        const updated = store.getMemoryById(mem.id);
        expect(updated!.access_count).toBe(3);
        expect(updated!.last_accessed_at).not.toBeNull();
    });
});

describe('MindStore — LRU Eviction', () => {
    test('should evict LRU non-pinned memory when tier is full', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');

        // Fill T1 to limit (25)
        const { TIER_LIMITS } = require('../src/config');
        const limit: number = TIER_LIMITS[1];
        for (let i = 0; i < limit; i++) {
            await store.addMemory('test', `mem-${i}`, 'content', { tier: 1 });
        }

        // Adding one more to T1 should evict the LRU (mem-0) to T2
        await store.addMemory('test', 'overflow', 'content', { tier: 1 });

        // overflow was added to T1
        expect(store.getMemory('test', 'overflow')!.tier).toBe(1);
        // LRU (mem-0) was evicted to T2
        expect(store.getMemory('test', 'mem-0')!.tier).toBe(2);
        // Other T1 memories remain at T1
        expect(store.getMemory('test', 'mem-1')!.tier).toBe(1);
    });

    test('should throw when tier is full and all memories are pinned', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');

        const { TIER_LIMITS } = require('../src/config');
        const limit: number = TIER_LIMITS[1];

        // Fill T1 with pinned memories
        for (let i = 0; i < limit; i++) {
            const m = await store.addMemory('test', `pinned-${i}`, 'content', { tier: 1 });
            store.pin(m.id);
        }

        // Should throw — all T1 pinned
        await expect(store.addMemory('test', 'overflow', 'content', { tier: 1 })).rejects.toThrow('pinned');
    });

    test('should evict LRU from T3 to T4 when T3 is full', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');

        const { TIER_LIMITS } = require('../src/config');
        const limit: number = TIER_LIMITS[3];

        // Fill T3 to limit
        for (let i = 0; i < limit; i++) {
            await store.addMemory('test', `cold-${i}`, 'content', { tier: 3 });
        }

        // Adding one more to T3 should evict LRU (cold-0) to T4
        await store.addMemory('test', 'overflow', 'content', { tier: 3 });

        expect(store.getMemory('test', 'overflow')!.tier).toBe(3);
        expect(store.getMemory('test', 'cold-0')!.tier).toBe(4);
    });

    test('pinned memories should not be LRU-evicted', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');

        const { TIER_LIMITS } = require('../src/config');
        const limit: number = TIER_LIMITS[1];

        // Fill T1: first is pinned, rest are not
        const first = await store.addMemory('test', 'pinned-first', 'content', { tier: 1 });
        store.pin(first.id);
        for (let i = 1; i < limit; i++) {
            await store.addMemory('test', `mem-${i}`, 'content', { tier: 1 });
        }

        // Add overflow → should evict mem-1 (LRU non-pinned), NOT pinned-first
        await store.addMemory('test', 'overflow', 'content', { tier: 1 });

        expect(store.getMemory('test', 'pinned-first')!.tier).toBe(1); // still T1
        expect(store.getMemory('test', 'mem-1')!.tier).toBe(2); // evicted to T2
    });

    test('recordAccess promotion should silently skip if destination full and all pinned', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');

        const { TIER_LIMITS } = require('../src/config');
        const limit: number = TIER_LIMITS[1];

        // Fill T1 with pinned memories
        for (let i = 0; i < limit; i++) {
            const m = await store.addMemory('test', `pinned-${i}`, 'content', { tier: 1 });
            store.pin(m.id);
        }

        // Add a T2 memory and access it — promotion to T1 should silently fail
        const t2mem = await store.addMemory('test', 'warm', 'content', { tier: 2 });
        store.recordAccess(t2mem.id);

        // Should remain at T2 (not throw)
        expect(store.getMemory('test', 'warm')!.tier).toBe(2);
        // Access count should still bump
        expect(store.getMemory('test', 'warm')!.access_count).toBe(1);
    });
});

describe('MindStore — Status', () => {
    test('should return global status', async () => {
        store = createTestStore();
        store.createSpace('space1', 'Space 1');
        store.createSpace('space2', 'Space 2');
        await store.addMemory('space1', 'mem1', 'content', { tier: 1 });
        await store.addMemory('space1', 'mem2', 'content', { tier: 2 });
        await store.addMemory('space2', 'mem3', 'content', { tier: 3 });

        const status = store.getStatus();
        expect(status.total_spaces).toBe(2);
        expect(status.total_memories).toBe(3);
        expect(status.by_tier.length).toBe(4); // always 4 tiers
        expect(status.by_tier.find((b) => b.tier === 1)!.count).toBe(1);
        expect(status.by_tier.find((b) => b.tier === 2)!.count).toBe(1);
        expect(status.by_tier.find((b) => b.tier === 3)!.count).toBe(1);
        expect(status.by_tier.find((b) => b.tier === 4)!.count).toBe(0);
        expect(status.db_path).toContain('.db');
        expect(status.db_size_bytes).toBeGreaterThan(0);
    });

    test('should return space-scoped status', async () => {
        store = createTestStore();
        store.createSpace('space1', 'Space 1');
        store.createSpace('space2', 'Space 2');
        await store.addMemory('space1', 'mem1', 'content', { tier: 1 });
        await store.addMemory('space2', 'mem2', 'content', { tier: 2 });

        const status = store.getStatus('space1');
        expect(status.total_spaces).toBe(1);
        expect(status.total_memories).toBe(1);
        expect(status.by_tier.find((b) => b.tier === 1)!.count).toBe(1);
        expect(status.by_tier.find((b) => b.tier === 2)!.count).toBe(0);
    });

    test('should show pinned count in status', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const m1 = await store.addMemory('test', 'mem1', 'content', { tier: 1 });
        await store.addMemory('test', 'mem2', 'content', { tier: 1 });
        store.pin(m1.id);

        const status = store.getStatus('test');
        expect(status.by_tier.find((b) => b.tier === 1)!.pinned).toBe(1);
        expect(status.by_tier.find((b) => b.tier === 1)!.count).toBe(2);
    });
});

describe('MindStore — Links', () => {
    test('should create and retrieve links', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = await store.addMemory('test', 'mem1', 'content');
        const mem2 = await store.addMemory('test', 'mem2', 'content');

        store.link(mem1.id, mem2.id, 'depends-on');

        const links = store.getLinks(mem1.id);
        expect(links.length).toBe(1);
        expect(links[0]!.label).toBe('depends-on');
        expect(links[0]!.target_name).toBe('mem2');

        // Also visible from target side
        const links2 = store.getLinks(mem2.id);
        expect(links2.length).toBe(1);
    });

    test('should unlink memories', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = await store.addMemory('test', 'mem1', 'content');
        const mem2 = await store.addMemory('test', 'mem2', 'content');

        store.link(mem1.id, mem2.id);
        store.unlink(mem1.id, mem2.id);

        const links = store.getLinks(mem1.id);
        expect(links.length).toBe(0);
    });

    test('should not link a memory to itself', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem1', 'content');

        expect(() => store.link(mem.id, mem.id)).toThrow('itself');
    });

    test('should cascade delete links when memory is deleted', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = await store.addMemory('test', 'mem1', 'content');
        const mem2 = await store.addMemory('test', 'mem2', 'content');

        store.link(mem1.id, mem2.id);
        store.deleteMemory(mem1.id);

        const links = store.getLinks(mem2.id);
        expect(links.length).toBe(0);
    });
});

describe('MindStore — Search', () => {
    test('should find memories by full-text search', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'auth-flow', 'JWT authentication with refresh tokens');
        await store.addMemory('test', 'db-schema', 'PostgreSQL with Prisma ORM');

        const results = await store.search('authentication');
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('auth-flow');
    });

    test('should search by name', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'auth-flow', 'some content');
        await store.addMemory('test', 'other', 'other content');

        const results = await store.search('auth');
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('auth-flow');
    });

    test('should filter search by space', async () => {
        store = createTestStore();
        store.createSpace('proj-a', 'Project A');
        store.createSpace('proj-b', 'Project B');
        await store.addMemory('proj-a', 'auth', 'authentication');
        await store.addMemory('proj-b', 'auth', 'authentication');

        const results = await store.search('authentication', { space: 'proj-a' });
        expect(results.length).toBe(1);
        expect(results[0]!.space_name).toBe('proj-a');
    });

    test('should filter search by tier', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'hot-auth', 'authentication', { tier: 1 });
        await store.addMemory('test', 'cold-auth', 'authentication', { tier: 3 });

        const results = await store.search('authentication', { tier: 1 });
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('hot-auth');
    });

    test('should search T4 memories (frozen are searchable)', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'frozen', 'authentication token', { tier: 3 });
        store.demote(mem.id); // T3 → T4

        const results = await store.search('authentication');
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('frozen');
        expect(results[0]!.tier).toBe(4);
        // Verify similarity field exists (undefined when RAG disabled, number when enabled)
        expect('similarity' in results[0]!).toBe(true);
    });

    test('should return empty for no matches', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem1', 'content');

        const results = await store.search('nonexistent');
        expect(results.length).toBe(0);
    });

    test('should use deterministic hybrid order when RAG is enabled and FTS has hits', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'auth-a', 'authentication token');
        await store.addMemory('test', 'auth-b', 'authentication token');

        const ragEnabledSpy = spyOn(ragHelpers, 'isRagEnabled').mockReturnValue(true);
        const semanticSpy = spyOn(ragHelpers, 'semanticSearch').mockResolvedValue([
            { id: store.getMemory('test', 'auth-b')!.id, score: 0.95 },
            { id: store.getMemory('test', 'auth-a')!.id, score: 0.1 },
        ]);

        const results = await store.search('authentication', { space: 'test' });
        expect(results.length).toBe(2);
        expect(results[0]!.name).toBe('auth-b');

        semanticSpy.mockRestore();
        ragEnabledSpy.mockRestore();
    });

    test('should use semantic threshold fallback when FTS has no hits and RAG is enabled', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'alpha', 'one');
        await store.addMemory('test', 'beta', 'two');

        const alphaId = store.getMemory('test', 'alpha')!.id;
        const betaId = store.getMemory('test', 'beta')!.id;

        const ragEnabledSpy = spyOn(ragHelpers, 'isRagEnabled').mockReturnValue(true);
        const semanticSpy = spyOn(ragHelpers, 'semanticSearch').mockResolvedValue([
            { id: alphaId, score: 0.35 },
            { id: betaId, score: 0.25 },
        ]);

        const results = await store.search('query-with-no-fts-hit', { space: 'test' });
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('alpha');

        semanticSpy.mockRestore();
        ragEnabledSpy.mockRestore();
    });
});

describe('MindStore — Query', () => {
    test('should default queryMemories page size to 25', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');

        for (let i = 0; i < 30; i++) {
            await store.addMemory('test', `mem-${i}`, `content-${i}`);
        }

        const results = store.queryMemories();
        expect(results.length).toBe(25);
    });

    test('should query memories with metadata filters', async () => {
        store = createTestStore();
        store.createSpace('proj-a', 'Project A');
        store.createSpace('proj-b', 'Project B');
        await store.addMemory('proj-a', 'auth', 'authentication', { tier: 1, tags: ['backend'] });
        await store.addMemory('proj-a', 'ui', 'frontend', { tier: 2, tags: ['frontend'] });
        await store.addMemory('proj-b', 'api', 'rest', { tier: 1, tags: ['backend'] });

        const results = store.queryMemories({ space: 'proj-a', tier: 1, tag: 'backend' });
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('auth');
        expect(results[0]!.space_name).toBe('proj-a');
    });

    test('should support pagination in queryMemories', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem-a', 'a');
        await store.addMemory('test', 'mem-b', 'b');
        await store.addMemory('test', 'mem-c', 'c');

        const page1 = store.queryMemories({ limit: 2, offset: 0 });
        const page2 = store.queryMemories({ limit: 2, offset: 2 });

        expect(page1.length).toBe(2);
        expect(page2.length).toBe(1);
        expect(page1[0]!.name).not.toBe(page2[0]!.name);
    });

    test('should filter queryMemories by updated_at date bounds', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        await store.addMemory('test', 'mem-a', 'content');

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const results = store.queryMemories({ from: tomorrow });

        expect(results.length).toBe(0);
    });
});

describe('MindStore — Import', () => {
    test('should import legacy brain.json format', () => {
        store = createTestStore();
        store.importFromJson({
            'my-space': {
                description: 'A space',
                memories: [
                    { name: 'mem1', description: 'content 1' },
                    { name: 'mem2', description: 'content 2' },
                ],
            },
            'empty-space': {
                description: 'Empty',
                memories: [],
            },
        });

        const spaces = store.listSpaces();
        expect(spaces.length).toBe(2);

        const mem = store.getMemory('my-space', 'mem1');
        expect(mem).not.toBeNull();
        expect(mem!.content).toBe('content 1');
        expect(mem!.tier).toBe(2); // default tier
    });
});

describe('MindStore — RAG Integration', () => {
    test('should calculate cosine similarity correctly', () => {
        const { cosineSimilarity } = require('../src/helpers/rag');

        // Identical vectors should have similarity 1
        const v1 = [1, 0, 0];
        const v2 = [1, 0, 0];
        expect(cosineSimilarity(v1, v2)).toBeCloseTo(1, 5);

        // Orthogonal vectors should have similarity 0
        const v3 = [1, 0, 0];
        const v4 = [0, 1, 0];
        expect(cosineSimilarity(v3, v4)).toBeCloseTo(0, 5);

        // Opposite vectors should have similarity -1
        const v5 = [1, 0, 0];
        const v6 = [-1, 0, 0];
        expect(cosineSimilarity(v5, v6)).toBeCloseTo(-1, 5);

        // Similar vectors should have high positive similarity
        const v7 = [1, 2, 3];
        const v8 = [2, 4, 6];
        expect(cosineSimilarity(v7, v8)).toBeCloseTo(1, 5);
    });

    test('should convert between blob and vector', () => {
        const { vectorToBlob, blobToVector } = require('../src/helpers/rag');

        const original = new Float32Array([1.5, -2.3, 4.7, 0.0]);
        const blob = vectorToBlob(Array.from(original));
        const restored = blobToVector(blob);

        expect(restored.length).toBe(original.length);
        for (let i = 0; i < original.length; i++) {
            expect(restored[i]!).toBeCloseTo(original[i]!, 5);
        }
    });

    test('should check RAG enabled/disabled from config', () => {
        const { isRagEnabled } = require('../src/helpers/rag');

        // RAG is disabled by default in tests (no env vars)
        expect(isRagEnabled()).toBe(false);
    });
});
