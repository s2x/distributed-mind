import { afterEach, describe, expect, test } from 'bun:test';

import { createLinkTools } from '../src/mcp/tools/links';
import type { MindStore } from '../src/store/mind-store';

import { createTestStore } from './mocks/test-store';

let store: MindStore & { cleanup: () => void };

afterEach(async () => {
  store?.cleanup();
});

describe('Phase 2.4: Links Tools Redesign', () => {
  describe('link.create accepts "space:name" format', () => {
    test('2.4.1: link.create accepts "space:name" format for sourceRef and targetRef', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);
      const mem1 = await store.addMemory('proj', 'mem1', 'content 1', { tags: ['test'] });
      const mem2 = await store.addMemory('proj', 'mem2', 'content 2', { tags: ['test'] });

      const tools = createLinkTools(store);
      const res = await tools.link_create.handler({
        sourceRef: 'proj:mem1',
        targetRef: 'proj:mem2',
        label: 'relates_to',
      });

      expect(res.content[0]!.text).toContain('mem1');
      expect(res.content[0]!.text).toContain('mem2');
      expect(res.content[0]!.text).toContain('relates_to');

      const links = await store.getLinks(mem1.id);
      expect(links.length).toBe(1);
      expect(links[0]!.target_id).toBe(mem2.id);
    });

    test('2.4.2: link.create accepts "name" shorthand (same space)', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);
      const mem1 = await store.addMemory('proj', 'mem1', 'content 1', { tags: ['test'] });
      const mem2 = await store.addMemory('proj', 'mem2', 'content 2', { tags: ['test'] });

      const tools = createLinkTools(store);
      // When using "name" shorthand (no colon), it uses the source memory's space
      const res = await tools.link_create.handler({
        sourceRef: 'mem1',
        targetRef: 'mem2',
      });

      expect(res.content[0]!.text).toContain('mem1');
      expect(res.content[0]!.text).toContain('mem2');

      const links = await store.getLinks(mem1.id);
      expect(links.length).toBe(1);
      expect(links[0]!.target_id).toBe(mem2.id);
    });

    test('2.4.3: link.create with invalid ref format throws "invalid memory reference"', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);
      await store.addMemory('proj', 'mem1', 'content 1', { tags: ['test'] });

      const tools = createLinkTools(store);
      await expect(
        tools.link_create.handler({
          sourceRef: 'invalid-no-colon',
          targetRef: 'proj:mem1',
        })
      ).rejects.toThrow('invalid memory reference');
    });

    test('2.4.4: link.create with non-existing memory throws error', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);
      await store.addMemory('proj', 'mem1', 'content 1', { tags: ['test'] });

      const tools = createLinkTools(store);
      await expect(
        tools.link_create.handler({
          sourceRef: 'proj:mem1',
          targetRef: 'proj:nonexistent',
        })
      ).rejects.toThrow('memory not found');
    });
  });

  describe('link.delete accepts "space:name" format', () => {
    test('2.4.5: link.delete accepts "space:name" format', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);
      const mem1 = await store.addMemory('proj', 'mem1', 'content 1', { tags: ['test'] });
      const mem2 = await store.addMemory('proj', 'mem2', 'content 2', { tags: ['test'] });
      await store.link(mem1.id, mem2.id);

      const tools = createLinkTools(store);
      const res = await tools.link_delete.handler({
        sourceRef: 'proj:mem1',
        targetRef: 'proj:mem2',
      });

      expect(res.content[0]!.text).toContain('Unlinked');

      const links = await store.getLinks(mem1.id);
      expect(links.length).toBe(0);
    });

    test('2.4.6: link.delete accepts "name" shorthand (same space)', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);
      const mem1 = await store.addMemory('proj', 'mem1', 'content 1', { tags: ['test'] });
      const mem2 = await store.addMemory('proj', 'mem2', 'content 2', { tags: ['test'] });
      await store.link(mem1.id, mem2.id);

      const tools = createLinkTools(store);
      const res = await tools.link_delete.handler({
        sourceRef: 'mem1',
        targetRef: 'mem2',
      });

      expect(res.content[0]!.text).toContain('Unlinked');

      const links = await store.getLinks(mem1.id);
      expect(links.length).toBe(0);
    });
  });

  describe('links_list removed', () => {
    test('2.4.7: links_list no longer exists (tool not found)', async () => {
      store = createTestStore();
      await store.createSpace('proj', 'Project', ['test']);

      const tools = createLinkTools(store);
      // links_list should not exist as a tool
      expect((tools as any).links_list).toBeUndefined();
    });
  });
});
