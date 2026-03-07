import { afterEach, describe, expect, test } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import { createMemoryTools } from '../src/mcp/tools/memories';
import { createCheckpointTools } from '../src/mcp/tools/checkpoint';
import { createSpaceTools } from '../src/mcp/tools/spaces';
import { createTierTools } from '../src/mcp/tools/tiers';
import { createLinkTools } from '../src/mcp/tools/links';
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

describe('MCP Checkpoint Tools', () => {
    test('checkpoint_set should create checkpoint in hidden space', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');

        const tools = createCheckpointTools(store);
        const res = await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'Implement auth',
            pending: 'Fix login bug',
        });

        expect(res.content[0]?.text).toContain('created');
        expect(res.checkpoint).toBeDefined();
        const checkpoint = res.checkpoint;
        expect(checkpoint).toBeDefined();
        expect(checkpoint?.space).toBe('myproject:sessions');
        expect(checkpoint?.tags).toBeDefined();
        expect(checkpoint?.tags).toContain('checkpoint');
        expect(checkpoint?.tags).toContain('active');

        // Check space is hidden
        const space = store.getSpace('myproject:sessions');
        expect(space?.hidden).toBe(true);
    });

    test('checkpoint_set should update existing active checkpoint', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');

        const tools = createCheckpointTools(store);

        // Create first checkpoint
        await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'First goal',
            pending: 'First pending',
        });

        // Update it
        const res = await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'Updated goal',
            pending: 'Updated pending',
        });

        expect(res.content[0]?.text).toContain('updated');

        // Should still be one checkpoint
        const memories = store.listMemories('myproject:sessions');
        expect(memories.length).toBe(1);

        const firstMem = memories[0];
        expect(firstMem).toBeDefined();
        const mem = store.getMemoryById(firstMem!.id);
        expect(mem).toBeDefined();
        const content = JSON.parse(mem!.content);
        expect(content.goal).toBe('Updated goal');
    });

    test('checkpoint_recover should return active checkpoint', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');

        const tools = createCheckpointTools(store);

        await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'My goal',
            pending: 'My pending',
            notes: 'Some context',
        });

        const res = await tools.checkpoint_recover.handler({
            space: 'myproject',
        });

        expect(res.checkpoint).toBeDefined();
        const checkpoint = res.checkpoint;
        expect(checkpoint).toBeDefined();
        expect(checkpoint?.content.goal).toBe('My goal');
        expect(checkpoint?.content.pending).toBe('My pending');
        expect(checkpoint?.content.notes).toBe('Some context');
    });

    test('checkpoint_recover should return null when no checkpoint', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');

        const tools = createCheckpointTools(store);
        const res = await tools.checkpoint_recover.handler({
            space: 'myproject',
        });

        expect(res.checkpoint).toBeNull();
    });

    test('checkpoint_complete should mark as completed and demote', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');

        const tools = createCheckpointTools(store);

        await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'Goal',
            pending: 'Pending',
        });

        const memories = store.listMemories('myproject:sessions');
        const firstMem = memories[0];
        expect(firstMem).toBeDefined();
        const checkpointId = firstMem!.id;

        const res = await tools.checkpoint_complete.handler({
            space: 'myproject',
            checkpointId,
            whatWasDone: 'Fixed the bug',
        });

        expect(res.content[0]?.text).toContain('completed');

        const updated = store.getMemoryById(checkpointId);
        expect(updated).toBeDefined();
        expect(updated!.tags).toContain('completed');
        expect(updated!.tags).not.toContain('active');
        expect(updated!.tier).toBe(2); // Demoted to T2
    });

    test('checkpoint_list should list all checkpoints', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');

        const tools = createCheckpointTools(store);

        await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'Goal',
            pending: 'Pending',
        });

        const memories = store.listMemories('myproject:sessions');
        const firstMem = memories[0];
        expect(firstMem).toBeDefined();
        const checkpointId = firstMem!.id;

        await tools.checkpoint_complete.handler({
            space: 'myproject',
            checkpointId,
            whatWasDone: 'Done',
        });

        const res = await tools.checkpoint_list.handler({
            space: 'myproject',
        });

        expect(res.checkpoints.length).toBe(1);
        const firstCheckpoint = res.checkpoints[0];
        expect(firstCheckpoint).toBeDefined();
        expect(firstCheckpoint?.tags).toContain('completed');
    });

    test('checkpoint_set with related memories should create links', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'A project');
        const mem = await store.addMemory('myproject', 'auth', 'JWT auth');

        const tools = createCheckpointTools(store);
        const res = await tools.checkpoint_set.handler({
            space: 'myproject',
            goal: 'Fix auth',
            pending: 'Debug issue',
            relatedMemoryIds: [mem.id],
        });

        expect(res.checkpoint).toBeDefined();
        const checkpoint = res.checkpoint;
        expect(checkpoint).toBeDefined();
        const links = store.getLinks(checkpoint!.id);
        expect(links.length).toBe(1);
        const firstLink = links[0];
        expect(firstLink).toBeDefined();
        expect(firstLink?.target_id).toBe(mem.id);
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
        store.createSpace('proj1', 'Project 1');
        store.createSpace('proj2', 'Project 2');

        const tools = createSpaceTools(store);
        const res = await tools.space_list.handler({});

        expect(res.spaces.length).toBe(2);
    });

    test('space_get should return space details', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'My project');

        const tools = createSpaceTools(store);
        const res = await tools.space_get.handler({ name: 'myproject' });

        expect(res.space).toBeDefined();
        expect(res.space?.name).toBe('myproject');
    });

    test('space_update should update description', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'Old desc');

        const tools = createSpaceTools(store);
        const res = await tools.space_update.handler({
            name: 'myproject',
            description: 'New desc',
        });

        expect(res.content[0]?.text).toContain('updated');
        const space = store.getSpace('myproject');
        expect(space?.description).toBe('New desc');
    });

    test('space_rename should rename a space', async () => {
        store = createTestStore();
        store.createSpace('old', 'Old name');

        const tools = createSpaceTools(store);
        const res = await tools.space_rename.handler({ oldName: 'old', newName: 'new' });

        expect(res.content[0]?.text).toContain('renamed');
        expect(store.getSpace('new')).toBeDefined();
        expect(store.getSpace('old')).toBeNull();
    });

    test('space_delete should delete a space', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'To delete');

        const tools = createSpaceTools(store);
        const res = await tools.space_delete.handler({ name: 'myproject' });

        expect(res.content[0]?.text).toContain('deleted');
        expect(store.getSpace('myproject')).toBeNull();
    });

    test('space_tag_add should add tag', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'Project');

        const tools = createSpaceTools(store);
        const res = await tools.space_tag_add.handler({ space: 'myproject', tag: 'important' });

        expect(res.content[0]?.text).toContain('added');
        const space = store.getSpace('myproject');
        expect(space?.tags).toContain('important');
    });

    test('space_tag_remove should remove tag', async () => {
        store = createTestStore();
        store.createSpace('myproject', 'Project');
        store.addSpaceTag('myproject', 'important');

        const tools = createSpaceTools(store);
        const res = await tools.space_tag_remove.handler({ space: 'myproject', tag: 'important' });

        expect(res.content[0]?.text).toContain('removed');
        const space = store.getSpace('myproject');
        expect(space?.tags).not.toContain('important');
    });
});

