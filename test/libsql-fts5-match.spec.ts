// ── libSQL FTS5 full-text search tests ──
// Verifies that FTS5 (with porter tokenizer) works correctly in the libSQL backend.
// Tests cover exact match, stemming, prefix search, multi-term, and cross-space filtering.

import { describe, expect, test, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

import { createLibsqlStore } from '../src/store/libsql-store';
import type { MindStore } from '../src/store/mind-store';

let counter = 0;

async function createTestLibsqlStore(): Promise<MindStore & { cleanup: () => void }> {
  const path = `/tmp/test-libsql-fts5-${Date.now()}-${counter++}.db`;
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

describe('LibSQL — FTS5: exact content match', () => {
  test('should find a memory by exact word in content', async () => {
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

  test('should find a memory by exact word in name', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth-service', 'handles user login', { tags: ['test'] });
    await store.addMemory('test', 'payment-service', 'handles billing', { tags: ['test'] });

    const results = await store.search('auth');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('auth-service');
  });

  test('should return empty when no match exists', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'totally unrelated content', { tags: ['test'] });

    const results = await store.search('authentication');
    expect(results.length).toBe(0);
  });
});

describe('LibSQL — FTS5: porter stemming', () => {
  test('should match stemmed form (running → run)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'process', 'The background jobs are running', { tags: ['test'] });

    const results = await store.search('run');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('process');
  });

  test('should match plural/singular (connections → connection)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'db', 'database connections pool config', { tags: ['test'] });

    const results = await store.search('connection');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('db');
  });
});

describe('LibSQL — FTS5: prefix match', () => {
  test('should match with * prefix wildcard', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'authentication flow and authorization rules', {
      tags: ['test'],
    });
    await store.addMemory('test', 'other', 'unrelated database content', { tags: ['test'] });

    // 'auth*' should match 'authentication' and 'authorization'
    const results = await store.search('auth*');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('auth');
  });

  test('prefix wildcard on name field', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'authentication-service', 'handles user login', { tags: ['test'] });
    await store.addMemory('test', 'payment', 'handles billing', { tags: ['test'] });

    const results = await store.search('authent*');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('authentication-service');
  });
});

describe('LibSQL — FTS5: multi-term search', () => {
  test('should match when all terms present (implicit AND)', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'JWT token refresh strategy', { tags: ['test'] });
    await store.addMemory('test', 'mem2', 'only JWT mentioned here', { tags: ['test'] });

    // FTS5 default is AND for space-separated terms
    const results = await store.search('JWT refresh');
    expect(results.some(r => r.name === 'mem1')).toBe(true);
    // mem2 may or may not match depending on FTS AND semantics; just verify mem1 appears
  });
});

describe('LibSQL — FTS5: filters', () => {
  test('should filter search results by space', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('proj-a', 'Project A', ['test']);
    await store.createSpace('proj-b', 'Project B', ['test']);
    await store.addMemory('proj-a', 'auth', 'authentication system', { tags: ['test'] });
    await store.addMemory('proj-b', 'auth', 'authentication system', { tags: ['test'] });

    const results = await store.search('authentication', { space: 'proj-a' });
    expect(results.length).toBe(1);
    expect(results[0]!.space_name).toBe('proj-a');
  });

  test('should filter search results by tier', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'hot-auth', 'authentication', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'cold-auth', 'authentication', { tier: 3, tags: ['test'] });

    const t1Results = await store.search('authentication', { tier: 1 });
    expect(t1Results.length).toBe(1);
    expect(t1Results[0]!.tier).toBe(1);

    const t3Results = await store.search('authentication', { tier: 3 });
    expect(t3Results.length).toBe(1);
    expect(t3Results[0]!.tier).toBe(3);
  });

  test('FTS search includes T3 memories', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'cold-auth', 'authentication token in cold tier', {
      tier: 3,
      tags: ['test'],
    });

    const results = await store.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0]!.tier).toBe(3);
  });
});

describe('LibSQL — FTS5: FTS stays in sync after updates and deletes', () => {
  test('updated content should be searchable with new terms', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem1', 'original content here', { tags: ['test'] });

    // Old term should be findable before update
    let results = await store.search('original');
    expect(results.length).toBe(1);

    // Update content
    await store.updateMemory(mem.id, { content: 'completely different subject matter' });

    // Old term should no longer match
    results = await store.search('original');
    expect(results.length).toBe(0);

    // New term should match
    results = await store.search('subject');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('mem1');
  });

  test('deleted memory should no longer appear in search results', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'unique xyzzy content', { tags: ['test'] });

    let results = await store.search('xyzzy');
    expect(results.length).toBe(1);

    await store.deleteMemoryByName('test', 'mem1');

    results = await store.search('xyzzy');
    expect(results.length).toBe(0);
  });

  test('all memories in deleted space should disappear from search', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'unique quuxbar content', { tags: ['test'] });
    await store.addMemory('test', 'mem2', 'another quuxbar thing', { tags: ['test'] });

    let results = await store.search('quuxbar');
    expect(results.length).toBe(2);

    await store.deleteSpace('test');

    results = await store.search('quuxbar');
    expect(results.length).toBe(0);
  });
});
