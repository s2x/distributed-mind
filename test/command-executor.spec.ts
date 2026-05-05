import { describe, expect, test, afterEach } from 'bun:test';

import { executeCommand } from '../src/cli/command-executor';
import type { MindStore } from '../src/store/mind-store';

import { mockedLogger } from './mocks/mocked-logger';
import { createTestStore } from './mocks/test-store';

let store: MindStore & { cleanup: () => void };

afterEach(async () => {
  store?.cleanup();
});

describe('Command Executor — Basics', () => {
  test('should show help', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await executeCommand(['help'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('mind'))).toBe(true);
  });

  test('should throw for empty args', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    expect(() => executeCommand([], store, logger)).toThrow('No arguments provided');
  });

  test('should throw for unknown command', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    expect(() => executeCommand(['banana'], store, logger)).toThrow('Unknown command');
  });

  test('should reject unknown runtime subcommands', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    expect(() => executeCommand(['mcp', 'help'], store, logger)).toThrow('Unknown command');
    expect(() => executeCommand(['serve', 'help'], store, logger)).toThrow('Unknown command');
  });
});

describe('Command Executor — Spaces', () => {
  test('should create a space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await executeCommand(['create', 'test-space', 'A test space'], store, logger);

    const space = await store.getSpace('test-space');
    expect(space).not.toBeNull();
    expect(space!.description).toBe('A test space');
    expect(logger.getLogs().some(l => l.message.includes('created'))).toBe(true);
  });

  test('should create a space with tags', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await executeCommand(
      ['create', 'test-space', 'A test space', '--tags', 'project,dev'],
      store,
      logger
    );

    const space = await store.getSpace('test-space');
    expect(space!.tags).toContain('project');
    expect(space!.tags).toContain('dev');
  });

  test('should list spaces', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('space1', 'Space 1', ['test']);
    await store.createSpace('space2', 'Space 2', ['test']);

    await executeCommand(['list'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('space1'))).toBe(true);
    expect(logs.some(l => l.message.includes('space2'))).toBe(true);
  });

  test('should delete a space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await executeCommand(['delete', 'test'], store, logger);
    expect(await store.getSpace('test')).toBeNull();
  });

  test('should rename a space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('old', 'Old', ['test']);
    await executeCommand(['rename', 'old', 'new'], store, logger);
    expect(await store.getSpace('old')).toBeNull();
    expect(await store.getSpace('new')).not.toBeNull();
  });

  test('should describe a space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Old desc', ['test']);
    await executeCommand(['describe', 'test', 'New desc'], store, logger);
    expect((await store.getSpace('test'))!.description).toBe('New desc');
  });

  test('should tag and untag a space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);

    await executeCommand(['tag', 'test', 'project'], store, logger);
    expect((await store.getSpace('test'))!.tags).toContain('project');

    await executeCommand(['untag', 'test', 'project'], store, logger);
    expect((await store.getSpace('test'))!.tags).not.toContain('project');
  });

  test('should update space to hidden', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);

    await executeCommand(['update', 'test', '--hidden'], store, logger);

    const space = await store.getSpace('test');
    expect(space!.hidden).toBe(true);

    // Should not appear in regular list
    const list = await store.listSpaces();
    expect(list.length).toBe(0);

    // Should appear with hidden flag
    const listHidden = await store.listSpaces({ includeHidden: true });
    expect(listHidden.length).toBe(1);
  });

  test('should update hidden space to visible', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.updateSpace('test', { hidden: true });

    await executeCommand(['update', 'test', '--no-hidden'], store, logger);

    const space = await store.getSpace('test');
    expect(space!.hidden).toBe(false);

    // Should appear in regular list
    const list = await store.listSpaces();
    expect(list.length).toBe(1);
  });

  test('should list hidden spaces with --hidden flag', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('visible', 'Visible', ['test']);
    await store.createSpace('hidden', 'Hidden', ['test']);
    await store.updateSpace('hidden', { hidden: true });

    await executeCommand(['list', '--hidden'], store, logger);

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('visible'))).toBe(true);
    expect(logs.some(l => l.message.includes('hidden'))).toBe(true);
  });
});

