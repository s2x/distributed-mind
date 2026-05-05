// ── Core libSQL store parity tests ──
// Runs the representative subset of mind-store.spec.ts against the libSQL backend
// to verify behavioral parity with the bun:sqlite backend.

import { describe, expect, test, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

import { createLibsqlStore } from '../src/store/libsql-store';
import type { MindStore } from '../src/store/mind-store';

// ── Test store factory ──

let counter = 0;

async function createTestLibsqlStore(): Promise<MindStore & { cleanup: () => void }> {
  const path = `/tmp/test-libsql-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2)}.db`;
  const store = await createLibsqlStore({ url: `file:${path}`, intMode: 'number' });

  const cleanup = () => {
    store.close();
    if (existsSync(path)) unlinkSync(path);
    if (existsSync(`${path}-wal`)) unlinkSync(`${path}-wal`);
    if (existsSync(`${path}-shm`)) unlinkSync(`${path}-shm`);
  };

  return Object.assign(store, { cleanup });
}

let store: MindStore & { cleanup: () => void };

afterEach(() => {
  store?.cleanup();
});

// ── Spaces ──

describe('LibSQL — Spaces', () => {
  test('should create and retrieve a space', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'A test space', ['project', 'dev']);

    const space = await store.getSpace('test');
    expect(space).not.toBeNull();
    expect(space!.name).toBe('test');
    expect(space!.description).toBe('A test space');
    expect(space!.tags).toContain('project');
    expect(space!.tags).toContain('dev');
  });

  test('should throw when creating duplicate space', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'A test space', ['test']);
    await expect(store.createSpace('test', 'Another', ['test'])).rejects.toThrow();
  });

  test('should list spaces', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('alpha', 'First', ['test']);
    await store.createSpace('beta', 'Second', ['test']);

    const spaces = await store.listSpaces();
    expect(spaces.length).toBe(2);
    const names = spaces.map(s => s.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  test('should list spaces filtered by tag', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('proj-a', 'Project A', ['project']);
    await store.createSpace('personal', 'Personal', ['personal']);

    const projects = await store.listSpaces({ tag: 'project' });
    expect(projects.length).toBe(1);
    expect(projects[0]!.name).toBe('proj-a');
  });

  test('should delete a space and all its memories', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.deleteSpace('test');

    expect(await store.getSpace('test')).toBeNull();
    expect(await store.getMemory('test', 'mem1')).toBeNull();
  });

  test('should rename a space', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('old', 'Old space', ['test']);
    await store.addMemory('old', 'mem1', 'content', { tags: ['test'] });
    await store.renameSpace('old', 'new');

    expect(await store.getSpace('old')).toBeNull();
    expect(await store.getSpace('new')).not.toBeNull();
    expect(await store.getMemory('new', 'mem1')).not.toBeNull();
  });

  test('should update space description', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Old description', ['test']);
    await store.updateSpace('test', { description: 'New description' });

    const space = await store.getSpace('test');
    expect(space!.description).toBe('New description');
  });

  test('should add and remove space tags', async () => {
    store = await createTestLibsqlStore();
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

  test('should support hidden spaces', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('visible', 'Visible', ['test']);
    await store.createSpace('hidden-one', 'Hidden', ['test']);
    await store.updateSpace('hidden-one', { hidden: true });

    const visible = await store.listSpaces();
    expect(visible.some(s => s.name === 'hidden-one')).toBe(false);

    const all = await store.listSpaces({ includeHidden: true });
    expect(all.some(s => s.name === 'hidden-one')).toBe(true);
  });
});

// ── Memories ──

