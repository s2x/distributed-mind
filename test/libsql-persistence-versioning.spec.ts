// ── libSQL persistence / versioning tests ──
// Verifies schema v8 specific behaviors:
//   - soft memories: no versioning on update/delete
//   - hard memories: version snapshot created on update and delete
//   - LRU eviction: hard memories are protected; soft memories are evicted first
//
// Access to memory_versions is done via (store as any).getMemoryVersions() — a
// test-only method added to LibsqlMindStore in libsql-store.ts.

import { describe, expect, test, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

import { createLibsqlStore } from '../src/store/libsql-store';
import type { MindStore } from '../src/store/mind-store';
import type { Client } from '@libsql/client';
import { TIER_LIMITS } from '../src/config';

let counter = 0;

async function createTestLibsqlStore(): Promise<MindStore & { cleanup: () => void; client: Client }> {
  const path = `/tmp/test-libsql-persist-${Date.now()}-${counter++}.db`;
  const store = await createLibsqlStore({ url: `file:${path}`, intMode: 'number' });
  const cleanup = () => {
    store.close();
    if (existsSync(path)) unlinkSync(path);
    if (existsSync(`${path}-wal`)) unlinkSync(`${path}-wal`);
    if (existsSync(`${path}-shm`)) unlinkSync(`${path}-shm`);
  };
  const client = (store as any).client as Client;
  return Object.assign(store, { cleanup, client });
}

/** Directly query memory_versions for a given memory_id. */
async function getMemoryVersions(client: Client, memoryId: number): Promise<any[]> {
  const result = await client.execute({
    sql: 'SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version_number',
    args: [memoryId],
  });
  return result.rows;
}

/** Add a memory with explicit persistence (bypasses the standard API limitation of 'soft' default). */
async function addHardMemory(
  store: MindStore,
  space: string,
  name: string,
  content: string
): Promise<import('../src/types').Memory> {
  // The addMemory API accepts persistence in opts (schema v8)
  return store.addMemory(space, name, content, {
    tags: ['test'],
    persistence: 'hard' as any,
  } as any);
}

let store: MindStore & { cleanup: () => void; client: Client };

afterEach(() => {
  store?.cleanup();
});

describe('LibSQL — Persistence: default is soft', () => {
  test('memory defaults to soft persistence', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'soft-mem', 'content', { tags: ['test'] });

    // Verify via direct DB query
    const result = await store.client.execute({
      sql: 'SELECT persistence FROM memories WHERE id = ?',
      args: [mem.id],
    });
    expect((result.rows[0] as any).persistence).toBe('soft');
  });

  test('soft memory: no version created on update', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'soft-mem', 'original content', { tags: ['test'] });

    await store.updateMemory(mem.id, { content: 'updated content' });

    const versions = await getMemoryVersions(store.client, mem.id);
    expect(versions.length).toBe(0);
  });

  test('soft memory: no version created on delete', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'soft-mem', 'content', { tags: ['test'] });
    const memId = mem.id;

    await store.deleteMemory(mem.id);

    const versions = await getMemoryVersions(store.client, memId);
    expect(versions.length).toBe(0);
  });
});

describe('LibSQL — Persistence: hard memory versioning', () => {
  test('hard memory: version snapshot created on update', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await addHardMemory(store, 'test', 'hard-mem', 'original content');

    // Verify it is hard in the DB
    const row = await store.client.execute({
      sql: 'SELECT persistence FROM memories WHERE id = ?',
      args: [mem.id],
    });
    expect((row.rows[0] as any).persistence).toBe('hard');

    await store.updateMemory(mem.id, { content: 'updated content' });

    const versions = await getMemoryVersions(store.client, mem.id);
    expect(versions.length).toBe(1);
    expect(versions[0].operation).toBe('update');
    expect(versions[0].content).toBe('original content'); // snapshot of state BEFORE update
    expect(versions[0].persistence).toBe('hard');
    expect(versions[0].version_number).toBe(1);
  });

  test('hard memory: version number increments on each update', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await addHardMemory(store, 'test', 'hard-mem', 'v0 content');

    await store.updateMemory(mem.id, { content: 'v1 content' });
    await store.updateMemory(mem.id, { content: 'v2 content' });
    await store.updateMemory(mem.id, { content: 'v3 content' });

    const versions = await getMemoryVersions(store.client, mem.id);
    expect(versions.length).toBe(3);
    expect(versions[0].version_number).toBe(1);
    expect(versions[1].version_number).toBe(2);
    expect(versions[2].version_number).toBe(3);
    expect(versions[0].content).toBe('v0 content');
    expect(versions[1].content).toBe('v1 content');
    expect(versions[2].content).toBe('v2 content');
  });

  test('hard memory: version snapshot created on delete (operation=delete)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await addHardMemory(store, 'test', 'hard-del', 'to be deleted');
    const memId = mem.id;

    await store.deleteMemory(mem.id);

    const versions = await getMemoryVersions(store.client, memId);
    expect(versions.length).toBe(1);
    expect(versions[0].operation).toBe('delete');
    expect(versions[0].content).toBe('to be deleted');
    expect(versions[0].persistence).toBe('hard');
  });

  test('hard memory: deleteMemoryByName also creates a version snapshot', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await addHardMemory(store, 'test', 'hard-named-del', 'content for named delete');
    const memId = mem.id;

    await store.deleteMemoryByName('test', 'hard-named-del');

    const versions = await getMemoryVersions(store.client, memId);
    expect(versions.length).toBe(1);
    expect(versions[0].operation).toBe('delete');
  });

  test('hard memory: version snapshot captures tags at time of update', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await addHardMemory(store, 'test', 'hard-tagged', 'content');
    await store.addMemoryTag(mem.id, 'extra-tag');

    await store.updateMemory(mem.id, { content: 'new content' });

    const versions = await getMemoryVersions(store.client, mem.id);
    expect(versions.length).toBe(1);
    const snapshotTags = JSON.parse(versions[0].tags);
    expect(Array.isArray(snapshotTags)).toBe(true);
    // Should contain 'test' and 'extra-tag' (snapshot taken before update)
    expect(snapshotTags).toContain('test');
    expect(snapshotTags).toContain('extra-tag');
  });
});

