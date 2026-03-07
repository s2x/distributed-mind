import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const MemoryAddSchema = z.object({
  space: z.string().describe('Space name'),
  name: z.string().describe('Memory name/title'),
  content: z.string().describe('Memory content. Follow format: **What**: ... **Why**: ... **Where**: ... **Learned**: ...'),
  tags: z.array(z.string()).optional().describe('Tags following conventions: cat:decision, cat:bugfix, cat:pattern, cat:discovery, cat:preference, cat:config'),
  tier: z.number().int().min(1).max(3).optional().describe('Tier (1=hot, 2=warm default, 3=cold). T4 is auto-eviction only.'),
});

const MemoryGetSchema = z.object({
  space: z.string().describe('Space name'),
  name: z.string().describe('Memory name'),
});

const MemoryGetByIdSchema = z.object({
  id: z.number().describe('Memory ID'),
});

const MemoryListSchema = z.object({
  space: z.string().describe('Space name'),
  tier: z.number().int().min(1).max(4).optional().describe('Filter by tier (1-4)'),
  tag: z.string().optional().describe('Filter by tag'),
});

const MemoryUpdateSchema = z.object({
  id: z.number().describe('Memory ID'),
  name: z.string().optional().describe('New name (optional)'),
  content: z.string().optional().describe('New content (optional)'),
});

const MemoryDeleteSchema = z.object({
  space: z.string().describe('Space name'),
  name: z.string().describe('Memory name'),
});

const MemoryReadSchema = z.object({
  space: z.string().describe('Space name'),
  name: z.string().describe('Memory name'),
});

const MemoryTagAddSchema = z.object({
  memoryId: z.number().describe('Memory ID'),
  tag: z.string().describe('Tag to add (check existing tags first to avoid duplicates)'),
});

const MemoryTagRemoveSchema = z.object({
  memoryId: z.number().describe('Memory ID'),
  tag: z.string().describe('Tag to remove'),
});

const MemoryTagsListSchema = z.object({});

const MemoryQuerySchema = z.object({
  space: z.string().optional().describe('Filter by space name (e.g., Credentials)'),
  tag: z.string().optional().describe('Filter by tag (without #)'),
  tier: z.number().int().min(1).max(4).optional().describe('Filter by tier (1-4)'),
  from: z.string().optional().describe('Changed date lower bound (YYYY-MM-DD or ISO datetime)'),
  to: z.string().optional().describe('Changed date upper bound (YYYY-MM-DD or ISO datetime)'),
  limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
  offset: z.number().int().min(0).optional().describe('Start index (default: 0)'),
});

