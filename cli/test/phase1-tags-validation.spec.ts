import { describe, expect, test, afterEach } from 'bun:test';
import { createTestStore } from './mocks/test-store';
import type { MindStore } from '../src/store/mind-store';

let store: MindStore & { cleanup: () => void };

afterEach(() => {
    store?.cleanup();
});

describe('Phase 1.4 — Tags validation: createSpace', () => {
    test('createSpace without tags should throw error', () => {
        store = createTestStore();

        expect(() => (store as any).createSpace('test', 'Test space'))
            .toThrow(/tags? (is|are) required|empty|not provided/i);
    });

    test('createSpace with empty array of tags should throw error', () => {
        store = createTestStore();

        expect(() => (store as any).createSpace('test', 'Test space', []))
            .toThrow(/tags? (is|are) required|empty|not provided/i);
    });
});

describe('Phase 1.4 — Tags validation: addMemory', () => {
    test('addMemory without tags option should throw error', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['project']);

        await expect((store as any).addMemory('test', 'mem1', 'content'))
            .rejects.toThrow(/tags? (is|are) required|empty|not provided/i);
    });

    test('addMemory with empty tags array should throw error', async () => {
        store = createTestStore();
        store.createSpace('test', 'Test space', ['project']);

        await expect(
            (store as any).addMemory('test', 'mem1', 'content', { tags: [] })
        ).rejects.toThrow(/tags? (is|are) required|empty|not provided/i);
    });
});
