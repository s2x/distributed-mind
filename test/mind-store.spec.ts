import { describe, expect, test, afterEach, spyOn } from 'bun:test';

import * as ragHelpers from '../src/helpers/rag';
import type { MindStore } from '../src/store/mind-store';

import { createTestStore } from './mocks/test-store';

let store: MindStore & { cleanup: () => void };

afterEach(async () => {
  store?.cleanup();
});

describe('MindStore — Spaces', () => {
  test('should create and retrieve a space', async () => {
    store = createTestStore();
    await store.createSpace('test', 'A test space', ['project', 'dev']);

    const space = await store.getSpace('test');
    expect(space).not.toBeNull();
    expect(space!.name).toBe('test');
    expect(space!.description).toBe('A test space');
    expect(space!.tags).toContain('project');
    expect(space!.tags).toContain('dev');
  });

  test('should throw when creating duplicate space', async () => {
    store = createTestStore();
    await store.createSpace('test', 'A test space', ['test']);
    await expect(store.createSpace('test', 'Another', ['test'])).rejects.toThrow('already exists');
  });

  test('should list spaces', async () => {
    store = createTestStore();
    await store.createSpace('alpha', 'First', ['test']);
    await store.createSpace('beta', 'Second', ['test']);

    const spaces = await store.listSpaces();
    expect(spaces.length).toBe(2);
    expect(spaces[0]!.name).toBe('alpha');
    expect(spaces[1]!.name).toBe('beta');
  });

  test('should list spaces filtered by tag', async () => {
    store = createTestStore();
    await store.createSpace('proj-a', 'Project A', ['project']);
    await store.createSpace('personal', 'Personal', ['personal']);

    const projects = await store.listSpaces({ tag: 'project' });
    expect(projects.length).toBe(1);
    expect(projects[0]!.name).toBe('proj-a');
  });

  test('should delete a space and all its memories', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.deleteSpace('test');

    expect(await store.getSpace('test')).toBeNull();
  });

  test('should rename a space', async () => {
    store = createTestStore();
    await store.createSpace('old', 'Old space', ['test']);
    await store.addMemory('old', 'mem1', 'content', { tags: ['test'] });
    await store.renameSpace('old', 'new');

    expect(await store.getSpace('old')).toBeNull();
    expect(await store.getSpace('new')).not.toBeNull();
    // Memories should follow
    expect(await store.getMemory('new', 'mem1')).not.toBeNull();
  });

  test('should update space description', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Old description', ['test']);
    await store.updateSpace('test', { description: 'New description' });

    const space = await store.getSpace('test');
    expect(space!.description).toBe('New description');
  });

  test('should add and remove space tags', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addSpaceTag('test', 'project');
    await store.addSpaceTag('test', 'active');

    let space = await store.getSpace('test');
    expect(space!.tags).toContain('project');
    expect(space!.tags).toContain('active');

    await store.removeSpaceTag('test', 'active');
    space = await store.getSpace('test');
    expect(space!.tags).not.toContain('active');
    expect(space!.tags).toContain('project');
  });
});