export function createMemoryTools(store: MindStore) {
  return {
    memory_add: {
      schema: MemoryAddSchema,
      handler: async (args: z.infer<typeof MemoryAddSchema>) => {
        const memory = await store.addMemory(args.space, args.name, args.content, {
          tags: args.tags,
          tier: args.tier as Tier | undefined,
        });
        return {
          content: [{ type: 'text', text: `Memory "${args.name}" added to space "${args.space}" (T${memory.tier}).` }],
          memory,
        };
      },
    },
    memory_get: {
      schema: MemoryGetSchema,
      handler: async (args: z.infer<typeof MemoryGetSchema>) => {
        const memory = store.getMemory(args.space, args.name);
        if (!memory) {
          throw new Error(`Memory "${args.name}" not found in space "${args.space}".`);
        }
        return {
          content: [{ type: 'text', text: `Memory: ${memory.name} (T${memory.tier})` }],
          memory,
        };
      },
    },
    memory_get_by_id: {
      schema: MemoryGetByIdSchema,
      handler: async (args: z.infer<typeof MemoryGetByIdSchema>) => {
        const memory = store.getMemoryById(args.id);
        if (!memory) {
          throw new Error(`Memory with ID ${args.id} not found.`);
        }
        return {
          content: [{ type: 'text', text: `Memory: ${memory.name} (T${memory.tier})` }],
          memory,
        };
      },
    },
    memory_list: {
      schema: MemoryListSchema,
      handler: async (args: z.infer<typeof MemoryListSchema>) => {
        const memories = store.listMemories(args.space, {
          tier: args.tier as Tier | undefined,
          tag: args.tag,
        });
        return {
          content: [{ type: 'text', text: `Found ${memories.length} memory/memories in space "${args.space}".` }],
          memories,
        };
      },
    },
    memory_update: {
      schema: MemoryUpdateSchema,
      handler: async (args: z.infer<typeof MemoryUpdateSchema>) => {
        await store.updateMemory(args.id, { name: args.name, content: args.content });
        const memory = store.getMemoryById(args.id);
        return {
          content: [{ type: 'text', text: `Memory updated successfully.` }],
          memory,
        };
      },
    },
    memory_delete: {
      schema: MemoryDeleteSchema,
      handler: async (args: z.infer<typeof MemoryDeleteSchema>) => {
        store.deleteMemoryByName(args.space, args.name);
        return {
          content: [{ type: 'text', text: `Memory "${args.name}" deleted from space "${args.space}".` }],
        };
      },
    },
    memory_read: {
      schema: MemoryReadSchema,
      handler: async (args: z.infer<typeof MemoryReadSchema>) => {
        const memory = store.getMemory(args.space, args.name);
        if (!memory) {
          throw new Error(`Memory "${args.name}" not found in space "${args.space}".`);
        }
        store.recordAccess(memory.id);
        const updatedMemory = store.getMemoryById(memory.id);
        return {
          content: [{ type: 'text', text: `Memory "${args.name}" read. Auto-promoted if applicable.` }],
          memory: updatedMemory,
        };
      },
    },
    memory_tag_add: {
      schema: MemoryTagAddSchema,
      handler: async (args: z.infer<typeof MemoryTagAddSchema>) => {
        // Get existing tags to help LLM avoid duplicates
        const allTags = store.listAllTags();
        const existingTags = allTags.memories.map(t => t.tag);
        
        store.addMemoryTag(args.memoryId, args.tag);
        const memory = store.getMemoryById(args.memoryId);
        return {
          content: [{ type: 'text', text: `Tag "${args.tag}" added to memory.` }],
          memory,
          existingTagsInSystem: existingTags,
          note: 'Check existingTagsInSystem to avoid creating duplicate tags in the future.',
        };
      },
    },
    memory_tag_remove: {
      schema: MemoryTagRemoveSchema,
      handler: async (args: z.infer<typeof MemoryTagRemoveSchema>) => {
        store.removeMemoryTag(args.memoryId, args.tag);
        const memory = store.getMemoryById(args.memoryId);
        return {
          content: [{ type: 'text', text: `Tag "${args.tag}" removed from memory.` }],
          memory,
        };
      },
    },
    memory_tags_list: {
      schema: MemoryTagsListSchema,
      handler: async () => {
        const tags = store.listAllTags();
        return {
          content: [{ type: 'text', text: `Found ${tags.spaces.length} space tags and ${tags.memories.length} memory tags.` }],
          tags,
        };
      },
    },
    memory_query: {
      schema: MemoryQuerySchema,
      handler: async (args: z.infer<typeof MemoryQuerySchema>) => {
        const limit = args.limit ?? 25;
        const offset = args.offset ?? 0;
        const memories = store.queryMemories({
          space: args.space,
          tag: args.tag,
          tier: args.tier as Tier | undefined,
          from: args.from,
          to: args.to,
          limit,
          offset,
        });

        const nextOffset = memories.length === limit ? offset + limit : null;

        return {
          content: [{
            type: 'text',
            text: `Found ${memories.length} memory result(s). Pagination: limit=${limit}, offset=${offset}, next_offset=${nextOffset ?? 'N/A'}.`,
          }],
          items: memories,
          pagination: {
            limit,
            offset,
            nextOffset,
          },
          filtersApplied: {
            space: args.space ?? null,
            tag: args.tag ?? null,
            tier: args.tier ?? null,
            from: args.from ?? null,
            to: args.to ?? null,
          },
        };
      },
    },
  };
}
