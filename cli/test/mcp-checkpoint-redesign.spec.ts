import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createCheckpointTools } from '../src/mcp/tools/checkpoint';
import type { MindStore } from '../src/store/mind-store';

import { createTestStore } from './mocks/test-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
  store?.cleanup();
});

// =============================================================================
// Phase 2.5: Checkpoint Tools — Same Space, Tag-based
// Checkpoints live in the project space with tag "checkpoint"
// =============================================================================

describe('Phase 2.5: Checkpoint Tools (same space)', () => {
  beforeEach(() => {
    store = createTestStore();
    store.createSpace('test-space', 'Test space', ['test']);
  });

  // ==========================================================================
  // checkpoint_save
  // ==========================================================================
  describe('checkpoint.save', () => {
    test('2.5.1 checkpoint_save creates checkpoint in the same space', async () => {
      const tools = createCheckpointTools(store);

      const res = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement auth',
        pending: 'Fix login bug',
      });

      expect(res.content[0]?.text).toContain('created');
      expect(res.checkpoint).toBeDefined();
      expect(res.checkpoint?.space).toBe('test-space');
      expect(res.checkpoint?.tags).toContain('checkpoint');
      expect(res.checkpoint?.tags).toContain('active');
    });

    test('2.5.1b checkpoint_save creates checkpoint with relatedRefs (string refs)', async () => {
      const tools = createCheckpointTools(store);

      // Create a memory to link
      const mem = await store.addMemory('test-space', 'my-memory', 'Some content', {
        tags: ['test'],
      });

      const res = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement auth',
        relatedRefs: ['my-memory'],
      });

      expect(res.checkpoint).toBeDefined();
      // Look up checkpoint by name to verify links
      const cpMemory = store.getMemory('test-space', res.checkpoint!.name);
      expect(cpMemory).toBeDefined();
      const links = store.getLinks(cpMemory!.id);
      expect(links.some(l => l.target_id === mem.id)).toBe(true);
    });

    test('2.5.1c checkpoint_save with relatedRefs using space:name format', async () => {
      const tools = createCheckpointTools(store);

      // Create a memory to link
      const mem = await store.addMemory('test-space', 'my-memory', 'Some content', {
        tags: ['test'],
      });

      const res = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement auth',
        relatedRefs: ['test-space:my-memory'],
      });

      expect(res.checkpoint).toBeDefined();
      const cpMemory = store.getMemory('test-space', res.checkpoint!.name);
      expect(cpMemory).toBeDefined();
      const links = store.getLinks(cpMemory!.id);
      expect(links.some(l => l.target_id === mem.id)).toBe(true);
    });

    test('checkpoint_save throws if space does not exist', async () => {
      const tools = createCheckpointTools(store);

      await expect(
        tools.checkpoint_save.handler({
          space: 'nonexistent',
          goal: 'Goal',
        })
      ).rejects.toThrow('not found');
    });

    test('checkpoint_save does NOT create a hidden :sessions space', async () => {
      const tools = createCheckpointTools(store);

      await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement auth',
      });

      // No :sessions space should exist
      const sessionsSpace = store.getSpace('test-space:sessions');
      expect(sessionsSpace).toBeNull();
    });
  });

  // ==========================================================================
  // checkpoint_load
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
  // checkpoint_list
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
        checkpointName: created.checkpoint!.name,
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
  // checkpoint_done
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
        checkpointName: created.checkpoint!.name,
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
        checkpointName: created.checkpoint!.name,
        summary: 'Done',
      });

      // Should be demoted to T2 (warm)
      expect(res.checkpoint?.tier).toBe(2);
    });
  });

  // ==========================================================================
  // Old tool names no longer exist
  // ==========================================================================
  test('2.5.5 checkpoint_set no longer exists', async () => {
    const tools = createCheckpointTools(store);
    expect(tools.checkpoint_set).toBeUndefined();
  });

  test('2.5.6 checkpoint_complete no longer exists', async () => {
    const tools = createCheckpointTools(store);
    expect(tools.checkpoint_complete).toBeUndefined();
  });

  test('2.5.7 checkpoint_recover no longer exists', async () => {
    const tools = createCheckpointTools(store);
    expect(tools.checkpoint_recover).toBeUndefined();
  });

  // ==========================================================================
  // New tool names exist
  // ==========================================================================
  test('2.5.8 checkpoint_save exists', async () => {
    const tools = createCheckpointTools(store);
    expect(typeof tools.checkpoint_save).toBe('object');
    expect(typeof tools.checkpoint_save.handler).toBe('function');
  });

  test('2.5.9 checkpoint_load exists', async () => {
    const tools = createCheckpointTools(store);
    expect(typeof tools.checkpoint_load).toBe('object');
    expect(typeof tools.checkpoint_load.handler).toBe('function');
  });

  test('2.5.10 checkpoint_done exists', async () => {
    const tools = createCheckpointTools(store);
    expect(typeof tools.checkpoint_done).toBe('object');
    expect(typeof tools.checkpoint_done.handler).toBe('function');
  });
});