describe('Command Executor — Memories', () => {
  test('should add a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await executeCommand(['add', 'test', 'auth', 'JWT auth flow'], store, logger);

    const mem = await store.getMemory('test', 'auth');
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe('JWT auth flow');
  });

  test('should add a memory with tags and tier', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await executeCommand(
      ['add', 'test', 'auth', 'JWT auth', '--tags', 'backend,security', '--tier', '1'],
      store,
      logger
    );

    const mem = await store.getMemory('test', 'auth');
    expect(mem!.tier).toBe(1);
    expect(mem!.tags).toContain('backend');
  });

  test('should read a memory and record access', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'JWT auth', { tags: ['test'] });

    await executeCommand(['read', 'test', 'auth'], store, logger);

    const mem = await store.getMemory('test', 'auth');
    expect(mem!.access_count).toBe(1);
    expect(logger.getLogs().some(l => l.message.includes('auth'))).toBe(true);
  });

  test('should edit a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'Old content', { tags: ['test'] });

    await executeCommand(['edit', 'test', 'auth', 'New content'], store, logger);
    expect((await store.getMemory('test', 'auth'))!.content).toBe('New content');
  });

  test('should remove a memory by name', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'content', { tags: ['test'] });

    await executeCommand(['remove', 'test', 'auth'], store, logger);
    expect(await store.getMemory('test', 'auth')).toBeNull();
  });

  test('should list memories of a space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tier: 1, tags: ['test'] });
    await store.addMemory('test', 'mem2', 'content', { tier: 2, tags: ['test'] });

    await executeCommand(['list', 'test'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('mem1'))).toBe(true);
    expect(logs.some(l => l.message.includes('mem2'))).toBe(true);
  });

  test('should tag and untag a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'content', { tags: ['test'] });

    await executeCommand(['tag', 'test', 'auth', 'important'], store, logger);
    expect((await store.getMemory('test', 'auth'))!.tags).toContain('important');

    await executeCommand(['untag', 'test', 'auth', 'important'], store, logger);
    expect((await store.getMemory('test', 'auth'))!.tags).not.toContain('important');
  });
});

describe('Command Executor — Tiers', () => {
  test('should promote a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem', 'content', { tier: 3, tags: ['test'] });

    await executeCommand(['promote', 'test', 'mem'], store, logger);
    expect((await store.getMemory('test', 'mem'))!.tier).toBe(2);
  });

  test('should demote a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem', 'content', { tier: 1, tags: ['test'] });

    await executeCommand(['demote', 'test', 'mem'], store, logger);
    expect((await store.getMemory('test', 'mem'))!.tier).toBe(2);
  });

  test('should pin a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem', 'content', { tags: ['test'] });

    await executeCommand(['pin', 'test', 'mem'], store, logger);
    expect((await store.getMemory('test', 'mem'))!.pinned).toBe(true);
  });

  test('should unpin a memory', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'mem', 'content', { tags: ['test'] });
    await store.pin(mem.id);

    await executeCommand(['unpin', 'test', 'mem'], store, logger);
    expect((await store.getMemory('test', 'mem'))!.pinned).toBe(false);
  });
});

describe('Command Executor — Links', () => {
  test('should link two memories', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });

    await executeCommand(['link', 'test/mem1', 'test/mem2', '--label', 'depends-on'], store, logger);

    const mem1 = await store.getMemory('test', 'mem1');
    const links = await store.getLinks(mem1!.id);
    expect(links.length).toBe(1);
    expect(links[0]!.label).toBe('depends-on');
  });

  test('should show links', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });
    await store.link(mem1.id, mem2.id, 'related');

    await executeCommand(['links', 'test', 'mem1'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('mem2'))).toBe(true);
  });

  test('should unlink memories', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    const mem1 = await store.addMemory('test', 'mem1', 'content', { tags: ['test'] });
    const mem2 = await store.addMemory('test', 'mem2', 'content', { tags: ['test'] });
    await store.link(mem1.id, mem2.id);

    await executeCommand(['unlink', 'test/mem1', 'test/mem2'], store, logger);
    const links = await store.getLinks(mem1.id);
    expect(links.length).toBe(0);
  });
});