describe('MindStore — Memories', () => {
  test('should add and retrieve a memory', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'auth-flow', 'JWT auth', {
      tags: ['backend', 'security'],
      tier: 1,
    });

    expect(mem.name).toBe('auth-flow');
    expect(mem.content).toBe('JWT auth');
    expect(mem.tier).toBe(1);
    expect(mem.tags).toContain('backend');
    expect(mem.tags).toContain('security');
    expect(mem.changed_at).toBeTruthy();

    const retrieved = await store.getMemory('test', 'auth-flow');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(mem.id);
  });

  test('should not update changed_at on read access', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3, tags: ['test'] });
    const before = (await store.getMemoryById(mem.id))!;

    await new Promise(resolve => setTimeout(resolve, 1100));
    await store.recordAccess(mem.id);

    const after = (await store.getMemoryById(mem.id))!;
    expect(after.changed_at).toBe(before.changed_at);
    expect(after.tier).toBe(2); // still auto-promotes
  });

  test('should update changed_at on semantic memory changes', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const before = (await store.getMemoryById(mem.id))!;

    await new Promise(resolve => setTimeout(resolve, 1100));
    await store.updateMemory(mem.id, { content: 'new content' });

    const after = (await store.getMemoryById(mem.id))!;
    expect(after.changed_at).not.toBe(before.changed_at);
  });

  test('should default to tier 2', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    expect(mem.tier).toBe(2);
  });

  test('should list memories — default returns T1+T2 only', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'warm', 'content', { tier: 2, tags: ['test'] });
    await store.addMemory('test', 'cold', 'content', { tier: 3, tags: ['test'] });

    const active = await store.listMemories('test');
    expect(active.length).toBe(2);
    expect(active[0]!.tier).toBe(1);
    expect(active[1]!.tier).toBe(2);
    // cold (T3) should not appear
    expect(active.some(m => m.name === 'cold')).toBe(false);
  });

  test('should list memories — explicit tier 3 returns cold', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'cold', 'content', { tier: 3, tags: ['test'] });

    const cold = await store.listMemories('test', { tier: 3, tag: 'test' });
    expect(cold.length).toBe(1);
    expect(cold[0]!.name).toBe('cold');
  });

  test('should filter memories by tier', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'warm', 'content', { tier: 2, tags: ['test'] });

    const tier1 = await store.listMemories('test', { tier: 1, tag: 'test' });
    expect(tier1.length).toBe(1);
    expect(tier1[0]!.name).toBe('hot');
  });

  test('should filter memories by tag', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['backend'] });
    await store.addMemory('test', 'mem2', 'content', { tags: ['frontend'] });

    const backend = await store.listMemories('test', { tag: 'backend' });
    expect(backend.length).toBe(1);
    expect(backend[0]!.name).toBe('mem1');
  });

  test('should update memory content', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'old content', { tags: ['test'] });
    await store.updateMemory(mem.id, { content: 'new content' });

    const updated = await store.getMemoryById(mem.id);
    expect(updated!.content).toBe('new content');
  });

  test('should delete memory by name', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.deleteMemoryByName('test', 'mem1');
    expect(await store.getMemory('test', 'mem1')).toBeNull();
  });

  test('should add and remove memory tags', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await store.addMemoryTag(mem.id, 'important');
    let retrieved = await store.getMemoryById(mem.id);
    expect(retrieved!.tags).toContain('important');

    await store.removeMemoryTag(mem.id, 'important');
    retrieved = await store.getMemoryById(mem.id);
    expect(retrieved!.tags).not.toContain('important');
  });
});

describe('MindStore — Tiers', () => {
  test('should promote a memory', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3, tags: ['test'] });

    await store.promote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(2);

    await store.promote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(1);
  });

  test('should not promote beyond tier 1', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 1, tags: ['test'] });
    await expect(store.promote(mem.id)).rejects.toThrow('highest tier');
  });

  test('should demote a memory', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 1, tags: ['test'] });

    await store.demote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(2);

    await store.demote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(3);
  });

  test('should demote from T3 to T2 (T3 is now the lowest tier)', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 2, tags: ['test'] });
    await store.demote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(3);
  });

  test('should not demote beyond tier 3 (T3 is now the lowest tier)', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    // Add at T3 and try to demote - should throw since T3 is lowest
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3, tags: ['test'] });
    await expect(store.demote(mem.id)).rejects.toThrow('lowest tier');
  });

  test('should pin and unpin', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await store.pin(mem.id);
    expect((await store.getMemoryById(mem.id))!.pinned).toBe(true);

    await store.unpin(mem.id);
    expect((await store.getMemoryById(mem.id))!.pinned).toBe(false);
  });

  test('should auto-promote tier 3 to 2 on read', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 2, tags: ['test'] });

    await store.recordAccess(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(1);
  });

  test('should not auto-promote pinned memory on read', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 2, tags: ['test'] });
    await store.pin(mem.id);

    await store.recordAccess(mem.id);
    // Pinned: stays at T2
    expect((await store.getMemoryById(mem.id))!.tier).toBe(2);
  });

  test('should bump access count on read', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await store.recordAccess(mem.id);
    await store.recordAccess(mem.id);
    await store.recordAccess(mem.id);

    const updated = await store.getMemoryById(mem.id);
    expect(updated!.access_count).toBe(3);
    expect(updated!.last_accessed_at).not.toBeNull();
  });
});

