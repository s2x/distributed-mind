import { afterEach, describe, expect, test } from 'bun:test';

import { createCheckpointTools } from '../src/mcp/tools/checkpoint';
import { createLinkTools } from '../src/mcp/tools/links';
import { createMemoryTools } from '../src/mcp/tools/memories';
import { createSearchTools } from '../src/mcp/tools/search';
import { createSpaceTools } from '../src/mcp/tools/spaces';
import type { MindStore } from '../src/store/mind-store';

import { createTestStore } from './mocks/test-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
  store?.cleanup();
});

describe('MCP Memory Tools', () => {
  test('memory_add should support pinned and links_to by name', async () => {
    store = createTestStore();
    store.createSpace('proj', 'Project', ['test']);
    await store.addMemory('proj', 'target', 'target content', { tags: ['test'] });

    const tools = createMemoryTools(store);
    const res = await tools.memory_add.handler({
      space: 'proj',
      name: 'source',
      content: 'source content',
      tags: ['cat:decision'],
      pinned: true,
      links_to: ['target'],
    });

    expect(res.memory.pinned).toBe(true);
    // Verify link was created (use store internals since MCP no longer exposes IDs)
    const source = store.getMemory('proj', 'source')!;
    const links = store.getLinks(source.id);
    expect(links.length).toBe(1);
  });

  test('memory_add should be atomic when links_to contains invalid ref', async () => {
    store = createTestStore();
    store.createSpace('proj', 'Project', ['test']);
    const tools = createMemoryTools(store);

    await expect(
      tools.memory_add.handler({
        space: 'proj',
        name: 'source',
        content: 'source content',
        tags: ['test'],
        links_to: ['nonexistent-memory'],
      })
    ).rejects.toThrow();

    expect(store.getMemory('proj', 'source')).toBeNull();
  });

  test('memory_read should include linked summaries by direction with refs', async () => {
    store = createTestStore();
    store.createSpace('proj', 'Project', ['test']);
    const base = await store.addMemory('proj', 'base', 'base content', { tags: ['cat:decision'] });
    const outgoing = await store.addMemory('proj', 'outgoing', 'outgoing content', {
      tags: ['cat:bugfix'],
    });
    const incoming = await store.addMemory('proj', 'incoming', 'incoming content', {
      tags: ['cat:pattern'],
    });
    store.link(base.id, outgoing.id);
    store.link(incoming.id, base.id);

    const tools = createMemoryTools(store);
    const res = await tools.memory_read.handler({ space: 'proj', name: 'base' });

    expect(res.memory).not.toBeNull();
    expect(res.memory?.pinned).toBe(false);
    expect(res.links_to.length).toBe(1);
    expect(res.linked_by.length).toBe(1);
    // Links include ref string instead of id
    expect(Object.keys(res.links_to[0] ?? {}).sort()).toEqual(
      ['changed_at', 'name', 'pinned', 'ref', 'space', 'tags', 'tier'].sort()
    );
    expect(res.links_to[0]?.ref).toBe('proj:outgoing');
    expect(res.linked_by[0]?.ref).toBe('proj:incoming');
  });

  test('memory_query should use default pagination values', async () => {
    store = createTestStore();
    store.createSpace('Credentials', 'Secrets', ['test']);
    await store.addMemory('Credentials', 'a', 'content', { tags: ['test'] });

    const tools = createSearchTools(store);
    const res = await tools.memory_query.handler({ space: 'Credentials' });

    expect(res.limit).toBe(25);
    expect(res.offset).toBe(0);
    expect(Array.isArray(res.memories)).toBe(true);
    expect(res.memories.length).toBe(1);
  });

  test('memory_query should respect limit and offset', async () => {
    store = createTestStore();
    store.createSpace('Credentials', 'Secrets', ['test']);
    await store.addMemory('Credentials', 'a', 'content', { tags: ['test'] });
    await store.addMemory('Credentials', 'b', 'content', { tags: ['test'] });

    const tools = createSearchTools(store);
    const res = await tools.memory_query.handler({ space: 'Credentials', limit: 1, offset: 0 });

    expect(res.memories.length).toBe(1);
    expect(res.limit).toBe(1);
    expect(res.offset).toBe(0);
    expect(res.total).toBe(2);
  });

  test('memory_query should return all memories when page covers all', async () => {
    store = createTestStore();
    store.createSpace('Credentials', 'Secrets', ['test']);
    await store.addMemory('Credentials', 'a', 'content', { tags: ['test'] });

    const tools = createSearchTools(store);
    const res = await tools.memory_query.handler({ space: 'Credentials', limit: 25, offset: 0 });

    expect(res.memories.length).toBe(1);
    expect(res.total).toBe(1);
  });
});

