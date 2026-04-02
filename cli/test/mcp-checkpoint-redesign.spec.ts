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

    test('2.5.1b checkpoint_save creates checkpoint with linked_memories (string refs)', async () => {
      const tools = createCheckpointTools(store);

      // Create a memory to link
      const mem = await store.addMemory('test-space', 'my-memory', 'Some content', {
        tags: ['test'],
      });

      const res = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement auth',
        linked_memories: ['my-memory'],
      });

      expect(res.checkpoint).toBeDefined();
      // Look up checkpoint by name to verify links
      const cpMemory = store.getMemory('test-space', res.checkpoint!.name);
      expect(cpMemory).toBeDefined();
      const links = store.getLinks(cpMemory!.id);
      expect(links.some(l => l.target_id === mem.id)).toBe(true);
    });

    test('2.5.1c checkpoint_save with linked_memories using space:name format', async () => {
      const tools = createCheckpointTools(store);

      // Create a memory to link
      const mem = await store.addMemory('test-space', 'my-memory', 'Some content', {
        tags: ['test'],
      });

      const res = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement auth',
        linked_memories: ['test-space:my-memory'],
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
    test('2.5.2 checkpoint_load retrieves checkpoint by name', async () => {
      const tools = createCheckpointTools(store);

      // First create a checkpoint
      const saved = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'My goal',
        pending: 'Pending work',
        notes: 'Some notes',
      });

      // Now load it by name
      const res = await tools.checkpoint_load.handler({
        space: 'test-space',
        checkpointName: saved.checkpoint!.name,
      });

      expect(res.checkpoint).toBeDefined();
      expect(res.checkpoint?.content).toBeDefined();
      expect(res.checkpoint?.content.goal).toBe('My goal');
      expect(res.checkpoint?.content.pending).toBe('Pending work');
      expect(res.checkpoint?.content.notes).toBe('Some notes');
    });

    test('2.5.2b checkpoint_load without checkpointName throws error', async () => {
      const tools = createCheckpointTools(store);

      await expect(
        tools.checkpoint_load.handler({
          space: 'test-space',
        })
      ).rejects.toThrow('checkpointName is required');
    });

    test('2.5.2c checkpoint_load returns checkpoint with linked_memories (includeHistory removed)', async () => {
      const tools = createCheckpointTools(store);

      // Create a memory to link
      await store.addMemory('test-space', 'auth', 'JWT auth', { tags: ['test'] });

      // Create a checkpoint with linked_memories
      const created = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'My goal',
        pending: 'Pending work',
        linked_memories: ['auth'],
      });

      // Load the checkpoint
      const res = await tools.checkpoint_load.handler({
        space: 'test-space',
        checkpointName: created.checkpoint!.name,
      });

      // Response should have checkpoint with linked_memories
      expect(res.checkpoint).toBeDefined();
      expect(res.checkpoint?.content?.goal).toBe('My goal');
      // linked_memories should be present
      expect(res.checkpoint?.linked_memories).toBeDefined();
      expect(res.checkpoint?.linked_memories?.length).toBeGreaterThan(0);
      // context_hits should NOT be present (removed)
      expect((res as any).context_hits).toBeUndefined();
    });
  });

  // ==========================================================================
  // checkpoint_query
  // ==========================================================================
  describe('checkpoint.query', () => {
    test('2.5.3 checkpoint_query returns checkpoints', async () => {
      const tools = createCheckpointTools(store);

      // Create a checkpoint
      await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'First goal',
      });

      const res = await tools.checkpoint_query.handler({
        space: 'test-space',
      });

      expect(res.checkpoints).toBeDefined();
      expect(Array.isArray(res.checkpoints)).toBe(true);
      expect(res.checkpoints.length).toBeGreaterThan(0);
    });

    test('2.5.3b checkpoint_query shows active checkpoints and no completed ones (Phase 2: checkpoint_done deletes checkpoint)', async () => {
      const tools = createCheckpointTools(store);

      // Create checkpoint and transform it via checkpoint_done
      const created = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Goal to complete',
      });

      await tools.checkpoint_done.handler({
        space: 'test-space',
        checkpointName: created.checkpoint!.name,
        summary: 'Work done',
      });

      // Active checkpoints should be 0 (checkpoint was deleted, not completed)
      const activeOnly = await tools.checkpoint_query.handler({
        space: 'test-space',
        status: 'active',
      });
      expect(activeOnly.checkpoints.length).toBe(0);

      // Completed checkpoints should also be 0 (checkpoint was DELETED, not marked completed)
      // This is the key Phase 2 behavior change: checkpoint_done transforms to session memory
      const completedOnly = await tools.checkpoint_query.handler({
        space: 'test-space',
        status: 'completed',
      });
      expect(completedOnly.checkpoints.length).toBe(0);
    });
  });

  // ==========================================================================
  // checkpoint_done — Phase 2: Option B (transform to session memory)
  // ==========================================================================
  describe('checkpoint.done (Phase 2: Option B)', () => {
    test('2.5.4 checkpoint_done transforms checkpoint into session memory in sessions/<repo>', async () => {
      const tools = createCheckpointTools(store);

      // Create a checkpoint
      const created = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Goal to complete',
      });
      const checkpointName = created.checkpoint!.name;

      const res = await tools.checkpoint_done.handler({
        space: 'test-space',
        checkpointName: checkpointName,
        summary: 'Finished auth implementation',
      });

      // Phase 2: Response should contain session_memory info
      expect(res.session_memory).toBeDefined();
      expect(res.session_memory?.space).toBe('sessions/test-space');
      expect(res.session_memory?.name).toContain('session-');
      expect(res.session_memory?.tags).toContain('type:session');
      expect(res.session_memory?.tags).toContain('cat:summary');

      // Original checkpoint should be deleted
      expect(store.getMemory('test-space', checkpointName)).toBeNull();

      // Session memory should exist in sessions space
      const sessionMem = store.getMemory('sessions/test-space', res.session_memory!.name);
      expect(sessionMem).toBeDefined();
      expect(sessionMem?.tags).toContain('type:session');
      expect(sessionMem?.tags).toContain('cat:summary');
    });

    test('2.5.4b checkpoint_done creates session memory with correct content', async () => {
      const tools = createCheckpointTools(store);

      // Create a checkpoint (T1 by default)
      const created = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Implement feature X',
        pending: 'Write tests',
        notes: 'Some implementation notes',
      });
      expect(created.checkpoint?.tier).toBe(1);
      const checkpointName = created.checkpoint!.name;

      // Transform it
      const res = await tools.checkpoint_done.handler({
        space: 'test-space',
        checkpointName: checkpointName,
        summary: 'Feature X is done',
      });

      // Session memory should exist in sessions space
      const sessionMem = store.getMemory('sessions/test-space', res.session_memory!.name);
      expect(sessionMem).toBeDefined();

      // Content should include checkpoint data plus summary
      const content = JSON.parse(sessionMem!.content);
      expect(content.goal).toBe('Implement feature X');
      expect(content.pending).toBe('Write tests');
      expect(content.notes).toBe('Some implementation notes');
      expect(content.whatWasDone).toBe('Feature X is done');
      expect(content.originalCheckpoint).toBe(checkpointName);

      // Original checkpoint should be deleted
      expect(store.getMemory('test-space', checkpointName)).toBeNull();
    });

    test('2.5.4c checkpoint_done twice returns error on second call', async () => {
      const tools = createCheckpointTools(store);

      // Create and transform checkpoint
      const created = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Goal',
      });

      await tools.checkpoint_done.handler({
        space: 'test-space',
        checkpointName: created.checkpoint!.name,
        summary: 'Done',
      });

      // Second call should fail - no active checkpoint
      await expect(
        tools.checkpoint_done.handler({
          space: 'test-space',
        })
      ).rejects.toThrow('No active checkpoint found');
    });

    test('2.5.4d checkpoint_done auto-creates sessions space if not exists', async () => {
      const tools = createCheckpointTools(store);

      // Ensure sessions space doesn't exist
      expect(store.getSpace('sessions/test-space')).toBeNull();

      // Create and transform checkpoint
      const created = await tools.checkpoint_save.handler({
        space: 'test-space',
        goal: 'Goal',
      });

      const res = await tools.checkpoint_done.handler({
        space: 'test-space',
        checkpointName: created.checkpoint!.name,
        summary: 'Done',
      });

      // Sessions space should be auto-created
      expect(store.getSpace('sessions/test-space')).toBeDefined();
      expect(res.session_memory?.space).toBe('sessions/test-space');
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