describe('MindStore — LRU Eviction', () => {
  test('should evict LRU non-pinned memory when tier is full', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);

    // Fill T1 to limit (25)
    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];
    for (let i = 0; i < limit; i++) {
      await store.addMemory('test', `mem-${i}`, 'content', { tier: 1, tags: ['test'] });
    }

    // Adding one more to T1 should evict the LRU (mem-0) to T2
    await store.addMemory('test', 'overflow', 'content', { tier: 1, tags: ['test'] });

    // overflow was added to T1
    expect((await store.getMemory('test', 'overflow'))!.tier).toBe(1);
    // LRU (mem-0) was evicted to T2
    expect((await store.getMemory('test', 'mem-0'))!.tier).toBe(2);
    // Other T1 memories remain at T1
    expect((await store.getMemory('test', 'mem-1'))!.tier).toBe(1);
  });

  test('should throw when tier is full and all memories are pinned', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];

    // Fill T1 with pinned memories
    for (let i = 0; i < limit; i++) {
      const m = await store.addMemory('test', `pinned-${i}`, 'content', {
        tier: 1,
        tags: ['test'],
      });
      await store.pin(m.id);
    }

    // Should throw — all T1 pinned
    await expect(
      store.addMemory('test', 'overflow', 'content', { tier: 1, tags: ['test'] })
    ).rejects.toThrow('pinned');
  });

  test('should not evict LRU from T3 (T3 is now unlimited)', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);

    // Add 100+ memories to T3 - T3 is unlimited, so no eviction
    for (let i = 0; i < 100; i++) {
      await store.addMemory('test', `cold-${i}`, 'content', { tier: 3, tags: ['test'] });
    }

    // Adding more to T3 should succeed with no eviction
    await store.addMemory('test', 'overflow', 'content', { tier: 3, tags: ['test'] });

    expect((await store.getMemory('test', 'overflow'))!.tier).toBe(3);
    expect((await store.getMemory('test', 'cold-0'))!.tier).toBe(3); // cold-0 should still be at T3
  });

  test('pinned memories should not be LRU-evicted', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];

    // Fill T1: first is pinned, rest are not
    const first = await store.addMemory('test', 'pinned-first', 'content', {
      tier: 1,
      tags: ['test'],
    });
    await store.pin(first.id);
    for (let i = 1; i < limit; i++) {
      await store.addMemory('test', `mem-${i}`, 'content', { tier: 1, tags: ['test'] });
    }

    // Add overflow → should evict mem-1 (LRU non-pinned), NOT pinned-first
    await store.addMemory('test', 'overflow', 'content', { tier: 1, tags: ['test'] });

    expect((await store.getMemory('test', 'pinned-first'))!.tier).toBe(1); // still T1
    expect((await store.getMemory('test', 'mem-1'))!.tier).toBe(2); // evicted to T2
  });

  test('recordAccess promotion should silently skip if destination full and all pinned', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];

    // Fill T1 with pinned memories
    for (let i = 0; i < limit; i++) {
      const m = await store.addMemory('test', `pinned-${i}`, 'content', {
        tier: 1,
        tags: ['test'],
      });
      await store.pin(m.id);
    }

    // Add a T2 memory and access it — promotion to T1 should silently fail
    const t2mem = await store.addMemory('test', 'warm', 'content', { tier: 2, tags: ['test'] });
    await store.recordAccess(t2mem.id);

    // Should remain at T2 (not throw)
    expect((await store.getMemory('test', 'warm'))!.tier).toBe(2);
    // Access count should still bump
    expect((await store.getMemory('test', 'warm'))!.access_count).toBe(1);
  });
});

