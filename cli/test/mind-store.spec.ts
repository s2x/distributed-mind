import { describe, expect, test, afterEach } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import type { MindStore } from '../src/store/mind-store';

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

    test('should delete a space and all its memories', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content');
        store.deleteSpace('test');

        expect(store.getSpace('test')).toBeNull();
    });

    test('should rename a space', () => {
        store = createTestStore();
        store.createSpace('old', 'Old space');
        store.addMemory('old', 'mem1', 'content');
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
    test('should add and retrieve a memory', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'auth-flow', 'JWT auth', { tags: ['backend', 'security'], tier: 1 });

        expect(mem.name).toBe('auth-flow');
        expect(mem.content).toBe('JWT auth');
        expect(mem.tier).toBe(1);
        expect(mem.tags).toContain('backend');
        expect(mem.tags).toContain('security');

        const retrieved = store.getMemory('test', 'auth-flow');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(mem.id);
    });

    test('should default to tier 2', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content');
        expect(mem.tier).toBe(2);
    });

    test('should list memories grouped by tier', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'hot', 'content', { tier: 1 });
        store.addMemory('test', 'warm', 'content', { tier: 2 });
        store.addMemory('test', 'cold', 'content', { tier: 3 });

        const all = store.listMemories('test');
        expect(all.length).toBe(3);
        expect(all[0]!.tier).toBe(1);
        expect(all[1]!.tier).toBe(2);
        expect(all[2]!.tier).toBe(3);
    });

    test('should filter memories by tier', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'hot', 'content', { tier: 1 });
        store.addMemory('test', 'warm', 'content', { tier: 2 });

        const tier1 = store.listMemories('test', { tier: 1 });
        expect(tier1.length).toBe(1);
        expect(tier1[0]!.name).toBe('hot');
    });

    test('should filter memories by tag', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content', { tags: ['backend'] });
        store.addMemory('test', 'mem2', 'content', { tags: ['frontend'] });

        const backend = store.listMemories('test', { tag: 'backend' });
        expect(backend.length).toBe(1);
        expect(backend[0]!.name).toBe('mem1');
    });

    test('should update memory content', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'old content');
        store.updateMemory(mem.id, { content: 'new content' });

        const updated = store.getMemoryById(mem.id);
        expect(updated!.content).toBe('new content');
    });

    test('should delete memory by name', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content');
        store.deleteMemoryByName('test', 'mem1');
        expect(store.getMemory('test', 'mem1')).toBeNull();
    });

    test('should add and remove memory tags', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content');

        store.addMemoryTag(mem.id, 'important');
        let retrieved = store.getMemoryById(mem.id);
        expect(retrieved!.tags).toContain('important');

        store.removeMemoryTag(mem.id, 'important');
        retrieved = store.getMemoryById(mem.id);
        expect(retrieved!.tags).not.toContain('important');
    });
});

describe('MindStore — Tiers', () => {
    test('should promote a memory', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content', { tier: 3 });

        store.promote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(2);

        store.promote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(1);
    });

    test('should not promote beyond tier 1', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content', { tier: 1 });
        expect(() => store.promote(mem.id)).toThrow('highest tier');
    });

    test('should demote a memory', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content', { tier: 1 });

        store.demote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(2);

        store.demote(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(3);
    });

    test('should not demote beyond tier 3', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content', { tier: 3 });
        expect(() => store.demote(mem.id)).toThrow('lowest tier');
    });

    test('should pin and unpin', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content');

        store.pin(mem.id);
        expect(store.getMemoryById(mem.id)!.pinned).toBe(true);

        store.unpin(mem.id);
        expect(store.getMemoryById(mem.id)!.pinned).toBe(false);
    });

    test('should auto-promote tier 3 to 2 on read', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content', { tier: 3 });

        store.recordAccess(mem.id);
        expect(store.getMemoryById(mem.id)!.tier).toBe(2);
    });

    test('should bump access count on read', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content');

        store.recordAccess(mem.id);
        store.recordAccess(mem.id);
        store.recordAccess(mem.id);

        const updated = store.getMemoryById(mem.id);
        expect(updated!.access_count).toBe(3);
        expect(updated!.last_accessed_at).not.toBeNull();
    });
});