describe('LibSQL — Memories', () => {
  test('should add and retrieve a memory', async () => {
    store = await createTestLibsqlStore();
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

  test('should default to tier 2', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    expect(mem.tier).toBe(2);
  });

  test('should list memories — default returns T1+T2 only', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'warm', 'content', { tier: 2, tags: ['test'] });
    await store.addMemory('test', 'cold', 'content', { tier: 3, tags: ['test'] });

    const active = await store.listMemories('test');
    expect(active.length).toBe(2);
    expect(active.some(m => m.name === 'cold')).toBe(false);
  });

  test('should list memories — explicit tier 3 returns cold', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'cold', 'content', { tier: 3, tags: ['test'] });

    const cold = await store.listMemories('test', { tier: 3 });
    expect(cold.length).toBe(1);
    expect(cold[0]!.name).toBe('cold');
  });

  test('should filter memories by tag', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['backend'] });
    await store.addMemory('test', 'mem2', 'content', { tags: ['frontend'] });

    const backend = await store.listMemories('test', { tag: 'backend' });
    expect(backend.length).toBe(1);
    expect(backend[0]!.name).toBe('mem1');
  });

  test('should update memory content', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'old content', { tags: ['test'] });
    await store.updateMemory(mem.id, { content: 'new content' });

    const updated = await store.getMemoryById(mem.id);
    expect(updated!.content).toBe('new content');
  });

  test('should delete memory by name', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.deleteMemoryByName('test', 'mem1');
    expect(await store.getMemory('test', 'mem1')).toBeNull();
  });

  test('should add and remove memory tags', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await store.addMemoryTag(mem.id, 'important');
    let retrieved = await store.getMemoryById(mem.id);
    expect(retrieved!.tags).toContain('important');

    await store.removeMemoryTag(mem.id, 'important');
    retrieved = await store.getMemoryById(mem.id);
    expect(retrieved!.tags).not.toContain('important');
  });

  test('should not update changed_at on read access', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3, tags: ['test'] });
    const before = (await store.getMemoryById(mem.id))!;

    await new Promise(resolve => setTimeout(resolve, 1100));
    await store.recordAccess(mem.id);

    const after = (await store.getMemoryById(mem.id))!;
    expect(after.changed_at).toBe(before.changed_at);
    expect(after.tier).toBe(2); // auto-promotes T3→T2
  });

  test('should update changed_at on semantic memory changes', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const before = (await store.getMemoryById(mem.id))!;

    await new Promise(resolve => setTimeout(resolve, 1100));
    await store.updateMemory(mem.id, { content: 'new content' });

    const after = (await store.getMemoryById(mem.id))!;
    expect(after.changed_at).not.toBe(before.changed_at);
  });

  test('should require tags when adding a memory', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await expect(store.addMemory('test', 'mem1', 'content', { tags: [] })).rejects.toThrow(
      'Tags are required'
    );
  });

  test('should throw when adding to non-existent space', async () => {
    store = await createTestLibsqlStore();
    await expect(
      store.addMemory('no-such-space', 'mem1', 'content', { tags: ['test'] })
    ).rejects.toThrow();
  });
});

// ── Tiers ──

