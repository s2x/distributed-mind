// ── Test helper: creates a temporary SQLite store for each test ──

import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { MindStore } from '../../src/store/mind-store';
import { createSqliteStore } from '../../src/store/sqlite-store';

let counter = 0;

export function createTestStore(): MindStore & { cleanup: () => void } {
  const dbPath = join(tmpdir(), `mind-test-${Date.now()}-${counter++}.db`);
  const store = createSqliteStore(dbPath);

  const cleanup = () => {
    store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    // WAL files
    if (existsSync(dbPath + '-wal')) unlinkSync(dbPath + '-wal');
    if (existsSync(dbPath + '-shm')) unlinkSync(dbPath + '-shm');
  };

  return Object.assign(store, { cleanup });
}
