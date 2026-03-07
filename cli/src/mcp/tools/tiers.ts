import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const MemoryPromoteSchema = z.object({
  id: z.number().describe('Memory ID'),
});

const MemoryDemoteSchema = z.object({
  id: z.number().describe('Memory ID'),
});

const MemoryPinSchema = z.object({
  id: z.number().describe('Memory ID'),
});

const MemoryUnpinSchema = z.object({
  id: z.number().describe('Memory ID'),
});

export function createTierTools(store: MindStore) {
  return {
    memory_promote: {
      schema: MemoryPromoteSchema,
      handler: async (args: z.infer<typeof MemoryPromoteSchema>) => {
        const memoryBefore = store.getMemoryById(args.id);
        if (!memoryBefore) {
          throw new Error(`Memory with ID ${args.id} not found.`);
        }
        if (memoryBefore.tier === 1) {
          throw new Error('Cannot promote: memory is already at T1 (hot).');
        }
        
        store.promote(args.id);
        const memory = store.getMemoryById(args.id);
        return {
          content: [{ type: 'text', text: `Memory "${memory.name}" promoted from T${memoryBefore.tier} to T${memory.tier}.` }],
          memory,
        };
      },
    },
    memory_demote: {
      schema: MemoryDemoteSchema,
      handler: async (args: z.infer<typeof MemoryDemoteSchema>) => {
        const memoryBefore = store.getMemoryById(args.id);
        if (!memoryBefore) {
          throw new Error(`Memory with ID ${args.id} not found.`);
        }
        if (memoryBefore.tier === 4) {
          throw new Error('Cannot demote: memory is already at T4 (frozen).');
        }
        
        store.demote(args.id);
        const memory = store.getMemoryById(args.id);
        return {
          content: [{ type: 'text', text: `Memory "${memory.name}" demoted from T${memoryBefore.tier} to T${memory.tier}.` }],
          memory,
        };
      },
    },
    memory_pin: {
      schema: MemoryPinSchema,
      handler: async (args: z.infer<typeof MemoryPinSchema>) => {
        store.pin(args.id);
        const memory = store.getMemoryById(args.id);
        if (!memory) {
          throw new Error(`Memory with ID ${args.id} not found.`);
        }
        return {
          content: [{ type: 'text', text: `Memory "${memory.name}" pinned. It will not be auto-promoted or evicted.` }],
          memory,
        };
      },
    },
    memory_unpin: {
      schema: MemoryUnpinSchema,
      handler: async (args: z.infer<typeof MemoryUnpinSchema>) => {
        store.unpin(args.id);
        const memory = store.getMemoryById(args.id);
        if (!memory) {
          throw new Error(`Memory with ID ${args.id} not found.`);
        }
        return {
          content: [{ type: 'text', text: `Memory "${memory.name}" unpinned.` }],
          memory,
        };
      },
    },
  };
}
