// ── FTS helper class for manual FTS5 sync ──
// bun:sqlite has a bug with content-sync triggers, so FTS is synced manually

import type { Database } from 'bun:sqlite';

export class FtsHelper {
  constructor(private db: Database) {}

  /**
   * Insert a memory into the FTS index.
   */
  insert(id: number, name: string, content: string): void {
    this.db.run('INSERT INTO memories_fts(rowid, name, content) VALUES (?, ?, ?)', [
      id,
      name,
      content,
    ]);
  }

  /**
   * Delete a memory from the FTS index.
   */
  delete(id: number): void {
    this.db.run('DELETE FROM memories_fts WHERE rowid = ?', [id]);
  }

  /**
   * Update a memory in the FTS index (delete + insert).
   */
  update(id: number, name: string, content: string): void {
    this.delete(id);
    this.insert(id, name, content);
  }
}