describe('MindStore — Space Graph', () => {
  test('should return graph nodes with minimal payload including T1-T3 and directed links', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const a = await store.addMemory('test', 'A', 'content', { tier: 1, tags: ['test'] });
    const b = await store.addMemory('test', 'B', 'content', { tier: 2, tags: ['test'] });
    const c = await store.addMemory('test', 'C', 'content', { tier: 3, tags: ['test'] });

    await store.link(a.id, b.id);
    await store.link(c.id, a.id);

    const graph = await store.getSpaceGraph('test');
    expect(graph.nodes.length).toBe(3);
    expect(graph.meta.total_nodes).toBe(3);
    expect(graph.meta.truncated).toBe(false);

    const cNode = graph.nodes.find(node => node.id === c.id)!;
    expect(cNode.tier).toBe(3);
    expect(cNode.links_to).toEqual([a.id]);

    const aNode = graph.nodes.find(node => node.id === a.id)!;
    expect(aNode.links_to).toEqual([b.id]);
    expect(aNode.linked_by).toEqual([c.id]);
    expect(Object.keys(aNode).sort()).toEqual(['id', 'linked_by', 'links_to', 'name', 'tier']);
  });

  test('should enforce cap and expose truncation metadata', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    for (let i = 0; i < 10; i++) {
      await store.addMemory('test', `m-${i}`, 'content', { tier: 2, tags: ['test'] });
    }

    const graph = await store.getSpaceGraph('test', { limit: 3, maxLimit: 5 });
    expect(graph.nodes.length).toBe(3);
    expect(graph.meta.requested_limit).toBe(3);
    expect(graph.meta.applied_limit).toBe(3);
    expect(graph.meta.max_limit).toBe(5);
    expect(graph.meta.total_nodes).toBe(10);
    expect(graph.meta.truncated).toBe(true);
  });
});

describe('MindStore — Status', () => {
  test('should return global status', async () => {
    store = createTestStore();
    await store.createSpace('space1', 'Space 1', ['test']);
    await store.createSpace('space2', 'Space 2', ['test']);
    await store.addMemory('space1', 'mem1', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('space1', 'mem2', 'content', { tier: 2, tags: ['test'] });
    await store.addMemory('space2', 'mem3', 'content', { tier: 3, tags: ['test'] });

    const status = await store.getStatus();
    expect(status.total_spaces).toBe(2);
    expect(status.total_memories).toBe(3);
    expect(status.by_tier.length).toBe(3); // always 3 tiers
    expect(status.by_tier.find(b => b.tier === 1)!.count).toBe(1);
    expect(status.by_tier.find(b => b.tier === 2)!.count).toBe(1);
    expect(status.by_tier.find(b => b.tier === 3)!.count).toBe(1);
    expect(status.db_path).toContain('.db');
    expect(status.db_size_bytes).toBeGreaterThan(0);
  });

  test('should return space-scoped status', async () => {
    store = createTestStore();
    await store.createSpace('space1', 'Space 1', ['test']);
    await store.createSpace('space2', 'Space 2', ['test']);
    await store.addMemory('space1', 'mem1', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('space2', 'mem2', 'content', { tier: 2, tags: ['test'] });

    const status = await store.getStatus('space1');
    expect(status.total_spaces).toBe(1);
    expect(status.total_memories).toBe(1);
    expect(status.by_tier.find(b => b.tier === 1)!.count).toBe(1);
    expect(status.by_tier.find(b => b.tier === 2)!.count).toBe(0);
  });

  test('should show pinned count in status', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const m1 = await store.addMemory('test', 'mem1', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'mem2', 'content', { tier: 1, tags: ['test'] });
    await store.pin(m1.id);

    const status = await store.getStatus('test');
    expect(status.by_tier.find(b => b.tier === 1)!.pinned).toBe(1);
    expect(status.by_tier.find(b => b.tier === 1)!.count).toBe(2);
  });
});

describe('MindStore — Links', () => {
  test('should create and retrieve links', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await store.link(mem1.id, mem2.id, 'depends-on');

    const links = await store.getLinks(mem1.id);
    expect(links.length).toBe(1);
    expect(links[0]!.label).toBe('depends-on');
    expect(links[0]!.target_name).toBe('mem2');

    // Also visible from target side
    const links2 = await store.getLinks(mem2.id);
    expect(links2.length).toBe(1);
  });

  test('should unlink memories', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await store.link(mem1.id, mem2.id);
    await store.unlink(mem1.id, mem2.id);

    const links = await store.getLinks(mem1.id);
    expect(links.length).toBe(0);
  });

  test('should not link a memory to itself', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await expect(store.link(mem.id, mem.id)).rejects.toThrow('itself');
  });

  test('should cascade delete links when memory is deleted', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await store.link(mem1.id, mem2.id);
    await store.deleteMemory(mem1.id);

    const links = await store.getLinks(mem2.id);
    expect(links.length).toBe(0);
  });
});

