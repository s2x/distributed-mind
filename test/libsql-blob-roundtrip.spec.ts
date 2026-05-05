// ── libSQL BLOB round-trip test ──
// Verifies that Float32Array embeddings survive a full round-trip through the libSQL backend.
// libSQL returns Uint8Array for BLOB columns; the row-to-memory helper must convert correctly.

import { describe, expect, test, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

import { createLibsqlStore } from '../src/store/libsql-store';
import type { MindStore } from '../src/store/mind-store';
import { vectorToBlob, blobToVector } from '../src/helpers/rag';

let counter = 0;

async function createTestLibsqlStore(): Promise<MindStore & { cleanup: () => void }> {
  const path = `/tmp/test-libsql-blob-${Date.now()}-${counter++}.db`;
  const store = await createLibsqlStore({ url: `file:${path}`, intMode: 'number' });
  const cleanup = () => {
    store.close();
    if (existsSync(path)) unlinkSync(path);
    if (existsSync(`${path}-wal`)) unlinkSync(`${path}-wal`);
    if (existsSync(`${path}-shm`)) unlinkSync(`${path}-shm`);
  };
  return Object.assign(store, { cleanup });
}

let store: MindStore & { cleanup: () => void };

afterEach(() => {
  store?.cleanup();
});

describe('LibSQL — BLOB / embedding round-trip', () => {
  test('memory with null embedding round-trips as null', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);
    const mem = await store.addMemory('test', 'no-embed', 'content', { tags: ['test'] });

    const retrieved = await store.getMemoryById(mem.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.embedding).toBeNull();
  });

  test('vectorToBlob → blobToVector identity (unit)', () => {
    const original = new Float32Array([1.5, -2.3, 4.7, 0.0, 42.0]);
    const blob = vectorToBlob(Array.from(original));
    const restored = blobToVector(blob);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 5);
    }
  });

  test('Float32Array embedding stored as BLOB survives a libSQL round-trip', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    // Insert the memory first so we have an ID
    const mem = await store.addMemory('test', 'embed-mem', 'embedding content', { tags: ['test'] });

    // Manually write a known embedding via the raw client
    // (simulate what the RAG pipeline does)
    const originalVec = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const embeddingBlob = vectorToBlob(Array.from(originalVec));

    // Access the client through the store (cast to any for internal access)
    const internalClient = (store as any).client as import('@libsql/client').Client;
    await internalClient.execute({
      sql: 'UPDATE memories SET embedding = ? WHERE id = ?',
      args: [embeddingBlob, mem.id],
    });

    // Read back through the store
    const retrieved = await store.getMemoryById(mem.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.embedding).not.toBeNull();

    const restoredVec = retrieved!.embedding!;
    expect(restoredVec.length).toBe(originalVec.length);
    for (let i = 0; i < originalVec.length; i++) {
      expect(restoredVec[i]).toBeCloseTo(originalVec[i]!, 5);
    }
  });

  test('large Float32Array (1536 dims) round-trips correctly', async () => {
    store = await createTestLibsqlStore();
    await store.createSpace('test', 'Test', ['test']);

    const mem = await store.addMemory('test', 'large-embed', 'big embedding', { tags: ['test'] });

    // Create a 1536-dim vector (OpenAI text-embedding-3-small output size)
    const dims = 1536;
    const originalVec = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
      originalVec[i] = Math.sin(i) * 0.5;
    }
    const embeddingBlob = vectorToBlob(Array.from(originalVec));

    const internalClient = (store as any).client as import('@libsql/client').Client;
    await internalClient.execute({
      sql: 'UPDATE memories SET embedding = ? WHERE id = ?',
      args: [embeddingBlob, mem.id],
    });

    const retrieved = await store.getMemoryById(mem.id);
    expect(retrieved!.embedding).not.toBeNull();
    expect(retrieved!.embedding!.length).toBe(dims);
    for (let i = 0; i < dims; i++) {
      expect(retrieved!.embedding![i]).toBeCloseTo(originalVec[i]!, 4);
    }
  });

  test('blobToVector handles Uint8Array (bun:sqlite native return type)', () => {
    // bun:sqlite returns Uint8Array for BLOB columns
    const original = new Float32Array([3.14, -1.0, 0.001]);
    const buffer = new ArrayBuffer(original.byteLength);
    const view = new Float32Array(buffer);
    view.set(original);

    // bun:sqlite returns Uint8Array wrapping the same bytes
    const uint8 = new Uint8Array(buffer);
    const restored = blobToVector(uint8);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 5);
    }
  });

  test('blobToVector handles ArrayBuffer (libSQL @libsql/client native return type)', () => {
    // @libsql/client returns ArrayBuffer for BLOB columns (NOT Uint8Array like bun:sqlite)
    // This is a key behavioral difference between the two drivers.
    const original = new Float32Array([3.14, -1.0, 0.001]);
    const buffer = new ArrayBuffer(original.byteLength);
    const view = new Float32Array(buffer);
    view.set(original);

    // Simulate what libSQL client returns: a plain ArrayBuffer
    const restored = blobToVector(buffer);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 5);
    }
  });
});