describe('Command Executor — Search', () => {
  test('should search memories', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'JWT authentication with refresh tokens', { tags: ['test'] });
    await store.addMemory('test', 'db', 'PostgreSQL database schema', { tags: ['test'] });

    await executeCommand(['search', 'authentication'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('auth'))).toBe(true);
    expect(logs.some(l => l.message.includes('db'))).toBe(false);
  });

  test('should not show content by default', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'JWT authentication with refresh tokens', { tags: ['test'] });

    await executeCommand(['search', 'authentication'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('JWT'))).toBe(false);
  });

  test('should show content with --detail', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'JWT authentication with refresh tokens', { tags: ['test'] });

    await executeCommand(['search', 'authentication', '--detail'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('JWT'))).toBe(true);
  });

  test('should support prefix wildcard search', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'auth', 'JWT authentication with refresh tokens', { tags: ['test'] });

    await executeCommand(['search', 'auth*'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('auth'))).toBe(true);
  });

  test('should search with space filter', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('proj-a', 'A', ['test']);
    await store.createSpace('proj-b', 'B', ['test']);
    await store.addMemory('proj-a', 'auth', 'authentication', { tags: ['test'] });
    await store.addMemory('proj-b', 'auth', 'authentication', { tags: ['test'] });

    await executeCommand(['search', 'authentication', '--space', 'proj-a'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('proj-a'))).toBe(true);
  });

  test('should query memories with metadata filters', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('proj-a', 'A', ['test']);
    await store.createSpace('proj-b', 'B', ['test']);
    await store.addMemory('proj-a', 'auth', 'authentication', { tags: ['backend'], tier: 1 });
    await store.addMemory('proj-b', 'auth', 'authentication', { tags: ['backend'], tier: 1 });

    await executeCommand(
      ['query', '--space', 'proj-a', '--tag', 'backend', '--tier', '1'],
      store,
      logger
    );
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('proj-a') && l.message.includes('auth'))).toBe(true);
    expect(logs.some(l => l.message.includes('proj-b') && l.message.includes('auth'))).toBe(false);
  });

  test('should show pagination with next offset in query output', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'a', 'content', { tags: ['test'] });
    await store.addMemory('test', 'b', 'content', { tags: ['test'] });

    await executeCommand(
      ['query', '--space', 'test', '--limit', '1', '--offset', '0'],
      store,
      logger
    );
    const logs = logger.getLogs();
    expect(
      logs.some(l => l.message.includes('Pagination | limit: 1 | offset: 0 | next offset: 1'))
    ).toBe(true);
  });

  test('should show N/A next offset when query page is exhausted', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'a', 'content', { tags: ['test'] });

    await executeCommand(['query', '--space', 'test'], store, logger);
    const logs = logger.getLogs();
    expect(
      logs.some(l => l.message.includes('Pagination | limit: 25 | offset: 0 | next offset: N/A'))
    ).toBe(true);
  });
});

describe('Command Executor — Guide', () => {
  test('should show agent guide', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await executeCommand(['guide', 'agent'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('Agent Guide'))).toBe(true);
  });

  test('should show human guide', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await executeCommand(['guide'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('User Guide'))).toBe(true);
  });
});

describe('Command Executor — Status', () => {
  test('should run global status', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem', 'content', { tags: ['test'] });

    await executeCommand(['status'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('Status'))).toBe(true);
    // Should show tier labels
    expect(logs.some(l => l.message.includes('T1') || l.message.includes('hot'))).toBe(true);
  });

  test('should run space-scoped status', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addMemory('test', 'mem', 'content', { tags: ['test'] });

    await executeCommand(['status', 'test'], store, logger);
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('test'))).toBe(true);
  });

  test('should reject --tier 4 when adding a memory (T4 has been removed)', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);

    await expect(
      executeCommand(['add', 'test', 'frozen', 'content', '--tier', '4'], store, logger)
    ).rejects.toThrow('must be 1, 2, or 3');
  });
});