describe('MindStore — Search', () => {
  test('should find memories by full-text search', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth-flow', 'JWT authentication with refresh tokens', {
      tags: ['test'],
    });
    await store.addMemory('test', 'db-schema', 'PostgreSQL with Prisma ORM', { tags: ['test'] });

    const results = await store.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('auth-flow');
  });

  test('should search by name', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth-flow', 'some content', { tags: ['test'] });
    await store.addMemory('test', 'other', 'other content', { tags: ['test'] });

    const results = await store.search('auth');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('auth-flow');
  });

  test('should filter search by space', async () => {
    store = createTestStore();
    await store.createSpace('proj-a', 'Project A', ['test']);
    await store.createSpace('proj-b', 'Project B', ['test']);
    await store.addMemory('proj-a', 'auth', 'authentication', { tags: ['test'] });
    await store.addMemory('proj-b', 'auth', 'authentication', { tags: ['test'] });

    const results = await store.search('authentication', { space: 'proj-a' });
    expect(results.length).toBe(1);
    expect(results[0]!.space_name).toBe('proj-a');
  });

  test('should filter search by tier', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot-auth', 'authentication', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'cold-auth', 'authentication', { tier: 3, tags: ['test'] });

    const results = await store.search('authentication', { tier: 1, tag: 'test' });
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('hot-auth');
  });

  test('should search T3 memories (T3 is now unlimited)', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'cold-auth', 'authentication token', {
      tier: 3,
      tags: ['test'],
    });

    const results = await store.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('cold-auth');
    expect(results[0]!.tier).toBe(3);
    // Verify similarity field exists (undefined when RAG disabled, number when enabled)
    expect('similarity' in results[0]!).toBe(true);
  });

  test('should return empty for no matches', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    const results = await store.search('nonexistent');
    expect(results.length).toBe(0);
  });

  test('should use deterministic hybrid order when RAG is enabled and FTS has hits', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth-a', 'authentication token', { tags: ['test'] });
    await store.addMemory('test', 'auth-b', 'authentication token', { tags: ['test'] });

    const ragEnabledSpy = spyOn(ragHelpers, 'isRagEnabled').mockReturnValue(true);
    const semanticSpy = spyOn(ragHelpers, 'semanticSearch').mockResolvedValue([
      { id: (await store.getMemory('test', 'auth-b'))!.id, score: 0.95 },
      { id: (await store.getMemory('test', 'auth-a'))!.id, score: 0.1 },
    ]);

    const results = await store.search('authentication', { space: 'test' });
    expect(results.length).toBe(2);
    expect(results[0]!.name).toBe('auth-b');

    semanticSpy.mockRestore();
    ragEnabledSpy.mockRestore();
  });

  test('should use semantic threshold fallback when FTS has no hits and RAG is enabled', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'alpha', 'one', { tags: ['test'] });
    await store.addMemory('test', 'beta', 'two', { tags: ['test'] });

    const alphaId = (await store.getMemory('test', 'alpha'))!.id;
    const betaId = (await store.getMemory('test', 'beta'))!.id;

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
    await store.createSpace('test', 'Test', ['test']);

    for (let i = 0; i < 30; i++) {
      await store.addMemory('test', `mem-${i}`, `content-${i}`, { tags: ['test'] });
    }

    const results = await store.queryMemories();
    expect(results.length).toBe(25);
  });

  test('should query memories with metadata filters', async () => {
    store = createTestStore();
    await store.createSpace('proj-a', 'Project A', ['test']);
    await store.createSpace('proj-b', 'Project B', ['test']);
    await store.addMemory('proj-a', 'auth', 'authentication', { tier: 1, tags: ['backend'] });
    await store.addMemory('proj-a', 'ui', 'frontend', { tier: 2, tags: ['frontend'] });
    await store.addMemory('proj-b', 'api', 'rest', { tier: 1, tags: ['backend'] });

    const results = await store.queryMemories({ space: 'proj-a', tier: 1, tag: 'backend' });
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('auth');
    expect(results[0]!.space_name).toBe('proj-a');
  });

  test('should support pagination in queryMemories', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem-a', 'a', { tags: ['test'] });
    await store.addMemory('test', 'mem-b', 'b', { tags: ['test'] });
    await store.addMemory('test', 'mem-c', 'c', { tags: ['test'] });

    const page1 = await store.queryMemories({ limit: 2, offset: 0 });
    const page2 = await store.queryMemories({ limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);
    expect(page1[0]!.name).not.toBe(page2[0]!.name);
  });

  test('should filter queryMemories by updated_at date bounds', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem-a', 'content', { tags: ['test'] });

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const results = await store.queryMemories({ from: tomorrow });

    expect(results.length).toBe(0);
  });
});

