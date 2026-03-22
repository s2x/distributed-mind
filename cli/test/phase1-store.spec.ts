import { describe, expect, test, afterEach } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import type { MindStore } from '../src/store/mind-store';
import type { HotMemorySummary } from '../src/types';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

describe('Phase 1.2 — MindStore interface: getHotMemories', () => {
    test('getHotMemories should return HotMemorySummary[] for a space', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['test']);
        await store.addMemory('test', 'mem1', 'content', { tags: ['backend'], tier: 1 });
        await store.addMemory('test', 'mem2', 'content', { tags: ['frontend'], tier: 2 });
        await store.addMemory('test', 'mem3', 'content', { tags: ['archive'], tier: 3 });
        await store.addMemory('test', 'mem4', 'content', { tags: ['old'], tier: 4 });

        const hot = (store as any).getHotMemories('test');

        expect(Array.isArray(hot)).toBe(true);
        expect(hot.length).toBe(2); // only T1 + T2

        const names = hot.map((m: HotMemorySummary) => m.name).sort();
        expect(names).toEqual(['mem1', 'mem2']);
    });

    test('getHotMemories should return correct HotMemorySummary fields', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['test']);
        const mem = await store.addMemory('test', 'hot-mem', 'some content', {
            tags: ['project', 'important'],
            tier: 1,
            pinned: true,
        });

        const hot = (store as any).getHotMemories('test');

        expect(hot.length).toBe(1);
        const summary = hot[0] as HotMemorySummary;
        expect(summary.id).toBe(mem.id);
        expect(summary.name).toBe('hot-mem');
        expect(summary.tier).toBe(1);
        expect(summary.tags).toContain('project');
        expect(summary.tags).toContain('important');
        expect(summary.pinned).toBe(true);
        expect(typeof summary.updated_at).toBe('string');
        expect(summary.updated_at.length).toBeGreaterThan(0);
    });

    test('getHotMemories should return empty array when no memories', () => {
        store = createTestStore();
        store.createSpace('empty', 'Empty space', ['test']);

        const hot = (store as any).getHotMemories('empty');
        expect(hot).toEqual([]);
    });

    test('getHotMemories should return empty array for non-existent space', () => {
        store = createTestStore();

        const hot = (store as any).getHotMemories('non-existent');
        expect(hot).toEqual([]);
    });
});

describe('Phase 1.2 — MindStore interface: resolveMemoryRef', () => {
    test('resolveMemoryRef should parse "space:name" correctly', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef('projects/mind:my-memory');

        expect(result).not.toBeNull();
        expect(result!.space).toBe('projects/mind');
        expect(result!.name).toBe('my-memory');
    });

    test('resolveMemoryRef should handle names with colons', () => {
        store = createTestStore();

        // The first colon is the separator; everything after is the memory name
        const result = (store as any).resolveMemoryRef('my-space:mem:with:colons');

        expect(result).not.toBeNull();
        expect(result!.space).toBe('my-space');
        expect(result!.name).toBe('mem:with:colons');
    });

    test('resolveMemoryRef should return null for invalid format (no colon)', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef('no-colon');
        expect(result).toBeNull();
    });

    test('resolveMemoryRef should return null for empty string', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef('');
        expect(result).toBeNull();
    });

    test('resolveMemoryRef should return null for space-only (empty name after colon)', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef('space-only:');
        expect(result).toBeNull();
    });

    test('resolveMemoryRef should return null for empty space (leading colon)', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef(':memory-name');
        expect(result).toBeNull();
    });
});

describe('Phase 1.3 — SQLite store implementation: getHotMemories', () => {
    test('getHotMemories returns T1 + T2 only (not T3/T4)', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['test']);
        await store.addMemory('test', 't1', 'content', { tier: 1, tags: ['test'] });
        await store.addMemory('test', 't2', 'content', { tier: 2, tags: ['test'] });
        await store.addMemory('test', 't3', 'content', { tier: 3, tags: ['test'] });
        const t4Mem = await store.addMemory('test', 't4', 'content', { tier: 3, tags: ['test'] });
        store.demote(t4Mem.id); // → T4

        const hot = (store as any).getHotMemories('test');
        const names = hot.map((m: HotMemorySummary) => m.name).sort();

        expect(names).toEqual(['t1', 't2']);
        expect(names).not.toContain('t3');
        expect(names).not.toContain('t4');
    });

    test('getHotMemories includes pinned status correctly', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['test']);
        const pinned = await store.addMemory('test', 'pinned', 'content', { tier: 1, pinned: true, tags: ['test'] });
        const notPinned = await store.addMemory('test', 'free', 'content', { tier: 2, pinned: false, tags: ['test'] });

        const hot = (store as any).getHotMemories('test');

        const pinnedMem = hot.find((m: HotMemorySummary) => m.name === 'pinned');
        const freeMem = hot.find((m: HotMemorySummary) => m.name === 'free');
        expect(pinnedMem!.pinned).toBe(true);
        expect(freeMem!.pinned).toBe(false);
    });

    test('getHotMemories returns hot memories sorted by tier then name', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['test']);
        await store.addMemory('test', 'warm-a', 'content', { tier: 2, tags: ['test'] });
        await store.addMemory('test', 'hot-a', 'content', { tier: 1, tags: ['test'] });
        await store.addMemory('test', 'warm-b', 'content', { tier: 2, tags: ['test'] });
        await store.addMemory('test', 'hot-b', 'content', { tier: 1, tags: ['test'] });

        const hot = (store as any).getHotMemories('test');

        expect(hot.length).toBe(4);
        // T1 memories should come before T2
        const t1Memories = hot.filter((m: HotMemorySummary) => m.tier === 1);
        const t2Memories = hot.filter((m: HotMemorySummary) => m.tier === 2);
        expect(t1Memories.length).toBe(2);
        expect(t2Memories.length).toBe(2);
    });
});

describe('Phase 1.3 — SQLite store implementation: resolveMemoryRef', () => {
    test('resolveMemoryRef parses simple space:name', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef('test:auth-flow');
        expect(result).toEqual({ space: 'test', name: 'auth-flow' });
    });

    test('resolveMemoryRef handles nested path as space name', () => {
        store = createTestStore();

        const result = (store as any).resolveMemoryRef('projects/mind:session-2024');
        expect(result).toEqual({ space: 'projects/mind', name: 'session-2024' });
    });

    test('resolveMemoryRef returns null when no colon', () => {
        store = createTestStore();

        expect((store as any).resolveMemoryRef('just-a-name')).toBeNull();
    });

    test('resolveMemoryRef returns null for whitespace-only', () => {
        store = createTestStore();

        expect((store as any).resolveMemoryRef('   ')).toBeNull();
    });

    test('resolveMemoryRef returns null for colon-only', () => {
        store = createTestStore();

        expect((store as any).resolveMemoryRef(':')).toBeNull();
    });
});
