import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const CheckpointSetSchema = z.object({
  space: z.string().describe('Working space name (e.g., "my-project")'),
  goal: z.string().describe('What you are working on'),
  pending: z.string().describe('What remains to be done'),
  notes: z.string().optional().describe('Additional notes'),
  relatedMemoryIds: z.array(z.number()).optional().describe('IDs of relevant memories to link'),
});

const CheckpointCompleteSchema = z.object({
  space: z.string().describe('Working space name'),
  checkpointId: z.number().describe('ID of the checkpoint to complete'),
  whatWasDone: z.string().describe('Summary of what was accomplished'),
});

const CheckpointRecoverSchema = z.object({
  space: z.string().describe('Working space name'),
  includeHistory: z.boolean().optional().describe('Include completed checkpoints in results'),
});

const CheckpointListSchema = z.object({
  space: z.string().describe('Working space name'),
  status: z.enum(['active', 'completed', 'all']).optional().describe('Filter by status'),
});

function getCheckpointSpaceName(space: string): string {
  return `${space}:sessions`;
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}

export function createCheckpointTools(store: MindStore) {
  return {
    checkpoint_set: {
      schema: CheckpointSetSchema,
      handler: async (args: z.infer<typeof CheckpointSetSchema>) => {
        const checkpointSpace = getCheckpointSpaceName(args.space);
        
        // Create hidden checkpoint space if it doesn't exist
        const existingSpace = store.getSpace(checkpointSpace);
        if (!existingSpace) {
          store.createSpace(checkpointSpace, `Checkpoints for ${args.space}`, ['checkpoint', 'system']);
          store.updateSpace(checkpointSpace, { hidden: true });
        }

        // Build checkpoint content as JSON
        const content = JSON.stringify({
          goal: args.goal,
          pending: args.pending,
          notes: args.notes || '',
          createdAt: now(),
          updatedAt: now(),
        }, null, 2);

        // Check if there's already an active checkpoint
        const existingCheckpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });
        const activeCheckpoint = existingCheckpoints.find(m => m.tags.includes('active'));

        let checkpoint;
        if (activeCheckpoint) {
          // Update existing active checkpoint
          const memory = store.getMemoryById(activeCheckpoint.id);
          if (memory) {
            // Update content
            const existingContent = JSON.parse(memory.content);
            existingContent.goal = args.goal;
            existingContent.pending = args.pending;
            existingContent.notes = args.notes || '';
            existingContent.updatedAt = now();
            
            await store.updateMemory(activeCheckpoint.id, { 
              content: JSON.stringify(existingContent, null, 2) 
            });
            checkpoint = store.getMemoryById(activeCheckpoint.id);
          }
        } else {
          // Create new checkpoint
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          checkpoint = await store.addMemory(
            checkpointSpace,
            `checkpoint-${timestamp}`,
            content,
            { tags: ['checkpoint', 'active'], tier: 1 as Tier }
          );
        }

        // Link to relevant memories if provided
        if (args.relatedMemoryIds && args.relatedMemoryIds.length > 0 && checkpoint) {
          for (const memoryId of args.relatedMemoryIds) {
            try {
              store.link(checkpoint.id, memoryId, 'related');
            } catch {
              // Link might already exist or memory might not exist, ignore
            }
          }
        }

        return {
          content: [{ 
            type: 'text', 
            text: `Checkpoint ${activeCheckpoint ? 'updated' : 'created'} in "${checkpointSpace}".` 
          }],
          checkpoint: checkpoint ? {
            id: checkpoint.id,
            space: checkpointSpace,
            name: checkpoint.name,
            tier: checkpoint.tier,
            tags: checkpoint.tags,
          } : undefined,
        };
      },
    },

    checkpoint_complete: {
      schema: CheckpointCompleteSchema,
      handler: async (args: z.infer<typeof CheckpointCompleteSchema>) => {
        const checkpointSpace = getCheckpointSpaceName(args.space);
        const memory = store.getMemoryById(args.checkpointId);
        
        if (!memory) {
          throw new Error(`Checkpoint with id ${args.checkpointId} not found.`);
        }

        if (memory.space_name !== checkpointSpace) {
          throw new Error(`Checkpoint ${args.checkpointId} does not belong to space "${checkpointSpace}".`);
        }

        // Update content with what was done
        const existingContent = JSON.parse(memory.content);
        existingContent.whatWasDone = args.whatWasDone;
        existingContent.completedAt = now();
        existingContent.updatedAt = now();

        await store.updateMemory(args.checkpointId, {
          content: JSON.stringify(existingContent, null, 2),
        });

        // Update tags: remove 'active', add 'completed'
        store.removeMemoryTag(args.checkpointId, 'active');
        store.addMemoryTag(args.checkpointId, 'completed');

        // Demote to T2 (warm)
        try {
          store.demote(args.checkpointId);
        } catch {
          // Might be at T1 already or at max capacity, ignore
        }

        const updatedMemory = store.getMemoryById(args.checkpointId);

        return {
          content: [{ 
            type: 'text', 
            text: `Checkpoint marked as completed and demoted to warm tier.` 
          }],
          checkpoint: updatedMemory ? {
            id: updatedMemory.id,
            space: updatedMemory.space_name,
            name: updatedMemory.name,
            tier: updatedMemory.tier,
            tags: updatedMemory.tags,
          } : undefined,
        };
      },
    },

    checkpoint_recover: {
      schema: CheckpointRecoverSchema,
      handler: async (args: z.infer<typeof CheckpointRecoverSchema>) => {
        const checkpointSpace = getCheckpointSpaceName(args.space);
        
        // Check if checkpoint space exists
        const space = store.getSpace(checkpointSpace);
        if (!space) {
          return {
            content: [{ type: 'text', text: `No checkpoint space found for "${args.space}".` }],
            checkpoint: null,
          };
        }

        // Get active checkpoints
        const allCheckpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });
        
        // Filter by status
        let activeCheckpoints = allCheckpoints.filter(m => m.tags.includes('active'));
        
        if (args.includeHistory) {
          const completedCheckpoints = allCheckpoints.filter(m => m.tags.includes('completed'));
          activeCheckpoints = [...activeCheckpoints, ...completedCheckpoints];
        }

        // Sort by updated_at descending
        activeCheckpoints.sort((a, b) => 
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

        if (activeCheckpoints.length === 0) {
          return {
            content: [{ type: 'text', text: `No active checkpoints found.` }],
            checkpoint: null,
          };
        }

        // Get the most recent active checkpoint
        const latest = activeCheckpoints[0]!;
        const fullMemory = store.getMemoryById(latest.id);
        
        if (!fullMemory) {
          return {
            content: [{ type: 'text', text: `Checkpoint memory not found.` }],
            checkpoint: null,
          };
        }

        // Get links
        const links = store.getLinks(latest.id);

        // Parse content
        let content;
        try {
          content = JSON.parse(fullMemory.content);
        } catch {
          content = { raw: fullMemory.content };
        }

        return {
          content: [{ 
            type: 'text', 
            text: `Found active checkpoint: "${latest.name}".` 
          }],
          checkpoint: {
            id: fullMemory.id,
            space: fullMemory.space_name,
            name: fullMemory.name,
            tier: fullMemory.tier,
            tags: fullMemory.tags,
            content,
            links: links.map(l => ({
              targetId: l.target_id,
              targetName: l.target_name,
              targetSpace: l.target_space,
              label: l.label,
            })),
          },
          note: 'Use checkpoint_list to see other checkpoints if needed.',
        };
      },
    },

    checkpoint_list: {
      schema: CheckpointListSchema,
      handler: async (args: z.infer<typeof CheckpointListSchema>) => {
        const checkpointSpace = getCheckpointSpaceName(args.space);
        
        // Check if checkpoint space exists
        const space = store.getSpace(checkpointSpace);
        if (!space) {
          return {
            content: [{ type: 'text', text: `No checkpoint space found for "${args.space}".` }],
            checkpoints: [],
          };
        }

        // Get all checkpoints
        let checkpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });

        // Filter by status if specified
        if (args.status && args.status !== 'all') {
          checkpoints = checkpoints.filter(m => m.tags.includes(args.status!));
        }

        // Sort by updated_at descending
        checkpoints.sort((a, b) => 
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

        return {
          content: [{ 
            type: 'text', 
            text: `Found ${checkpoints.length} checkpoint(s).` 
          }],
          checkpoints: checkpoints.map(m => ({
            id: m.id,
            name: m.name,
            tier: m.tier,
            tags: m.tags,
            updatedAt: m.updated_at,
          })),
        };
      },
    },
  };
}
