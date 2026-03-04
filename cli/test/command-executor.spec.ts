import { describe, expect, test, afterEach } from 'bun:test';
import { executeCommand } from '../src/command-executor';
import { createTestStore } from './mocks/test-store';
import { mockedLogger } from './mocks/mocked-logger';
import type { MindStore } from '../src/store/mind-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

describe('Command Executor — Basics', () => {
    test('should show help', () => {
        store = createTestStore();
        const logger = mockedLogger();
        executeCommand(['help'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('mind'))).toBe(true);
    });

    test('should throw for empty args', () => {
        store = createTestStore();
        const logger = mockedLogger();
        expect(() => executeCommand([], store, logger)).toThrow('No arguments provided');
    });

    test('should throw for unknown command', () => {
        store = createTestStore();
        const logger = mockedLogger();
        expect(() => executeCommand(['banana'], store, logger)).toThrow('Unknown command');
    });
});

describe('Command Executor — Spaces', () => {
    test('should create a space', () => {
        store = createTestStore();
        const logger = mockedLogger();
        executeCommand(['create', 'test-space', 'A test space'], store, logger);

        const space = store.getSpace('test-space');
        expect(space).not.toBeNull();
        expect(space!.description).toBe('A test space');
        expect(logger.getLogs().some((l) => l.message.includes('created'))).toBe(true);
    });

    test('should create a space with tags', () => {
        store = createTestStore();
        const logger = mockedLogger();
        executeCommand(['create', 'test-space', 'A test space', '--tags', 'project,dev'], store, logger);

        const space = store.getSpace('test-space');
        expect(space!.tags).toContain('project');
        expect(space!.tags).toContain('dev');
    });

    test('should list spaces', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('space1', 'Space 1');
        store.createSpace('space2', 'Space 2');

        executeCommand(['list'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('space1'))).toBe(true);
        expect(logs.some((l) => l.message.includes('space2'))).toBe(true);
    });

    test('should delete a space', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        executeCommand(['delete', 'test'], store, logger);
        expect(store.getSpace('test')).toBeNull();
    });

    test('should rename a space', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('old', 'Old');
        executeCommand(['rename', 'old', 'new'], store, logger);
        expect(store.getSpace('old')).toBeNull();
        expect(store.getSpace('new')).not.toBeNull();
    });

    test('should describe a space', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Old desc');
        executeCommand(['describe', 'test', 'New desc'], store, logger);
        expect(store.getSpace('test')!.description).toBe('New desc');
    });

    test('should tag and untag a space', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');

        executeCommand(['tag', 'test', 'project'], store, logger);
        expect(store.getSpace('test')!.tags).toContain('project');

        executeCommand(['untag', 'test', 'project'], store, logger);
        expect(store.getSpace('test')!.tags).not.toContain('project');
    });
});

describe('Command Executor — Memories', () => {
    test('should add a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        executeCommand(['add', 'test', 'auth', 'JWT auth flow'], store, logger);

        const mem = store.getMemory('test', 'auth');
        expect(mem).not.toBeNull();
        expect(mem!.content).toBe('JWT auth flow');
    });

    test('should add a memory with tags and tier', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        executeCommand(['add', 'test', 'auth', 'JWT auth', '--tags', 'backend,security', '--tier', '1'], store, logger);

        const mem = store.getMemory('test', 'auth');
        expect(mem!.tier).toBe(1);
        expect(mem!.tags).toContain('backend');
    });

    test('should read a memory and record access', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'JWT auth');

        executeCommand(['read', 'test', 'auth'], store, logger);

        const mem = store.getMemory('test', 'auth');
        expect(mem!.access_count).toBe(1);
        expect(logger.getLogs().some((l) => l.message.includes('auth'))).toBe(true);
    });

    test('should edit a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'Old content');

        executeCommand(['edit', 'test', 'auth', 'New content'], store, logger);
        expect(store.getMemory('test', 'auth')!.content).toBe('New content');
    });

    test('should remove a memory by name', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'content');

        executeCommand(['remove', 'test', 'auth'], store, logger);
        expect(store.getMemory('test', 'auth')).toBeNull();
    });

    test('should list memories of a space', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content', { tier: 1 });
        store.addMemory('test', 'mem2', 'content', { tier: 2 });

        executeCommand(['list', 'test'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('mem1'))).toBe(true);
        expect(logs.some((l) => l.message.includes('mem2'))).toBe(true);
    });

    test('should tag and untag a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'content');

        executeCommand(['tag', 'test', 'auth', 'important'], store, logger);
        expect(store.getMemory('test', 'auth')!.tags).toContain('important');

        executeCommand(['untag', 'test', 'auth', 'important'], store, logger);
        expect(store.getMemory('test', 'auth')!.tags).not.toContain('important');
    });
});