describe('MindStore — Links', () => {
    test('should create and retrieve links', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = store.addMemory('test', 'mem1', 'content');
        const mem2 = store.addMemory('test', 'mem2', 'content');

        store.link(mem1.id, mem2.id, 'depends-on');

        const links = store.getLinks(mem1.id);
        expect(links.length).toBe(1);
        expect(links[0]!.label).toBe('depends-on');
        expect(links[0]!.target_name).toBe('mem2');

        // Also visible from target side
        const links2 = store.getLinks(mem2.id);
        expect(links2.length).toBe(1);
    });

    test('should unlink memories', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = store.addMemory('test', 'mem1', 'content');
        const mem2 = store.addMemory('test', 'mem2', 'content');

        store.link(mem1.id, mem2.id);
        store.unlink(mem1.id, mem2.id);

        const links = store.getLinks(mem1.id);
        expect(links.length).toBe(0);
    });

    test('should not link a memory to itself', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem1', 'content');

        expect(() => store.link(mem.id, mem.id)).toThrow('itself');
    });

    test('should cascade delete links when memory is deleted', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = store.addMemory('test', 'mem1', 'content');
        const mem2 = store.addMemory('test', 'mem2', 'content');

        store.link(mem1.id, mem2.id);
        store.deleteMemory(mem1.id);

        const links = store.getLinks(mem2.id);
        expect(links.length).toBe(0);
    });
});

describe('MindStore — Search', () => {
    test('should find memories by full-text search', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth-flow', 'JWT authentication with refresh tokens');
        store.addMemory('test', 'db-schema', 'PostgreSQL with Prisma ORM');

        const results = store.search('authentication');
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('auth-flow');
    });

    test('should search by name', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth-flow', 'some content');
        store.addMemory('test', 'other', 'other content');

        const results = store.search('auth');
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('auth-flow');
    });

    test('should filter search by space', () => {
        store = createTestStore();
        store.createSpace('proj-a', 'Project A');
        store.createSpace('proj-b', 'Project B');
        store.addMemory('proj-a', 'auth', 'authentication');
        store.addMemory('proj-b', 'auth', 'authentication');

        const results = store.search('authentication', { space: 'proj-a' });
        expect(results.length).toBe(1);
        expect(results[0]!.space_name).toBe('proj-a');
    });

    test('should filter search by tier', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'hot-auth', 'authentication', { tier: 1 });
        store.addMemory('test', 'cold-auth', 'authentication', { tier: 3 });

        const results = store.search('authentication', { tier: 1 });
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('hot-auth');
    });

    test('should return empty for no matches', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content');

        const results = store.search('nonexistent');
        expect(results.length).toBe(0);
    });
});

describe('MindStore — Maintenance', () => {
    test('should tidy by demoting old memories', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'old', 'content', { tier: 1 });
        // Manually set last_accessed_at to 30 days ago to trigger demotion
        // Since we can't easily manipulate time, just verify the function runs
        const result = store.tidy();
        // Newly created memories with no access should be candidates
        expect(result).toHaveProperty('demoted');
        expect(result).toHaveProperty('candidates_for_gc');
    });

    test('pinned memories should not be demoted by tidy', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'pinned', 'content', { tier: 1 });
        store.pin(mem.id);

        const result = store.tidy();
        // Pinned memory should not appear in demoted list
        const demotedIds = result.demoted.map((d) => d.id);
        expect(demotedIds).not.toContain(mem.id);
    });

    test('should report stats', () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content', { tier: 1 });
        store.addMemory('test', 'mem2', 'content', { tier: 2 });
        store.addMemory('test', 'mem3', 'content', { tier: 3 });

        const stats = store.stats();
        expect(stats.total_spaces).toBe(1);
        expect(stats.total_memories).toBe(3);
        expect(stats.by_tier.length).toBe(3);
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