describe('MCP Tiers Tools', () => {
    test('memory_promote should promote memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem', 'content', { tier: 2 });

        const tools = createTierTools(store);
        await tools.memory_promote.handler({ id: mem.id });

        const updated = store.getMemoryById(mem.id);
        expect(updated?.tier).toBe(1);
    });

    test('memory_demote should demote memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem', 'content', { tier: 1 });

        const tools = createTierTools(store);
        await tools.memory_demote.handler({ id: mem.id });

        const updated = store.getMemoryById(mem.id);
        expect(updated?.tier).toBe(2);
    });

    test('memory_pin should pin memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem', 'content');

        const tools = createTierTools(store);
        await tools.memory_pin.handler({ id: mem.id });

        const updated = store.getMemoryById(mem.id);
        expect(updated?.pinned).toBe(true);
    });

    test('memory_unpin should unpin memory', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem = await store.addMemory('test', 'mem', 'content');
        store.pin(mem.id);

        const tools = createTierTools(store);
        await tools.memory_unpin.handler({ id: mem.id });

        const updated = store.getMemoryById(mem.id);
        expect(updated?.pinned).toBe(false);
    });
});

describe('MCP Links Tools', () => {
    test('link_create should create link', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = await store.addMemory('test', 'mem1', 'content');
        const mem2 = await store.addMemory('test', 'mem2', 'content');

        const tools = createLinkTools(store);
        const res = await tools.link_create.handler({
            sourceId: mem1.id,
            targetId: mem2.id,
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
        store.createSpace('test', 'Test');
        const mem1 = await store.addMemory('test', 'mem1', 'content');
        const mem2 = await store.addMemory('test', 'mem2', 'content');
        store.link(mem1.id, mem2.id);

        const tools = createLinkTools(store);
        await tools.link_delete.handler({
            sourceId: mem1.id,
            targetId: mem2.id,
        });

        const links = store.getLinks(mem1.id);
        expect(links.length).toBe(0);
    });

    test('links_list should list memory links', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test');
        const mem1 = await store.addMemory('test', 'mem1', 'content');
        const mem2 = await store.addMemory('test', 'mem2', 'content');
        store.link(mem1.id, mem2.id);

        const tools = createLinkTools(store);
        const res = await tools.links_list.handler({ memoryId: mem1.id });

        expect(res.links.length).toBe(1);
        const firstLink = res.links[0];
        expect(firstLink).toBeDefined();
        expect(firstLink?.target_id).toBe(mem2.id);
    });
});
