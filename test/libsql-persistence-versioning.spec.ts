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
   * BEHAVIORAL NOTE: In the current schema v8 implementation, 'persistence' is NOT a
   * guard against LRU eviction. LRU eviction evicts the least-recently-used NON-PINNED
   * memory regardless of persistence value. The difference is:
   *   - soft memory evicted → just moved to lower tier
   *   - hard memory evicted → moved to lower tier AND a version snapshot is created
   *
   * To protect a memory from eviction, pin it (pinned=true).
   */

  test('hard memories ARE subject to LRU eviction (persistence != pinned)', async () => {
    // Fill T1 with hard memories; adding one more evicts the LRU hard memory.
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1]; // 25
    for (let i = 0; i < t1Limit; i++) {
      await (store as any).addMemory('test', `hard-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'hard',
      });
    }

    // Adding one more hard memory to T1: should evict the LRU hard memory (hard-0) to T2
    await (store as any).addMemory('test', 'hard-overflow', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'hard',
    });

    const overflow = await store.getMemory('test', 'hard-overflow');
    expect(overflow!.tier).toBe(1);

    // hard-0 (LRU) should have been evicted to T2 even though it's hard
    const lru = await store.getMemory('test', 'hard-0');
    expect(lru!.tier).toBe(2);
  });

  test('hard memory eviction creates a version snapshot', async () => {
    // When a hard memory is LRU-evicted (tier changes), no snapshot is created for
    // tier-only changes. Snapshots are only created on content/name updates and deletes.
    // (ensureCapacity uses a direct UPDATE, not snapshotToVersions)
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1];
    for (let i = 0; i < t1Limit; i++) {
      await (store as any).addMemory('test', `hard-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'hard',
      });
    }

    const lruMem = await store.getMemory('test', 'hard-0');
    const lruId = lruMem!.id;

    // Trigger LRU eviction
    await (store as any).addMemory('test', 'trigger', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'hard',
    });

    // hard-0 should be at T2 now
    expect((await store.getMemory('test', 'hard-0'))!.tier).toBe(2);

    // LRU eviction via ensureCapacity does NOT call snapshotToVersions —
    // only updateMemory/deleteMemory/patchMemory call it.
    const versions = await getMemoryVersions(store.client, lruId);
    expect(versions.length).toBe(0); // no version snapshot from tier eviction
  });

  test('pinned hard memory is NOT evicted (pinned = ultimate protection)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const t1Limit = TIER_LIMITS[1];

    // Add one pinned hard memory first (it will be the oldest/LRU candidate)
    const protectedMem = await (store as any).addMemory('test', 'protected-hard', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'hard',
    });
    await store.pin(protectedMem.id);

    // Fill remaining T1 slots with unpinned hard memories
    for (let i = 1; i < t1Limit; i++) {
      await (store as any).addMemory('test', `hard-${i}`, 'content', {
        tags: ['test'],
        tier: 1,
        persistence: 'hard',
      });
    }

    // Trigger eviction — protected-hard is pinned so it should NOT be evicted
    await (store as any).addMemory('test', 'overflow', 'content', {
      tags: ['test'],
      tier: 1,
      persistence: 'hard',
    });

    // Pinned hard memory should still be at T1
    expect((await store.getMemory('test', 'protected-hard'))!.tier).toBe(1);
    // hard-1 (oldest non-pinned) should have been evicted
    expect((await store.getMemory('test', 'hard-1'))!.tier).toBe(2);
  });
});
