// ── libSQL FK CASCADE tests ──
// Verifies that ON DELETE CASCADE / ON UPDATE CASCADE works correctly
// in the libSQL backend (requires PRAGMA foreign_keys = ON, which the store enables).

import { describe, expect, test, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

import { createLibsqlStore } from '../src/store/libsql-store';
import type { MindStore } from '../src/store/mind-store';
import type { Client } from '@libsql/client';

let counter = 0;

async function createTestLibsqlStore(): Promise<MindStore & { cleanup: () => void; client: Client }> {
  const path = `/tmp/test-libsql-fk-${Date.now()}-${counter++}.db`;
  const store = await createLibsqlStore({ url: `file:${path}`, intMode: 'number' });
  const cleanup = () => {
    store.close();
    if (existsSync(path)) unlinkSync(path);
    if (existsSync(`${path}-wal`)) unlinkSync(`${path}-wal`);
    if (existsSync(`${path}-shm`)) unlinkSync(`${path}-shm`);
  };
  // Expose client for direct inspection
  const client = (store as any).client as Client;
  return Object.assign(store, { cleanup, client });
}

let store: MindStore & { cleanup: () => void; client: Client };

afterEach(() => {
  store?.cleanup();
});

async function countRows(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) as c FROM ${table}`);
  return Number((result.rows[0] as any).c);
}

async function countRowsWhere(client: Client, table: string, where: string, args: unknown[]): Promise<number> {
  const result = await client.execute({ sql: `SELECT COUNT(*) as c FROM ${table} WHERE ${where}`, args: args as any[] });
  return Number((result.rows[0] as any).c);
}

describe('LibSQL — FK CASCADE: space delete', () => {
  test('deleting a space cascades to memories', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    const beforeMemories = await countRows(store.client, 'memories');
    expect(beforeMemories).toBe(2);

    await store.deleteSpace('test');

    const afterMemories = await countRows(store.client, 'memories');
    expect(afterMemories).toBe(0);

    expect(await store.getSpace('test')).toBeNull();
  });

  test('deleting a space cascades to space_tags', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['project', 'active']);

    const beforeTags = await countRowsWhere(store.client, 'space_tags', 'space_name = ?', ['test']);
    expect(beforeTags).toBe(2);

    await store.deleteSpace('test');

    const afterTags = await countRowsWhere(store.client, 'space_tags', 'space_name = ?', ['test']);
    expect(afterTags).toBe(0);
  });

  test('deleting a space cascades to memory_tags', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['backend', 'important'] });

    const memoryId = (await store.getMemory('test', 'mem1'))!.id;
    const beforeTagCount = await countRowsWhere(store.client, 'memory_tags', 'memory_id = ?', [memoryId]);
    expect(beforeTagCount).toBe(2);

    await store.deleteSpace('test');

    // After space delete → memories deleted → memory_tags cascade-deleted
    const afterTagCount = await countRowsWhere(store.client, 'memory_tags', 'memory_id = ?', [memoryId]);
    expect(afterTagCount).toBe(0);
  });

  test('deleting a space cascades to links', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });
    await store.link(mem1.id, mem2.id, 'related');

    const beforeLinks = await countRows(store.client, 'links');
    expect(beforeLinks).toBe(1);

    await store.deleteSpace('test');

    const afterLinks = await countRows(store.client, 'links');
    expect(afterLinks).toBe(0);
  });

  test('deleting a space only removes memories in that space, not others', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('keep', 'Keep', ['test']);
    await store.createSpace('remove', 'Remove', ['test']);
    await store.addMemory('keep', 'k1', 'content', { tags: ['test'] });
    await store.addMemory('remove', 'r1', 'content', { tags: ['test'] });

    await store.deleteSpace('remove');

    expect(await store.getMemory('keep', 'k1')).not.toBeNull();
    expect(await store.getMemory('remove', 'r1')).toBeNull();
  });
});

describe('LibSQL — FK CASCADE: memory delete', () => {
  test('deleting a memory cascades to its memory_tags', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'content', { tags: ['a', 'b', 'c'] });

    const beforeCount = await countRowsWhere(store.client, 'memory_tags', 'memory_id = ?', [mem.id]);
    expect(beforeCount).toBe(3);

    await store.deleteMemory(mem.id);

    const afterCount = await countRowsWhere(store.client, 'memory_tags', 'memory_id = ?', [mem.id]);
    expect(afterCount).toBe(0);
  });

  test('deleting a memory cascades to outgoing links', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });
    await store.link(mem1.id, mem2.id);

    await store.deleteMemory(mem1.id);

    const links = await store.getLinks(mem2.id);
    expect(links.length).toBe(0);
  });

  test('deleting a memory cascades to incoming links', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });
    await store.link(mem1.id, mem2.id);

    // Delete the target memory — should remove the link
    await store.deleteMemory(mem2.id);

    const beforeDelete = await countRows(store.client, 'links');
    expect(beforeDelete).toBe(0);

    // Source memory still exists
    expect(await store.getMemoryById(mem1.id)).not.toBeNull();
  });
});

describe('LibSQL — FK CASCADE: space rename (ON UPDATE CASCADE)', () => {
  test('renaming a space updates space_name on memories', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('old', 'Old', ['test']);
    await store.addMemory('old', 'mem1', 'content', { tags: ['test'] });

    await store.renameSpace('old', 'new');

    // Memory should be accessible under new space name
    const mem = await store.getMemory('new', 'mem1');
    expect(mem).not.toBeNull();
    expect(mem!.space_name).toBe('new');

    // Old space no longer exists
    expect(await store.getSpace('old')).toBeNull();
  });

  test('renaming a space updates space_name on space_tags', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('old', 'Old', ['project', 'active']);

    await store.renameSpace('old', 'renamed');

    const afterTagsNew = await countRowsWhere(
      store.client, 'space_tags', 'space_name = ?', ['renamed']
    );
    expect(afterTagsNew).toBe(2);

    const afterTagsOld = await countRowsWhere(
      store.client, 'space_tags', 'space_name = ?', ['old']
    );
    expect(afterTagsOld).toBe(0);
  });
});
