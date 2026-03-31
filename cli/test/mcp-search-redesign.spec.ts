import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createSearchTools } from '../src/mcp/tools/search';
import type { MindStore } from '../src/store/mind-store';

import { createTestStore } from './mocks/test-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
  store?.cleanup();
});

// =============================================================================
// RED Phase: Tests for Phase 2.3 — Search + memory.query Tools Redesign
// These tests define the NEW expected behavior.
// =============================================================================

describe('Phase 2.3: Search + memory.query Tools Redesign', () => {
  beforeEach(() => {
    store = createTestStore();
    store.createSpace('projects/mind', 'Mind project', ['type:project']);
    store.createSpace('projects/other', 'Other project', ['type:project']);
  });

  // ==========================================================================
  // search — space REQUIRED, * = all spaces, search_method in response
  // ==========================================================================
  describe('search — space REQUIRED', () => {
    test('2.3.1 search without space param throws "space is required"', async () => {
      const tools = createSearchTools(store);

      // @ts-ignore — intentionally passing invalid shape to test validation
      await expect(tools.search.handler({ query: 'test' })).rejects.toThrow('space is required');
    });

    test('2.3.2 search with space: "*" searches ALL spaces', async () => {
      // Add memory to projects/mind
      await store.addMemory('projects/mind', 'auth-mem', 'JWT auth implementation', {
        tags: ['test'],
      });
      // Add memory to projects/other
      await store.addMemory('projects/other', 'auth-other', 'OAuth2 implementation', {
        tags: ['test'],
      });

      const tools = createSearchTools(store);
      const res = await tools.search.handler({ query: 'auth', space: '*' });

      expect(res.results.length).toBe(2);
      const spaceNames = res.results.map((r: any) => r.space_name).sort();
      expect(spaceNames).toEqual(['projects/mind', 'projects/other']);
    });

    test('2.3.3 search with space: "projects/mind" limits to that space', async () => {
      // Add memory to projects/mind
      await store.addMemory('projects/mind', 'auth-mem', 'JWT auth implementation', {
        tags: ['test'],
      });
      // Add memory to projects/other
      await store.addMemory('projects/other', 'auth-other', 'OAuth2 implementation', {
        tags: ['test'],
      });

      const tools = createSearchTools(store);
      const res = await tools.search.handler({ query: 'auth', space: 'projects/mind' });

      expect(res.results.length).toBe(1);
      expect(res.results[0].space_name).toBe('projects/mind');
    });

    test('2.3.4 search returns search_method in response', async () => {
      await store.addMemory('projects/mind', 'test-mem', 'Test content about auth', {
        tags: ['test'],
      });

      const tools = createSearchTools(store);
      const res = await tools.search.handler({ query: 'auth', space: 'projects/mind' });

      expect(res.search_method).toBeDefined();
      expect(typeof res.search_method).toBe('string');
    });

    test('2.3.5 search with simple query (no operators) works', async () => {
      await store.addMemory('projects/mind', 'my-memory', 'Content about typescript', {
        tags: ['test'],
      });

      const tools = createSearchTools(store);
      const res = await tools.search.handler({ query: 'typescript', space: 'projects/mind' });

      expect(res.results.length).toBe(1);
      expect(res.results[0].name).toBe('my-memory');
    });

    test('2.3.6 search with "exact phrase" (quoted) matches exact phrase', async () => {
      await store.addMemory('projects/mind', 'exact-phrase', 'This is an exact phrase match test', {
        tags: ['test'],
      });
      await store.addMemory(
        'projects/mind',
        'partial-match',
        'This is an approximate phrase test',
        {
          tags: ['test'],
        }
      );

      const tools = createSearchTools(store);
      const res = await tools.search.handler({ query: '"exact phrase"', space: 'projects/mind' });

      expect(res.results.length).toBe(1);
      expect(res.results[0].name).toBe('exact-phrase');
    });

    test('2.3.7 search with prefix* works', async () => {
      await store.addMemory('projects/mind', 'typescript-guide', 'Guide to typescript', {
        tags: ['test'],
      });
      await store.addMemory('projects/mind', 'typescript-ref', 'Reference for typescript', {
        tags: ['test'],
      });
      await store.addMemory('projects/mind', 'java-guide', 'Guide to java', { tags: ['test'] });

      const tools = createSearchTools(store);
      const res = await tools.search.handler({ query: 'type*', space: 'projects/mind' });

      expect(res.results.length).toBe(2);
      const names = res.results.map((r: any) => r.name).sort();
      expect(names).toEqual(['typescript-guide', 'typescript-ref']);
    });
  });

  // ==========================================================================
  // memory.query — unified, space REQUIRED
  // ==========================================================================
  describe('memory.query — unified query, space REQUIRED', () => {
    test('2.3.8 memory.query with space: "*" returns ALL memories including T3', async () => {
      // Add T1 memory
      await store.addMemory('projects/mind', 'hot', 'Hot content', { tier: 1, tags: ['test'] });
      // Add T2 memory
      await store.addMemory('projects/mind', 'warm', 'Warm content', { tier: 2, tags: ['test'] });
      // Add T3 memory
      await store.addMemory('projects/mind', 'cold', 'Cold content', { tier: 3, tags: ['test'] });

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({ space: '*' });

      expect(res.memories.length).toBe(3);
      const tiers = res.memories.map((m: any) => m.tier).sort();
      expect(tiers).toEqual([1, 2, 3]);
    });

    test('2.3.9 memory.query with space: "projects/mind" filters to that space', async () => {
      await store.addMemory('projects/mind', 'mind-mem', 'Mind memory', { tags: ['test'] });
      await store.addMemory('projects/other', 'other-mem', 'Other memory', { tags: ['test'] });

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({ space: 'projects/mind' });

      expect(res.memories.length).toBe(1);
      expect(res.memories[0].space_name).toBe('projects/mind');
    });

    test('2.3.10 memory.query includes T3 memories in results', async () => {
      // Add T3 memory
      await store.addMemory('projects/mind', 'archived', 'Archived content', {
        tier: 3,
        tags: ['test'],
      });

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({ space: 'projects/mind' });

      expect(res.memories.some((m: any) => m.tier === 3)).toBe(true);
    });

    test('memory.query without space throws "space is required"', async () => {
      const tools = createSearchTools(store);

      // @ts-ignore — intentionally passing invalid shape to test validation
      await expect(tools.memory_query.handler({})).rejects.toThrow('space is required');
    });

    test('memory.query with tag filter works', async () => {
      await store.addMemory('projects/mind', 'mem1', 'Content', { tags: ['cat:decision'] });
      await store.addMemory('projects/mind', 'mem2', 'Content', { tags: ['cat:pattern'] });

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({ space: 'projects/mind', tag: 'cat:decision' });

      expect(res.memories.length).toBe(1);
      expect(res.memories[0].tags).toContain('cat:decision');
    });

    test('memory.query with tier filter works', async () => {
      await store.addMemory('projects/mind', 'hot', 'Hot', { tier: 1, tags: ['test'] });
      await store.addMemory('projects/mind', 'cold', 'Cold', { tier: 3, tags: ['test'] });

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({ space: 'projects/mind', tier: 1 });

      expect(res.memories.length).toBe(1);
      expect(res.memories[0].tier).toBe(1);
    });

    test('memory.query with pagination works', async () => {
      // Add 10 memories
      for (let i = 0; i < 10; i++) {
        await store.addMemory('projects/mind', `mem${i}`, `Content ${i}`, { tags: ['test'] });
      }

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({ space: 'projects/mind', limit: 3, offset: 0 });

      expect(res.memories.length).toBe(3);
      expect(res.total).toBe(10);
      expect(res.limit).toBe(3);
      expect(res.offset).toBe(0);
    });

    test('memory.query with date range filter works', async () => {
      await store.addMemory('projects/mind', 'dated-mem', 'Content', { tags: ['test'] });

      const tools = createSearchTools(store);
      const res = await tools.memory_query.handler({
        space: 'projects/mind',
        from: '2020-01-01',
        to: '2099-12-31',
      });

      expect(res.memories.length).toBe(1);
    });
  });
});
