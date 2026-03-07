import { afterEach, describe, expect, test } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import { createMemoryTools } from '../src/mcp/tools/memories';
import type { MindStore } from '../src/store/mind-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
  store?.cleanup();
});

describe('MCP Memory Tools', () => {
  test('memory_query should use default pagination values', async () => {
    store = createTestStore();
    store.createSpace('Credentials', 'Secrets');
    await store.addMemory('Credentials', 'a', 'content');

    const tools = createMemoryTools(store);
    const res = await tools.memory_query.handler({});

    expect(res.pagination.limit).toBe(25);
    expect(res.pagination.offset).toBe(0);
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items.length).toBe(1);
  });

  test('memory_query should return nextOffset when page is full', async () => {
    store = createTestStore();
    store.createSpace('Credentials', 'Secrets');
    await store.addMemory('Credentials', 'a', 'content');
    await store.addMemory('Credentials', 'b', 'content');

    const tools = createMemoryTools(store);
    const res = await tools.memory_query.handler({ space: 'Credentials', limit: 1, offset: 0 });

    expect(res.items.length).toBe(1);
    expect(res.pagination.nextOffset).toBe(1);
  });

  test('memory_query should return null nextOffset when page is exhausted', async () => {
    store = createTestStore();
    store.createSpace('Credentials', 'Secrets');
    await store.addMemory('Credentials', 'a', 'content');

    const tools = createMemoryTools(store);
    const res = await tools.memory_query.handler({ space: 'Credentials', limit: 25, offset: 0 });

    expect(res.items.length).toBe(1);
    expect(res.pagination.nextOffset).toBeNull();
  });
});
