import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import { createCheckpointTools } from '../src/mcp/tools/checkpoint';
import type { MindStore } from '../src/store/mind-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

// =============================================================================
// RED Phase: Tests for Phase 2.5 — Checkpoint Tools Rename
// checkpoint_set → checkpoint_save
// checkpoint_recover → checkpoint_load
// checkpoint_complete → checkpoint_done
// =============================================================================

describe('Phase 2.5: Checkpoint Tools Rename', () => {
    beforeEach(() => {
        store = createTestStore();
        store.createSpace('test-space', 'Test space', ['test']);
    });

    // ==========================================================================
    // 2.5.1 Test: checkpoint_save crea checkpoint
    // ==========================================================================
    describe('checkpoint.save', () => {
        test('2.5.1 checkpoint_save creates checkpoint in hidden space', async () => {
            const tools = createCheckpointTools(store);

            const res = await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'Implement auth',
                pending: 'Fix login bug',
            });

            expect(res.content[0]?.text).toContain('created');
            expect(res.checkpoint).toBeDefined();
            expect(res.checkpoint?.space).toBe('test-space:sessions');
            expect(res.checkpoint?.tags).toContain('checkpoint');
            expect(res.checkpoint?.tags).toContain('active');

            // Verify space is hidden
            const space = store.getSpace('test-space:sessions');
            expect(space?.hidden).toBe(true);
        });

        test('2.5.1b checkpoint_save creates checkpoint with relatedRefs', async () => {
            const tools = createCheckpointTools(store);

            // Create a memory to link
            const mem = await store.addMemory('test-space', 'my-memory', 'Some content', { tags: ['test'] });

            const res = await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'Implement auth',
                relatedRefs: [mem.id],
            });

            expect(res.checkpoint).toBeDefined();
            // Verify the link was created
            const links = store.getLinks(res.checkpoint!.id);
            expect(links.some((l) => l.target_id === mem.id)).toBe(true);
        });
    });

    // ==========================================================================
    // 2.5.2 Test: checkpoint_load recupera checkpoint activo
    // ==========================================================================
    describe('checkpoint.load', () => {
        test('2.5.2 checkpoint_load retrieves active checkpoint', async () => {
            const tools = createCheckpointTools(store);

            // First create a checkpoint
            await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'My goal',
                pending: 'Pending work',
                notes: 'Some notes',
            });

            // Now load it
            const res = await tools.checkpoint_load.handler({
                space: 'test-space',
            });

            expect(res.checkpoint).toBeDefined();
            expect(res.checkpoint?.content).toBeDefined();
            expect(res.checkpoint?.content.goal).toBe('My goal');
            expect(res.checkpoint?.content.pending).toBe('Pending work');
            expect(res.checkpoint?.content.notes).toBe('Some notes');
        });

        test('2.5.2b checkpoint_load returns recovery guidance when no active checkpoint', async () => {
            const tools = createCheckpointTools(store);

            const res = await tools.checkpoint_load.handler({
                space: 'test-space',
            });

            expect(res.checkpoint).toBeNull();
            expect(res.note).toContain('No active checkpoint');
        });
    });

    // ==========================================================================
    // 2.5.3 Test: checkpoint_list lista checkpoints
    // ==========================================================================
    describe('checkpoint.list', () => {
        test('2.5.3 checkpoint_list returns checkpoints', async () => {
            const tools = createCheckpointTools(store);

            // Create a checkpoint
            await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'First goal',
            });

            const res = await tools.checkpoint_list.handler({
                space: 'test-space',
            });

            expect(res.checkpoints).toBeDefined();
            expect(Array.isArray(res.checkpoints)).toBe(true);
            expect(res.checkpoints.length).toBeGreaterThan(0);
        });

        test('2.5.3b checkpoint_list filters by status', async () => {
            const tools = createCheckpointTools(store);

            // Create checkpoint and mark it complete
            const created = await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'Goal to complete',
            });

            await tools.checkpoint_done.handler({
                space: 'test-space',
                checkpointId: created.checkpoint!.id,
                summary: 'Work done',
            });

            const activeOnly = await tools.checkpoint_list.handler({
                space: 'test-space',
                status: 'active',
            });

            const completedOnly = await tools.checkpoint_list.handler({
                space: 'test-space',
                status: 'completed',
            });

            expect(activeOnly.checkpoints.every((c: any) => c.tags.includes('active'))).toBe(true);
            expect(completedOnly.checkpoints.every((c: any) => c.tags.includes('completed'))).toBe(true);
        });
    });

    // ==========================================================================
    // 2.5.4 Test: checkpoint_done marca checkpoint completo
    // ==========================================================================
    describe('checkpoint.done', () => {
        test('2.5.4 checkpoint_done marks checkpoint as completed', async () => {
            const tools = createCheckpointTools(store);

            // Create a checkpoint
            const created = await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'Goal to complete',
            });

            const res = await tools.checkpoint_done.handler({
                space: 'test-space',
                checkpointId: created.checkpoint!.id,
                summary: 'Finished auth implementation',
            });

            expect(res.content[0]?.text).toContain('completed');
            expect(res.checkpoint?.tags).toContain('completed');
            expect(res.checkpoint?.tags).not.toContain('active');
        });

        test('2.5.4b checkpoint_done demotes checkpoint to warm tier', async () => {
            const tools = createCheckpointTools(store);

            // Create a checkpoint (T1 by default)
            const created = await tools.checkpoint_save.handler({
                space: 'test-space',
                goal: 'Goal',
            });
            expect(created.checkpoint?.tier).toBe(1);

            // Complete it
            const res = await tools.checkpoint_done.handler({
                space: 'test-space',
                checkpointId: created.checkpoint!.id,
                summary: 'Done',
            });

            // Should be demoted to T2 (warm)
            expect(res.checkpoint?.tier).toBe(2);
        });
    });

    // ==========================================================================
    // 2.5.5 Test: checkpoint_set ya no existe (tool not found)
    // ==========================================================================
    test('2.5.5 checkpoint_set no longer exists - calling it throws', async () => {
        const tools = createCheckpointTools(store);

        expect(tools.checkpoint_set).toBeUndefined();
    });

    // ==========================================================================
    // 2.5.6 Test: checkpoint_complete ya no existe (tool not found)
    // ==========================================================================
    test('2.5.6 checkpoint_complete no longer exists - calling it throws', async () => {
        const tools = createCheckpointTools(store);

        expect(tools.checkpoint_complete).toBeUndefined();
    });

    // ==========================================================================
    // 2.5.7 Test: checkpoint_recover ya no existe (tool not found)
    // ==========================================================================
    test('2.5.7 checkpoint_recover no longer exists - calling it throws', async () => {
        const tools = createCheckpointTools(store);

        expect(tools.checkpoint_recover).toBeUndefined();
    });

    // ==========================================================================
    // Verify new tool names exist and work
    // ==========================================================================
    test('2.5.8 checkpoint_save is the new name for checkpoint_set', async () => {
        const tools = createCheckpointTools(store);

        expect(typeof tools.checkpoint_save).toBe('object');
        expect(typeof tools.checkpoint_save.handler).toBe('function');
    });

    test('2.5.9 checkpoint_load is the new name for checkpoint_recover', async () => {
        const tools = createCheckpointTools(store);

        expect(typeof tools.checkpoint_load).toBe('object');
        expect(typeof tools.checkpoint_load.handler).toBe('function');
    });

    test('2.5.10 checkpoint_done is the new name for checkpoint_complete', async () => {
        const tools = createCheckpointTools(store);

        expect(typeof tools.checkpoint_done).toBe('object');
        expect(typeof tools.checkpoint_done.handler).toBe('function');
    });
});
