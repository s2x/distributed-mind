import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const LinkCreateSchema = z.object({
  sourceId: z.number().describe('Source memory ID'),
  targetId: z.number().describe('Target memory ID'),
  label: z.string().optional().describe('Link label (e.g., "depends-on", "fixes", "related")'),
});

const LinkDeleteSchema = z.object({
  sourceId: z.number().describe('Source memory ID'),
  targetId: z.number().describe('Target memory ID'),
});

const LinksListSchema = z.object({
  memoryId: z.number().describe('Memory ID to get links for'),
});

export function createLinkTools(store: MindStore) {
  return {
    link_create: {
      schema: LinkCreateSchema,
      handler: async (args: z.infer<typeof LinkCreateSchema>) => {
        if (args.sourceId === args.targetId) {
          throw new Error('Cannot link a memory to itself.');
        }
        
        store.link(args.sourceId, args.targetId, args.label);
        
        const sourceMemory = store.getMemoryById(args.sourceId);
        const targetMemory = store.getMemoryById(args.targetId);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Linked: "${sourceMemory?.name}" → "${targetMemory?.name}"${args.label ? ` [${args.label}]` : ''}` 
          }],
        };
      },
    },
    link_delete: {
      schema: LinkDeleteSchema,
      handler: async (args: z.infer<typeof LinkDeleteSchema>) => {
        store.unlink(args.sourceId, args.targetId);
        
        const sourceMemory = store.getMemoryById(args.sourceId);
        const targetMemory = store.getMemoryById(args.targetId);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Unlinked: "${sourceMemory?.name}" ✕ "${targetMemory?.name}"` 
          }],
        };
      },
    },
    links_list: {
      schema: LinksListSchema,
      handler: async (args: z.infer<typeof LinksListSchema>) => {
        const memory = store.getMemoryById(args.memoryId);
        if (!memory) {
          throw new Error(`Memory with ID ${args.memoryId} not found.`);
        }
        
        const links = store.getLinks(args.memoryId);
        
        return {
          content: [{ type: 'text', text: `Found ${links.length} link(s) for memory "${memory.name}".` }],
          links,
          memory,
        };
      },
    },
  };
}