describe('LibSQL — Tiers', () => {
  test('should promote a memory', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3, tags: ['test'] });

    await store.promote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(2);

    await store.promote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(1);
  });

  test('should not promote beyond tier 1', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 1, tags: ['test'] });
    await expect(store.promote(mem.id)).rejects.toThrow('highest tier');
  });

  test('should demote a memory', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 1, tags: ['test'] });

    await store.demote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(2);

    await store.demote(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(3);
  });

  test('should not demote beyond tier 3', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 3, tags: ['test'] });
    await expect(store.demote(mem.id)).rejects.toThrow('lowest tier');
  });

  test('should pin and unpin', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await store.pin(mem.id);
    expect((await store.getMemoryById(mem.id))!.pinned).toBe(true);

    await store.unpin(mem.id);
    expect((await store.getMemoryById(mem.id))!.pinned).toBe(false);
  });

  test('should auto-promote tier 2 to 1 on read', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 2, tags: ['test'] });

    await store.recordAccess(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(1);
  });

  test('should not auto-promote pinned memory on read', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tier: 2, tags: ['test'] });
    await store.pin(mem.id);

    await store.recordAccess(mem.id);
    expect((await store.getMemoryById(mem.id))!.tier).toBe(2);
  });

  test('should bump access count on read', async () => {
    store = await createTestLibsqlStore();
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

// ── LRU Eviction ──

describe('LibSQL — LRU Eviction', () => {
  test('should evict LRU non-pinned memory when tier is full', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];
    for (let i = 0; i < limit; i++) {
      await store.addMemory('test', `mem-${i}`, 'content', { tier: 1, tags: ['test'] });
    }

    await store.addMemory('test', 'overflow', 'content', { tier: 1, tags: ['test'] });

    expect((await store.getMemory('test', 'overflow'))!.tier).toBe(1);
    expect((await store.getMemory('test', 'mem-0'))!.tier).toBe(2);
    expect((await store.getMemory('test', 'mem-1'))!.tier).toBe(1);
  });

  test('should throw when tier is full and all memories are pinned', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];
    for (let i = 0; i < limit; i++) {
      const m = await store.addMemory('test', `pinned-${i}`, 'content', {
        tier: 1,
        tags: ['test'],
      });
      await store.pin(m.id);
    }

    await expect(
      store.addMemory('test', 'overflow', 'content', { tier: 1, tags: ['test'] })
    ).rejects.toThrow('pinned');
  });

  test('should not evict from T3 (T3 is unlimited)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    for (let i = 0; i < 60; i++) {
      await store.addMemory('test', `cold-${i}`, 'content', { tier: 3, tags: ['test'] });
    }

    await store.addMemory('test', 'overflow', 'content', { tier: 3, tags: ['test'] });

    expect((await store.getMemory('test', 'overflow'))!.tier).toBe(3);
    expect((await store.getMemory('test', 'cold-0'))!.tier).toBe(3);
  });

  test('pinned memories should not be LRU-evicted', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];

    const first = await store.addMemory('test', 'pinned-first', 'content', {
      tier: 1,
      tags: ['test'],
    });
    await store.pin(first.id);
    for (let i = 1; i < limit; i++) {
      await store.addMemory('test', `mem-${i}`, 'content', { tier: 1, tags: ['test'] });
    }

    await store.addMemory('test', 'overflow', 'content', { tier: 1, tags: ['test'] });

    expect((await store.getMemory('test', 'pinned-first'))!.tier).toBe(1);
    expect((await store.getMemory('test', 'mem-1'))!.tier).toBe(2);
  });

  test('recordAccess promotion should silently skip if destination full and all pinned', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const { TIER_LIMITS } = require('../src/config');
    const limit: number = TIER_LIMITS[1];

    for (let i = 0; i < limit; i++) {
      const m = await store.addMemory('test', `pinned-${i}`, 'content', {
        tier: 1,
        tags: ['test'],
      });
      await store.pin(m.id);
    }

    const t2mem = await store.addMemory('test', 'warm', 'content', { tier: 2, tags: ['test'] });
    await store.recordAccess(t2mem.id);

    expect((await store.getMemory('test', 'warm'))!.tier).toBe(2);
    expect((await store.getMemory('test', 'warm'))!.access_count).toBe(1);
  });
});

// ── Links ──

describe('LibSQL — Links', () => {
  test('should create and retrieve links', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await store.link(mem1.id, mem2.id, 'depends-on');

    const links = await store.getLinks(mem1.id);
    expect(links.length).toBe(1);
    expect(links[0]!.label).toBe('depends-on');
    expect(links[0]!.target_name).toBe('mem2');
  });

  test('should unlink memories', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await store.link(mem1.id, mem2.id);
    await store.unlink(mem1.id, mem2.id);

    const links = await store.getLinks(mem1.id);
    expect(links.length).toBe(0);
  });

  test('should not link a memory to itself', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    await expect(store.link(mem.id, mem.id)).rejects.toThrow();
  });

  test('should cascade delete links when memory is deleted', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await store.link(mem1.id, mem2.id);
    await store.deleteMemory(mem1.id);

    const links = await store.getLinks(mem2.id);
    expect(links.length).toBe(0);
  });
});

// ── Search ──

