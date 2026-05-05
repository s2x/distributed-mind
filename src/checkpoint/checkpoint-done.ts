/**
 * Shared checkpoint-to-session transformation logic.
 * Used by both CLI `checkpoint complete` and MCP `checkpoint_done`.
 */

import type { MindStore } from '../store/mind-store';

function now(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}

export interface CompleteCheckpointResult {
  sessionMemory: {
    space: string;
    name: string;
    tags: string[];
  };
}

/**
 * Transforms a checkpoint into a session memory in sessions/<repo>.
 *
 * - Gets the checkpoint memory and its links
 * - Auto-creates sessions space if needed
 * - Creates session memory with copied content + summary
 * - Copies links from checkpoint to session memory
 * - Deletes the original checkpoint
 */
export async function completeCheckpoint(
  store: MindStore,
  space: string,
  checkpointMemoryId: number,
  summary: string
): Promise<CompleteCheckpointResult> {
  // Get full checkpoint memory
  const checkpointMemory = await store.getMemoryById(checkpointMemoryId);
  if (!checkpointMemory) {
    throw new Error(`Checkpoint with id ${checkpointMemoryId} could not be loaded.`);
  }

  // Parse checkpoint content
  const checkpointContent = JSON.parse(checkpointMemory.content);

  // Get links from the checkpoint (linked_memories are stored as links, not in content)
  const checkpointLinks = await store.getLinks(checkpointMemory.id);

  // Derive sessions space: "projects/mind" -> "sessions/mind"
  const sessionSpaceName = space.startsWith('projects/')
    ? `sessions/${space.slice('projects/'.length)}`
    : `sessions/${space}`;

  // Auto-create sessions space if it doesn't exist
  if (!(await store.getSpace(sessionSpaceName))) {
    try {
      await store.createSpace(sessionSpaceName, `Session summaries for ${space}`, ['type:project']);
    } catch (e: any) {
      throw new Error(`Could not create sessions space "${sessionSpaceName}": ${e.message}`);
    }
  }

  // Create session memory content
  const sessionContent = {
    ...checkpointContent,
    whatWasDone: summary,
    completedAt: now(),
    originalCheckpoint: checkpointMemory.name,
  };

  // Create session memory with name "session-{timestamp}"
  // Links will be recreated after creating the session memory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionMemory = await store.addMemory(
    sessionSpaceName,
    `session-${timestamp}`,
    JSON.stringify(sessionContent, null, 2),
    {
      tags: ['type:session', 'cat:summary'],
    }
  );

  // Recreate links from checkpoint to the session memory
  // The checkpoint had links to related memories; we copy those to the session memory
  for (const link of checkpointLinks) {
    try {
      await store.link(sessionMemory.id, link.target_id, link.label || 'related');
    } catch {
      // Ignore link errors (best-effort)
    }
  }

  // Delete the original checkpoint (not just mark complete)
  await store.deleteMemory(checkpointMemory.id);

  return {
    sessionMemory: {
      space: sessionSpaceName,
      name: sessionMemory.name,
      tags: sessionMemory.tags,
    },
  };
}