describe('Command Executor — Tiers', () => {
    test('should promote a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem', 'content', { tier: 3 });

        executeCommand(['promote', 'test', 'mem'], store, logger);
        expect(store.getMemory('test', 'mem')!.tier).toBe(2);
    });

    test('should demote a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem', 'content', { tier: 1 });

        executeCommand(['demote', 'test', 'mem'], store, logger);
        expect(store.getMemory('test', 'mem')!.tier).toBe(2);
    });

    test('should pin a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem', 'content');

        executeCommand(['pin', 'test', 'mem'], store, logger);
        expect(store.getMemory('test', 'mem')!.pinned).toBe(true);
    });

    test('should unpin a memory', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        const mem = store.addMemory('test', 'mem', 'content');
        store.pin(mem.id);

        executeCommand(['unpin', 'test', 'mem'], store, logger);
        expect(store.getMemory('test', 'mem')!.pinned).toBe(false);
    });
});

describe('Command Executor — Links', () => {
    test('should link two memories', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem1', 'content');
        store.addMemory('test', 'mem2', 'content');

        executeCommand(['link', 'test/mem1', 'test/mem2', '--label', 'depends-on'], store, logger);

        const mem1 = store.getMemory('test', 'mem1');
        const links = store.getLinks(mem1!.id);
        expect(links.length).toBe(1);
        expect(links[0]!.label).toBe('depends-on');
    });

    test('should show links', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        const mem1 = store.addMemory('test', 'mem1', 'content');
        const mem2 = store.addMemory('test', 'mem2', 'content');
        store.link(mem1.id, mem2.id, 'related');

        executeCommand(['links', 'test', 'mem1'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('mem2'))).toBe(true);
    });

    test('should unlink memories', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        const mem1 = store.addMemory('test', 'mem1', 'content');
        const mem2 = store.addMemory('test', 'mem2', 'content');
        store.link(mem1.id, mem2.id);

        executeCommand(['unlink', 'test/mem1', 'test/mem2'], store, logger);
        const links = store.getLinks(mem1.id);
        expect(links.length).toBe(0);
    });
});

describe('Command Executor — Search', () => {
    test('should search memories', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'JWT authentication with refresh tokens');
        store.addMemory('test', 'db', 'PostgreSQL database schema');

        executeCommand(['search', 'authentication'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('auth'))).toBe(true);
        expect(logs.some((l) => l.message.includes('db'))).toBe(false);
    });

    test('should not show content by default', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'JWT authentication with refresh tokens');

        executeCommand(['search', 'authentication'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('JWT'))).toBe(false);
    });

    test('should show content with --detail', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'JWT authentication with refresh tokens');

        executeCommand(['search', 'authentication', '--detail'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('JWT'))).toBe(true);
    });

    test('should support prefix wildcard search', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'auth', 'JWT authentication with refresh tokens');

        executeCommand(['search', 'auth*'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('auth'))).toBe(true);
    });

    test('should search with space filter', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('proj-a', 'A');
        store.createSpace('proj-b', 'B');
        store.addMemory('proj-a', 'auth', 'authentication');
        store.addMemory('proj-b', 'auth', 'authentication');

        executeCommand(['search', 'authentication', '--space', 'proj-a'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('proj-a'))).toBe(true);
    });
});

describe('Command Executor — Guide', () => {
    test('should show agent guide', () => {
        store = createTestStore();
        const logger = mockedLogger();
        executeCommand(['guide', 'agent'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('Agent Guide'))).toBe(true);
    });

    test('should show human guide', () => {
        store = createTestStore();
        const logger = mockedLogger();
        executeCommand(['guide'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('User Guide'))).toBe(true);
    });
});

describe('Command Executor — Maintenance', () => {
    test('should run tidy', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem', 'content');

        executeCommand(['tidy'], store, logger);
        // Should not crash
        const logs = logger.getLogs();
        expect(logs.length).toBeGreaterThan(0);
    });

    test('should run stats', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');
        store.addMemory('test', 'mem', 'content');

        executeCommand(['stats'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('Stats'))).toBe(true);
    });

    test('should run gc', () => {
        store = createTestStore();
        const logger = mockedLogger();
        store.createSpace('test', 'Test');

        executeCommand(['gc'], store, logger);
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message.includes('Nothing to clean up') || l.message.includes('Removed'))).toBe(
            true
        );
    });
});