describe('MCP Checkpoint Tools', () => {
  test('checkpoint_save should create checkpoint in the same space', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);
    const res = await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'Implement auth',
      pending: 'Fix login bug',
    });

    expect(res.content[0]?.text).toContain('created');
    expect(res.checkpoint).toBeDefined();
    const checkpoint = res.checkpoint;
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.space).toBe('myproject');
    expect(checkpoint?.tags).toBeDefined();
    expect(checkpoint?.tags).toContain('checkpoint');
    expect(checkpoint?.tags).toContain('active');
  });

  test('checkpoint_save should update existing active checkpoint', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);

    // Create first checkpoint
    await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'First goal',
      pending: 'First pending',
    });

    // Update it
    const res = await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'Updated goal',
      pending: 'Updated pending',
    });

    expect(res.content[0]?.text).toContain('updated');

    // Should still be one checkpoint (filter by tag to exclude non-checkpoint memories)
    const memories = store.listMemories('myproject', { tag: 'checkpoint' });
    expect(memories.length).toBe(1);

    const firstMem = memories[0];
    expect(firstMem).toBeDefined();
    const mem = store.getMemoryById(firstMem!.id);
    expect(mem).toBeDefined();
    const content = JSON.parse(mem!.content);
    expect(content.goal).toBe('Updated goal');
  });

  test('checkpoint_load should return active checkpoint', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);

    await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'My goal',
      pending: 'My pending',
      notes: 'Some context',
    });

    const res = await tools.checkpoint_load.handler({
      space: 'myproject',
    });

    expect(res.checkpoint).toBeDefined();
    const checkpoint = res.checkpoint;
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.content.goal).toBe('My goal');
    expect(checkpoint?.content.pending).toBe('My pending');
    expect(checkpoint?.content.notes).toBe('Some context');
  });

  test('checkpoint_load should return null when no checkpoint', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);
    const res = await tools.checkpoint_load.handler({
      space: 'myproject',
    });

    expect(res.checkpoint).toBeNull();
  });

  test('checkpoint_done should mark as completed and demote', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);

    const created = await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'Goal',
      pending: 'Pending',
    });

    const res = await tools.checkpoint_done.handler({
      space: 'myproject',
      checkpointName: created.checkpoint!.name,
      summary: 'Fixed the bug',
    });

    expect(res.content[0]?.text).toContain('completed');
    expect(res.checkpoint?.tags).toContain('completed');
    expect(res.checkpoint?.tags).not.toContain('active');
    expect(res.checkpoint?.tier).toBe(2); // Demoted to T2
  });

  test('checkpoint_list should list all checkpoints', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);

    const created = await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'Goal',
      pending: 'Pending',
    });

    await tools.checkpoint_done.handler({
      space: 'myproject',
      checkpointName: created.checkpoint!.name,
      summary: 'Done',
    });

    const res = await tools.checkpoint_list.handler({
      space: 'myproject',
    });

    expect(res.checkpoints.length).toBe(1);
    const firstCheckpoint = res.checkpoints[0];
    expect(firstCheckpoint).toBeDefined();
    expect(firstCheckpoint?.tags).toContain('completed');
  });

  test('checkpoint_save with related memories should create links', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);
    const mem = await store.addMemory('myproject', 'auth', 'JWT auth', { tags: ['test'] });

    const tools = createCheckpointTools(store);
    const res = await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'Fix auth',
      pending: 'Debug issue',
      relatedRefs: ['auth'],
    });

    expect(res.checkpoint).toBeDefined();
    const checkpoint = res.checkpoint;
    expect(checkpoint).toBeDefined();
    // Look up checkpoint by name in the same space
    const cpMemory = store.getMemory('myproject', checkpoint!.name);
    expect(cpMemory).toBeDefined();
    const links = store.getLinks(cpMemory!.id);
    expect(links.length).toBe(1);
    const firstLink = links[0];
    expect(firstLink).toBeDefined();
    expect(firstLink?.target_id).toBe(mem.id);
  });

  test('checkpoint_load should support text|md|json formats with coherent content', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);
    await store.addMemory('myproject', 'auth', 'JWT auth flow', { tags: ['test'] });

    const tools = createCheckpointTools(store);
    await tools.checkpoint_save.handler({
      space: 'myproject',
      goal: 'Stabilize auth',
      pending: 'Fix token refresh edge cases',
    });

    const textRes = await tools.checkpoint_load.handler({
      space: 'myproject',
      format: 'text',
      agent: 'opencode',
    });
    const mdRes = await tools.checkpoint_load.handler({
      space: 'myproject',
      format: 'md',
      agent: 'opencode',
    });
    const jsonRes = await tools.checkpoint_load.handler({
      space: 'myproject',
      format: 'json',
      agent: 'opencode',
    });

    expect(textRes.recoveryPack).toBeDefined();
    expect(mdRes.recoveryPack).toBeDefined();
    expect(jsonRes.recoveryPack).toBeDefined();
    expect(jsonRes.recoveryPack?.checkpoint?.content?.goal).toBe('Stabilize auth');
    expect(mdRes.content[0]?.text).toContain('Stabilize auth');
    expect(textRes.content[0]?.text).toContain('Stabilize auth');
    expect(jsonRes.recoveryPack?.capability_profile?.L1_MCP?.status).toBeDefined();
    expect(jsonRes.recoveryPack?.capability_profile?.L2_INSTRUCTIONS?.fallback).toBeDefined();
    expect(jsonRes.recoveryPack?.capability_profile?.L3_HOOKS?.evidence).toBeDefined();
  });

  test('checkpoint_load should return useful guidance when no active checkpoint exists', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'A project', ['test']);

    const tools = createCheckpointTools(store);
    const res = await tools.checkpoint_load.handler({
      space: 'myproject',
      format: 'json',
      agent: 'codex',
    });

    expect(res.checkpoint).toBeNull();
    expect(res.recoveryPack?.guidance?.length).toBeGreaterThan(0);
    expect(res.recoveryPack?.capability_profile?.L2_INSTRUCTIONS?.status).toBe('supported');
    expect(res.content[0]?.text).toContain('guidance');
  });
});