describe('Command Executor — Checkpoint', () => {
  test('should create a checkpoint', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    await executeCommand(
      ['checkpoint', 'set', 'myproject', 'Implement auth', 'Fix login bug'],
      store,
      logger
    );

    // Check memory was created in the same space (not a hidden :sessions space)
    const memories = await store.listMemories('myproject', { tag: 'checkpoint' });
    expect(memories.length).toBe(1);
    expect(memories[0]!.tags).toContain('checkpoint');
    expect(memories[0]!.tags).toContain('active');
    expect(memories[0]!.tier).toBe(1); // T1 hot

    // No :sessions space should exist
    expect(await store.getSpace('myproject:sessions')).toBeNull();

    // Check log output
    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('Checkpoint created'))).toBe(true);
  });

  test('should update existing active checkpoint', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    // Create first checkpoint
    await executeCommand(
      ['checkpoint', 'set', 'myproject', 'First goal', 'First pending'],
      store,
      logger
    );
    const memories1 = await store.listMemories('myproject', { tag: 'checkpoint' });
    const firstId = memories1[0]!.id;

    // Update the same checkpoint
    await executeCommand(
      ['checkpoint', 'set', 'myproject', 'Updated goal', 'Updated pending'],
      store,
      logger
    );
    const memories2 = await store.listMemories('myproject', { tag: 'checkpoint' });

    // Should still be one checkpoint (updated, not created)
    expect(memories2.length).toBe(1);
    expect(memories2[0]!.id).toBe(firstId);

    // Check content was updated
    const mem = await store.getMemoryById(firstId);
    const content = JSON.parse(mem!.content);
    expect(content.goal).toBe('Updated goal');

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('updated'))).toBe(true);
  });

  test('should recover checkpoint by name', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    // Create checkpoint
    await executeCommand(
      ['checkpoint', 'set', 'myproject', 'My goal', 'My pending'],
      store,
      logger
    );

    // Get checkpoint name
    const memories = await store.listMemories('myproject', { tag: 'checkpoint' });
    const cpName = memories[0]!.name;

    // Recover it by name
    await executeCommand(['checkpoint', 'recover', 'myproject', '--name', cpName], store, logger);

    const logs = logger.getLogs();
    // Should output JSON with checkpoint info
    const payload = logs.map(l => l.message).find(m => m.includes('"name"'));
    expect(payload).toBeDefined();
    expect(payload).toContain('My goal');
    expect(payload).toContain('My pending');
    // Should NOT contain context_hits
    expect(payload).not.toContain('context_hits');
  });

  test('should show helpful error when checkpoint name is omitted', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    await executeCommand(['checkpoint', 'recover', 'myproject'], store, logger);

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('Checkpoint name is required'))).toBe(true);
    expect(logs.some(l => l.message.includes('checkpoint list'))).toBe(true);
  });

  test('should complete a checkpoint', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    // Create checkpoint
    await executeCommand(['checkpoint', 'set', 'myproject', 'Goal', 'Pending'], store, logger);
    const memories = await store.listMemories('myproject', { tag: 'checkpoint' });
    const cpName = memories[0]!.name;

    // Complete it - transforms to session memory and deletes checkpoint
    await executeCommand(
      ['checkpoint', 'complete', 'myproject', cpName, 'Fixed the bug'],
      store,
      logger
    );

    // Check the original checkpoint is deleted
    const updated = await store.getMemory('myproject', cpName);
    expect(updated).toBeNull();

    // Check session memory was created in sessions/myproject
    const sessionsMemories = await store.listMemories('sessions/myproject', {});
    expect(sessionsMemories.length).toBeGreaterThan(0);
    const sessionMem = sessionsMemories.find(m => m.tags.includes('type:session'));
    expect(sessionMem).toBeDefined();
    expect(sessionMem!.tags).toContain('cat:summary');

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('transformed into session memory'))).toBe(true);
  });

  test('should list checkpoints', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    // Create checkpoint
    await executeCommand(['checkpoint', 'set', 'myproject', 'Goal', 'Pending'], store, logger);

    // List active checkpoints
    await executeCommand(['checkpoint', 'list', 'myproject'], store, logger);

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('Checkpoints for'))).toBe(true);
    // Should show 1 active checkpoint
    expect(logs.some(l => l.message.includes('checkpoint-'))).toBe(true);
  });

  test('checkpoint_save does not create separate session space', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    await executeCommand(['checkpoint', 'set', 'myproject', 'Goal', 'Pending'], store, logger);

    // No :sessions space should exist
    expect(await store.getSpace('myproject:sessions')).toBeNull();

    // Checkpoint should be in the project space
    const memories = await store.listMemories('myproject', { tag: 'checkpoint' });
    expect(memories.length).toBe(1);
  });

  test('should create checkpoint with notes', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('myproject', 'A project', ['test']);

    await executeCommand(
      ['checkpoint', 'set', 'myproject', 'Goal', 'Pending', '--notes', 'Important context'],
      store,
      logger
    );

    const memories = await store.listMemories('myproject', { tag: 'checkpoint' });
    const mem = await store.getMemoryById(memories[0]!.id);
    const content = JSON.parse(mem!.content);

    expect(content.notes).toBe('Important context');
  });
});

describe('Command Executor — Tags', () => {
  test('should list all tags', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addSpaceTag('test', 'project');
    await store.addSpaceTag('test', 'important');

    await executeCommand(['tags'], store, logger);

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('project'))).toBe(true);
    expect(logs.some(l => l.message.includes('important'))).toBe(true);
  });

  test('should list only space tags', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addSpaceTag('test', 'project');

    await executeCommand(['tags', '--spaces'], store, logger);

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('project'))).toBe(true);
  });

  test('should list only memory tags', async () => {
    store = createTestStore();
    const logger = mockedLogger();
    await store.createSpace('test', 'Test', ['test']);
    await store.addSpaceTag('test', 'space-tag');
    const mem = await store.addMemory('test', 'mem', 'content', { tags: ['test'] });
    await store.addMemoryTag(mem.id, 'memory-tag');

    await executeCommand(['tags', '--memories'], store, logger);

    const logs = logger.getLogs();
    expect(logs.some(l => l.message.includes('memory-tag'))).toBe(true);
  });
});