describe('LibSQL — Search', () => {
  test('should find memories by full-text search', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth-flow', 'JWT authentication with refresh tokens', {
      tags: ['test'],
    });
    await store.addMemory('test', 'db-schema', 'PostgreSQL with Prisma ORM', { tags: ['test'] });

    const results = await store.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('auth-flow');
  });

  test('should filter search by space', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('proj-a', 'Project A', ['test']);
    await store.createSpace('proj-b', 'Project B', ['test']);
    await store.addMemory('proj-a', 'auth', 'authentication', { tags: ['test'] });
    await store.addMemory('proj-b', 'auth', 'authentication', { tags: ['test'] });

    const results = await store.search('authentication', { space: 'proj-a' });
    expect(results.length).toBe(1);
    expect(results[0]!.space_name).toBe('proj-a');
  });

  test('should filter search by tier', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot-auth', 'authentication', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'cold-auth', 'authentication', { tier: 3, tags: ['test'] });

    const results = await store.search('authentication', { tier: 1 });
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('hot-auth');
  });

  test('should return empty for no matches', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });

    const results = await store.search('nonexistent');
    expect(results.length).toBe(0);
  });

  test('should query memories with metadata filters', async () => {
    store = await createTestLibsqlStore();
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
    store = await createTestLibsqlStore();
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
});

// ── Logs ──

describe('LibSQL — Logs', () => {
  test('should add a log entry and query it back', async () => {
    store = await createTestLibsqlStore();

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
    store = await createTestLibsqlStore();

    await store.addLog({ source: 'cli', operation: 'cmd1' });
    await store.addLog({ source: 'mcp', operation: 'tool1' });

    const cliLogs = await store.queryLogs({ source: 'cli' });
    expect(cliLogs.logs.length).toBe(1);
    expect(cliLogs.logs[0]!.source).toBe('cli');
  });

  test('should query logs with pagination and total count', async () => {
    store = await createTestLibsqlStore();

    for (let i = 0; i < 15; i++) {
      await store.addLog({ source: 'cli', operation: `op_${i}` });
    }

    const page1 = await store.queryLogs({ limit: 5, offset: 0 });
    expect(page1.logs.length).toBe(5);
    expect(page1.total).toBe(15);
    expect(page1.limit).toBe(5);
    expect(page1.offset).toBe(0);
  });

  test('should query logs ordered desc by default', async () => {
    store = await createTestLibsqlStore();

    await store.addLog({ source: 'cli', operation: 'first' });
    await store.addLog({ source: 'cli', operation: 'second' });
    await store.addLog({ source: 'cli', operation: 'third' });

    const desc = await store.queryLogs({ order: 'desc' });
    expect(desc.logs[0]!.operation).toBe('third');

    const asc = await store.queryLogs({ order: 'asc' });
    expect(asc.logs[0]!.operation).toBe('first');
  });

  test('should cleanup old logs based on retention', async () => {
    store = await createTestLibsqlStore();

    await store.addLog({ source: 'cli', operation: 'op1' });
    await store.addLog({ source: 'cli', operation: 'op2' });

    let result = await store.queryLogs({});
    expect(result.total).toBe(2);

    // Cleanup with -1 minute retention (cutoff is in the future, all logs deleted)
    const deleted = await store.cleanupOldLogs(-1);
    expect(deleted).toBe(2);

    result = await store.queryLogs({});
    expect(result.total).toBe(0);
  });
});

// ── Import ──

describe('LibSQL — Import', () => {
  test('should import legacy brain.json format', async () => {
    store = await createTestLibsqlStore();
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
    expect(mem!.tier).toBe(2);
  });
});

// ── Space Graph ──

describe('LibSQL — Space Graph', () => {
  test('should return graph nodes with T1-T3 and directed links', async () => {
    store = await createTestLibsqlStore();
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
  });

  test('should enforce limit and expose truncation metadata', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    for (let i = 0; i < 10; i++) {
      await store.addMemory('test', `m-${i}`, 'content', { tier: 2, tags: ['test'] });
    }

    const graph = await store.getSpaceGraph('test', { limit: 3, maxLimit: 5 });
    expect(graph.nodes.length).toBe(3);
    expect(graph.meta.total_nodes).toBe(10);
    expect(graph.meta.truncated).toBe(true);
  });
});