describe('LibSQL — LRU eviction and persistence', () => {
  /**
   * Persistence model (schema v8 corrected):
   *   - hard memories are NOT subject to LRU eviction and do NOT count toward tier limits
   *   - soft memories are subject to LRU eviction and count toward tier limits
   *   - pinned memories (any persistence) are immune to eviction
   *
   * This means:
   *   - When T1 is "full" (soft count >= TIER_LIMITS[1]), the LRU non-pinned SOFT memory is evicted
   *   - Hard memories in T1 do not count toward the limit, so you can have more than TIER_LIMITS[1]
   *     total memories in T1 if some are hard
   */

  test('soft memories ARE subject to LRU eviction', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1]; // 25
    for (let i = 0; i < t1Limit; i++) {
      await (store as any).addMemory('test', `soft-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'soft',
      });
    }

    // Adding one more soft memory to T1: should evict the LRU soft memory (soft-0) to T2
    await (store as any).addMemory('test', 'soft-overflow', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'soft',
    });

    const overflow = await store.getMemory('test', 'soft-overflow');
    expect(overflow!.tier).toBe(1);

    // soft-0 (LRU) should have been evicted to T2
    const lru = await store.getMemory('test', 'soft-0');
    expect(lru!.tier).toBe(2);
  });

  test('hard memories are NOT subject to LRU eviction and do NOT count toward tier limits', async () => {
    // Fill T1 soft limit (25) with hard memories — they don't count, so soft limit is NOT reached.
    // Then fill T1 with soft limit worth of soft memories. Verify all hard are still at T1.
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1]; // 25

    // Add hard memories — these do not count toward the soft tier limit
    for (let i = 0; i < t1Limit; i++) {
      await (store as any).addMemory('test', `hard-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'hard',
      });
    }

    // Add soft memories up to the limit — they should fit without evicting hard memories
    for (let i = 0; i < t1Limit; i++) {
      await (store as any).addMemory('test', `soft-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'soft',
      });
    }

    // All hard memories should still be at T1 (not evicted)
    for (let i = 0; i < t1Limit; i++) {
      const mem = await store.getMemory('test', `hard-${i}`);
      expect(mem!.tier).toBe(1);
    }

    // All soft memories should be at T1 as well (they just filled the soft limit)
    for (let i = 0; i < t1Limit; i++) {
      const mem = await store.getMemory('test', `soft-${i}`);
      expect(mem!.tier).toBe(1);
    }
  });

  test('adding a soft memory when T1 soft limit is full evicts the LRU soft memory, not a hard one', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1]; // 25

    // Add one hard memory first (it will be the oldest/LRU candidate — but should be immune)
    await (store as any).addMemory('test', 'hard-immune', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'hard',
    });

    // Fill T1 soft limit with soft memories
    for (let i = 0; i < t1Limit; i++) {
      await (store as any).addMemory('test', `soft-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'soft',
      });
    }

    // Trigger eviction by adding one more soft memory
    await (store as any).addMemory('test', 'soft-overflow', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'soft',
    });

    // Hard memory should NOT be evicted
    const hardMem = await store.getMemory('test', 'hard-immune');
    expect(hardMem!.tier).toBe(1);

    // The LRU soft memory (soft-0) should be evicted to T2
    const lruSoft = await store.getMemory('test', 'soft-0');
    expect(lruSoft!.tier).toBe(2);

    // The overflow soft memory should be at T1
    const overflow = await store.getMemory('test', 'soft-overflow');
    expect(overflow!.tier).toBe(1);
  });

  test('pinned soft memory is NOT evicted (pinned overrides soft eviction)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1];

    // Add one pinned soft memory first (it will be the oldest/LRU candidate — but pinned)
    const protectedMem = await (store as any).addMemory('test', 'protected-soft', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'soft',
    });
    await store.pin(protectedMem.id);

    // Fill remaining T1 slots with unpinned soft memories
    for (let i = 1; i < t1Limit; i++) {
      await (store as any).addMemory('test', `soft-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'soft',
      });
    }

    // Trigger eviction — protected-soft is pinned so it should NOT be evicted
    await (store as any).addMemory('test', 'overflow', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'soft',
    });

    // Pinned soft memory should still be at T1
    expect((await store.getMemory('test', 'protected-soft'))!.tier).toBe(1);
    // soft-1 (oldest non-pinned) should have been evicted
    expect((await store.getMemory('test', 'soft-1'))!.tier).toBe(2);
  });

  test('promoteToHard changes persistence to hard', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem', 'content', { tags: ['test'] });

    await store.promoteToHard('test', 'mem');

    const row = await store.client.execute({
      sql: 'SELECT persistence FROM memories WHERE space_name = ? AND name = ?',
      args: ['test', 'mem'],
    });
    expect((row.rows[0] as any).persistence).toBe('hard');
  });

  test('demoteToSoft changes persistence to soft', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await addHardMemory(store, 'test', 'hard-mem', 'content');

    await store.demoteToSoft('test', 'hard-mem');

    const row = await store.client.execute({
      sql: 'SELECT persistence FROM memories WHERE space_name = ? AND name = ?',
      args: ['test', 'hard-mem'],
    });
    expect((row.rows[0] as any).persistence).toBe('soft');
  });
});