describe('MindStore — Import', () => {
  test('should import legacy brain.json format', async () => {
    store = createTestStore();
    await store.importFromJson({
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

    const spaces = await store.listSpaces();
    expect(spaces.length).toBe(2);

    const mem = await store.getMemory('my-space', 'mem1');
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe('content 1');
    expect(mem!.tier).toBe(2); // default tier
  });
});

describe('MindStore — RAG Integration', () => {
  test('should calculate cosine similarity correctly', async () => {
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

  test('should convert between blob and vector', async () => {
    const { vectorToBlob, blobToVector } = require('../src/helpers/rag');

    const original = new Float32Array([1.5, -2.3, 4.7, 0.0]);
    const blob = vectorToBlob(Array.from(original));
    const restored = blobToVector(blob);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 5);
    }
  });

  test('should check RAG enabled/disabled from config', async () => {
    const { isRagEnabled } = require('../src/helpers/rag');

    // RAG is disabled by default in tests (no env vars)
    expect(isRagEnabled()).toBe(false);
  });
});

describe('MindStore — Logs', () => {
  test('should add a log entry', async () => {
    store = createTestStore();
    await store.createSpace('test', 'Test space', ['test']);

    await store.addLog({
      source: 'cli',
      operation: 'test_operation',
      level: 'info',
      inputData: { arg1: 'value1' },
      outputData: { result: 'success' },
      durationMs: 100,
    });

    const result = await store.queryLogs({});
    expect(result.logs.length).toBe(1);
    expect(result.logs[0]!.operation).toBe('test_operation');
    expect(result.logs[0]!.source).toBe('cli');
    expect(result.logs[0]!.level).toBe('info');
    expect(result.logs[0]!.duration_ms).toBe(100);
  });

  test('should query logs with source filter', async () => {
    store = createTestStore();

    await store.addLog({ source: 'cli', operation: 'cmd1' });
    await store.addLog({ source: 'mcp', operation: 'tool1' });
    await store.addLog({ source: 'api', operation: 'route1' });

    const cliLogs = await store.queryLogs({ source: 'cli' });
    expect(cliLogs.logs.length).toBe(1);
    expect(cliLogs.logs[0]!.source).toBe('cli');

    const mcpLogs = await store.queryLogs({ source: 'mcp' });
    expect(mcpLogs.logs.length).toBe(1);
    expect(mcpLogs.logs[0]!.source).toBe('mcp');
  });

  test('should query logs with multiple sources', async () => {
    store = createTestStore();

    await store.addLog({ source: 'cli', operation: 'cmd1' });
    await store.addLog({ source: 'mcp', operation: 'tool1' });
    await store.addLog({ source: 'api', operation: 'route1' });

    const cliMcpLogs = await store.queryLogs({ source: 'cli,mcp' });
    expect(cliMcpLogs.logs.length).toBe(2);
  });

  test('should query logs with operation filter', async () => {
    store = createTestStore();

    await store.addLog({ source: 'cli', operation: 'add' });
    await store.addLog({ source: 'cli', operation: 'list' });
    await store.addLog({ source: 'cli', operation: 'delete' });

    const addLogs = await store.queryLogs({ operation: 'add' });
    expect(addLogs.logs.length).toBe(1);
    expect(addLogs.logs[0]!.operation).toBe('add');
  });

  test('should query logs with text search', async () => {
    store = createTestStore();

    await store.addLog({
      source: 'cli',
      operation: 'memory_add',
      inputData: { space: 'projects/test', name: 'my-memory' },
    });
    await store.addLog({
      source: 'cli',
      operation: 'space_create',
      inputData: { name: 'other-space' },
    });

    const searchResult = await store.queryLogs({ search: 'memory' });
    expect(searchResult.logs.length).toBe(1);
    expect(searchResult.logs[0]!.operation).toBe('memory_add');
  });

  test('should query logs with level filter', async () => {
    store = createTestStore();

    await store.addLog({ source: 'cli', operation: 'info_op', level: 'info' });
    await store.addLog({ source: 'cli', operation: 'warn_op', level: 'warn' });
    await store.addLog({ source: 'cli', operation: 'error_op', level: 'error' });

    const errorLogs = await store.queryLogs({ level: 'error' });
    expect(errorLogs.logs.length).toBe(1);
    expect(errorLogs.logs[0]!.level).toBe('error');
  });

  test('should query logs with pagination', async () => {
    store = createTestStore();

    for (let i = 0; i < 25; i++) {
      await store.addLog({ source: 'cli', operation: `op_${i}` });
    }

    const page1 = await store.queryLogs({ limit: 10, offset: 0 });
    expect(page1.logs.length).toBe(10);
    expect(page1.total).toBe(25);
    expect(page1.limit).toBe(10);
    expect(page1.offset).toBe(0);

    const page2 = await store.queryLogs({ limit: 10, offset: 10 });
    expect(page2.logs.length).toBe(10);
    expect(page2.offset).toBe(10);

    const page3 = await store.queryLogs({ limit: 10, offset: 20 });
    expect(page3.logs.length).toBe(5);
    expect(page3.offset).toBe(20);
  });

  test('should query logs with order asc/desc', async () => {
    store = createTestStore();

    await store.addLog({ source: 'cli', operation: 'first' });
    await store.addLog({ source: 'cli', operation: 'second' });
    await store.addLog({ source: 'cli', operation: 'third' });

    const desc = await store.queryLogs({ order: 'desc' });
    expect(desc.logs[0]!.operation).toBe('third');

    const asc = await store.queryLogs({ order: 'asc' });
    expect(asc.logs[0]!.operation).toBe('first');
  });

  test('should truncate log fields to 64KB', async () => {
    store = createTestStore();

    // Create input data larger than 64KB
    const largeInput = 'x'.repeat(70000);
    await store.addLog({
      source: 'cli',
      operation: 'large_op',
      inputData: { data: largeInput },
    });

    const result = await store.queryLogs({});
    expect(result.logs[0]!.input_data!.length).toBe(65536);
  });

  test('should log error entries', async () => {
    store = createTestStore();

    await store.addLog({
      source: 'api',
      operation: 'failed_op',
      level: 'error',
      errorMessage: 'Something went wrong',
      inputData: { attempt: 1 },
    });

    const result = await store.queryLogs({ level: 'error' });
    expect(result.logs.length).toBe(1);
    expect(result.logs[0]!.error_message).toBe('Something went wrong');
  });

  test('should cleanup old logs based on retention', async () => {
    store = createTestStore();

    // Add some logs
    await store.addLog({ source: 'cli', operation: 'op1' });
    await store.addLog({ source: 'cli', operation: 'op2' });
    await store.addLog({ source: 'cli', operation: 'op3' });

    let result = await store.queryLogs({});
    expect(result.total).toBe(3);

    // Cleanup with -1 minute retention (cutoff is in the future, so all logs get deleted)
    const deleted = await store.cleanupOldLogs(-1);
    expect(deleted).toBe(3);

    result = await store.queryLogs({});
    expect(result.total).toBe(0);
  });

  test('should return total count in query result', async () => {
    store = createTestStore();

    await store.addLog({ source: 'cli', operation: 'op1' });
    await store.addLog({ source: 'cli', operation: 'op2' });

    const result = await store.queryLogs({ limit: 1 });
    expect(result.total).toBe(2);
    expect(result.logs.length).toBe(1);
  });
});
