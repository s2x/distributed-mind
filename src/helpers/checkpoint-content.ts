// ── Checkpoint content helpers ──

import type { Memory } from '../types';

/**
 * Parsed checkpoint content structure.
 */
export interface CheckpointContent {
  goal: string;
  pending: string;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Format a timestamp to match SQLite datetime format (YYYY-MM-DD HH:MM:SS).
 */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}

/**
 * Build a JSON string for checkpoint content from goal, pending, notes.
 * Used by MCP checkpoint_save and CLI checkpoint set handlers.
 */
export function buildCheckpointContent(
  goal: string,
  pending: string,
  notes?: string,
  createdAt?: string,
  updatedAt?: string
): string {
  const now = formatTimestamp(new Date());
  return JSON.stringify(
    {
      goal: goal ?? '',
      pending: pending ?? '',
      notes: notes ?? '',
      createdAt: createdAt ?? now,
      updatedAt: updatedAt ?? now,
    },
    null,
    2
  );
}

/**
 * Fetch and parse checkpoint content from a checkpoint memory object.
 * Returns null if the content cannot be parsed.
 * Used by MCP checkpoint_load and CLI checkpoint recover handlers.
 */
export function fetchCheckpointContent(checkpointMemory: Memory): CheckpointContent | null {
  try {
    const parsed = JSON.parse(checkpointMemory.content);
    return {
      goal: parsed.goal ?? '',
      pending: parsed.pending ?? '',
      notes: parsed.notes ?? '',
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    // JSON parse error — return null for graceful handling
    return null;
  }
}