describe('MCP Spaces Tools', () => {
  test('space_create should create a space', async () => {
    store = createTestStore();

    const tools = createSpaceTools(store);
    const res = await tools.space_create.handler({
      name: 'myproject',
      description: 'My project',
      tags: ['project'],
    });

    expect(res.content[0]?.text).toContain('created');
    expect(res.space).toBeDefined();
    expect(res.space?.name).toBe('myproject');
    expect(res.space?.description).toBe('My project');
  });

  test('space_list should list spaces', async () => {
    store = createTestStore();
    store.createSpace('proj1', 'Project 1', ['test']);
    store.createSpace('proj2', 'Project 2', ['test']);

    const tools = createSpaceTools(store);
    const res = await tools.space_list.handler({});

    expect(res.spaces.length).toBe(2);
  });

  test('space_get should return space details', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'My project', ['test']);

    const tools = createSpaceTools(store);
    const res = await tools.space_get.handler({ name: 'myproject' });

    expect(res.space).toBeDefined();
    expect(res.space?.name).toBe('myproject');
  });

  test('space_update should update description', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'Old desc', ['test']);

    const tools = createSpaceTools(store);
    const res = await tools.space_update.handler({
      name: 'myproject',
      description: 'New desc',
    });

    expect(res.content[0]?.text).toContain('updated');
    const space = store.getSpace('myproject');
    expect(space?.description).toBe('New desc');
  });

  test('space_delete should delete a space', async () => {
    store = createTestStore();
    store.createSpace('myproject', 'To delete', ['test']);

    const tools = createSpaceTools(store);
    const res = await tools.space_delete.handler({ name: 'myproject' });

    expect(res.content[0]?.text).toContain('deleted');
    expect(store.getSpace('myproject')).toBeNull();
  });
});

describe('MCP Links Tools', () => {
  test('link_create should create link', async () => {
    store = createTestStore();
    store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    const tools = createLinkTools(store);
    const res = await tools.link_create.handler({
      sourceRef: 'test:mem1',
      targetRef: 'test:mem2',
      label: 'depends-on',
    });

    expect(res.content[0]?.text).toContain('Linked:');

    const links = store.getLinks(mem1.id);
    expect(links.length).toBe(1);
    const firstLink = links[0];
    expect(firstLink).toBeDefined();
    expect(firstLink?.label).toBe('depends-on');
  });

  test('link_delete should delete link', async () => {
    store = createTestStore();
    store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });
    store.link(mem1.id, mem2.id);

    const tools = createLinkTools(store);
    await tools.link_delete.handler({
      sourceRef: 'test:mem1',
      targetRef: 'test:mem2',
    });

    const links = store.getLinks(mem1.id);
    expect(links.length).toBe(0);
  });

  // links_list has been removed - use memory_read instead (it now includes linked memory summaries)
});
