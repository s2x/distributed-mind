import { z } from 'zod';

import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

import { resolveRefWithFallback } from './links';

// =============================================================================
// Schemas — Phase 2.2 Redesign
// =============================================================================

const MemoryQuerySchema = z.object({
  space: z.string().min(1).describe('Space to query. Use "*" for all spaces.'),
  search: z
    .string()
    .optional()
    .describe(
      'Search query using FTS5 syntax. When provided, performs full-text search on name and content.'
    ),
  tag: z.string().optional().describe('Filter by tag.'),
  tier: z.number().int().min(1).max(3).optional().describe('Filter by tier: 1, 2, 3.'),
  from: z.string().optional().describe('Changed date lower bound (YYYY-MM-DD).'),
  to: z.string().optional().describe('Changed date upper bound (YYYY-MM-DD).'),
  limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25).'),
  offset: z.number().int().min(0).optional().describe('Zero-based offset (default: 0).'),
});

const StatusSchema = z.object({
  space: z.string().optional().describe('Space name for space-specific status.'),
});

const MemoryAddSchema = z.object({
  space: z.string().min(1).describe('Space to add memory to. Must exist first.'),
  name: z.string().min(1).describe('Memory name/title.'),
  content: z.string().min(1).describe('Memory content.'),
  tags: z.array(z.string()).min(1).describe('Tags (at least 1 required).'),
  tier: z.number().int().min(1).max(3).optional().describe('Optional tier: 1=hot, 2=warm, 3=cold.'),
  pinned: z
    .boolean()
    .optional()
    .describe(
      'Optional pinned state. true keeps memory immune to auto-promotion and LRU eviction.'
    ),
  links_to: z
    .array(z.string())
    .optional()
    .describe(
      'References to existing memories this one relates to, in "space:name" format or bare "name" (resolves in same space). Creates directional links (new → target). Use when this memory depends on, extends, or is caused by another.'
    ),
});

const MemoryReadSchema = z.object({
  space: z.string().min(1).describe('Space containing the memory.'),
  name: z.string().min(1).describe('Memory name to read.'),
  noPromote: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, inspect the memory without side effects: no access count bump, no tier promotion. Use when browsing or checking content without intending to "use" the memory.'
    ),
});

const MemoryUpdateSchema = z.object({
  space: z.string().min(1).describe('Space containing the memory.'),
  name: z.string().min(1).describe('Current memory name to update.'),
  newName: z.string().optional().describe('New memory name (rename).'),
  content: z.string().optional().describe('New content.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('New tags array (replaces existing). Omit to keep existing tags.'),
});

const MemoryDeleteSchema = z.object({
  space: z.string().min(1).describe('Space containing the memory.'),
  name: z.string().min(1).describe('Memory name to delete.'),
});

const MEMORY_TOOL_DESCRIPTIONS: Record<string, string> = {
  memory_add:
    'Add a memory to a space with tags. Use after decisions, bug fixes, discoveries, or config changes. Returns links_created and links_failed arrays.',
  memory_update:
    'Update a memory name, content, or tags. Use when memory content or metadata changes.',
  memory_delete: 'Permanently delete a memory and all its links.',
  memory_read:
    'Read a memory with links. Auto-promotes tier (T3→T2→T1) unless noPromote:true. Use when actively working with a memory.',
};

// =============================================================================
// Helpers
// =============================================================================

/** Strip internal numeric `id` from memory objects returned to agents. */
function stripId<T extends { id?: number }>(obj: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = obj;
  return rest;
}

// =============================================================================
// TierChange type (for memory.read tier_change response)
// =============================================================================

interface TierChange {
  from: Tier;
  to: Tier;
  reason: string;
}

// =============================================================================
// Tool Handlers
// =============================================================================

export function createMemoryTools(store: MindStore) {
  return {
    memory_add: {
      schema: MemoryAddSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_add,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (args: unknown) => {
        let parsed: z.infer<typeof MemoryAddSchema>;

        try {
          parsed = MemoryAddSchema.parse(args);
        } catch (e: any) {
          // Improve error message for tags
          const msg = e.message || '';
          // Check Zod issues for tags error rather than using unassigned parsed
          const isTagsError = (e.issues || []).some((issue: { path: string[] }) =>
            issue.path.includes('tags')
          );
          if (isTagsError && msg.includes('tags')) {
            throw new Error('tags is required and must be a non-empty array');
          }
          throw new Error(
            `Invalid arguments: ${e.message}. Provide: space, name, content, tags (required, min 1), tier (optional), pinned (optional), links_to (optional, "space:name" refs).`
          );
        }

        // Resolve string refs to numeric IDs for the store (best-effort)
        // Collect successful and failed links separately
        const linksCreated: Array<{ source: string; target: string; label: string }> = [];
        const linksFailed: Array<{ ref: string; reason: string }> = [];
        let linksToIds: number[] | undefined;

        if (parsed.links_to && parsed.links_to.length > 0) {
          linksToIds = [];
          for (const ref of parsed.links_to) {
            try {
              const resolved = resolveRefWithFallback(store, ref, parsed.space);
              linksToIds.push(resolved.id);
              linksCreated.push({
                source: parsed.name,
                target: resolved.name,
                label: 'related',
              });
            } catch (e: any) {
              linksFailed.push({
                ref,
                reason: e.message || 'unknown error',
              });
            }
          }
        }

        const memory = await store.addMemory(parsed.space, parsed.name, parsed.content, {
          tags: parsed.tags,
          tier: parsed.tier as Tier | undefined,
          pinned: parsed.pinned,
          linksToIds: linksToIds && linksToIds.length > 0 ? linksToIds : undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Memory "${parsed.name}" added to space "${parsed.space}" (T${memory.tier}).`,
            },
          ],
          memory: stripId(memory),
          links_created: linksCreated,
          links_failed: linksFailed,
        };
      },
    },

    memory_update: {
      schema: MemoryUpdateSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_update,
      annotations: { readOnlyHint: false, destructiveHint: false },
      handler: async (args: unknown) => {
        const parsed = MemoryUpdateSchema.parse(args ?? {});
        if (!parsed.space || !parsed.name) {
          throw new Error('Both space and name are required.');
        }

        // Validate memory exists
        const existing = store.getMemory(parsed.space, parsed.name);
        if (!existing) {
          throw new Error(`Memory "${parsed.name}" not found in space "${parsed.space}".`);
        }

        // Update name (rename) and/or content if provided
        if (parsed.newName !== undefined || parsed.content !== undefined) {
          await store.updateMemory(existing.id, {
            name: parsed.newName,
            content: parsed.content,
          });
        }

        // Replace tags if provided (per task: tags replaces entire array)
        if (parsed.tags !== undefined) {
          store.setMemoryTags(existing.id, parsed.tags);
        }

        const memory = store.getMemoryById(existing.id);
        return {
          content: [{ type: 'text', text: `Memory updated successfully.` }],
          memory: memory ? stripId(memory) : undefined,
        };
      },
    },

    memory_delete: {
      schema: MemoryDeleteSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_delete,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async (args: unknown) => {
        const parsed = MemoryDeleteSchema.parse(args ?? {});
        if (!parsed.space || !parsed.name) {
          throw new Error('Both space and memory name are required.');
        }
        store.deleteMemoryByName(parsed.space, parsed.name);
        return {
          content: [
            { type: 'text', text: `Memory "${parsed.name}" deleted from space "${parsed.space}".` },
          ],
        };
      },
    },

    memory_read: {
      schema: MemoryReadSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_read,
      annotations: { readOnlyHint: false },
      handler: async (args: unknown) => {
        const parsed = MemoryReadSchema.parse(args ?? {});
        if (!parsed.space || !parsed.name) {
          throw new Error('Both space and memory name are required.');
        }
        const memory = store.getMemory(parsed.space, parsed.name);
        if (!memory) {
          throw new Error(`Memory "${parsed.name}" not found in space "${parsed.space}".`);
        }

        // noPromote: true means read without side effects (like the old memory_get)
        if (parsed.noPromote) {
          // Get linked memory summaries
          const linkedSummaries = store.getLinkedMemorySummaries(memory.id);

          const links_to = linkedSummaries.links_to.map(l => ({
            name: l.name,
            space: l.space_name,
            ref: `${l.space_name}:${l.name}`,
            tier: l.tier,
            tags: l.tags,
            pinned: l.pinned,
            changed_at: l.changed_at,
          }));

          const linked_by = linkedSummaries.linked_by.map(l => ({
            name: l.name,
            space: l.space_name,
            ref: `${l.space_name}:${l.name}`,
            tier: l.tier,
            tags: l.tags,
            pinned: l.pinned,
            changed_at: l.changed_at,
          }));

          return {
            content: [{ type: 'text', text: `Memory "${parsed.name}" read (no promotion).` }],
            memory: stripId(memory),
            links_to,
            linked_by,
            tier_change: null,
          };
        }

        // Capture tier BEFORE recordAccess for tier_change calculation
        const fromTier = memory.tier;
        const wasPinned = memory.pinned;

        // Record access (bumps count, updates last_accessed_at, auto-promotes if not pinned)
        store.recordAccess(memory.id);

        // Get updated memory after recordAccess
        const updatedMemory = store.getMemoryById(memory.id);
        const toTier = updatedMemory?.tier ?? fromTier;

        // Calculate tier_change
        let tier_change: TierChange;
        if (wasPinned) {
          tier_change = {
            from: fromTier,
            to: fromTier,
            reason: 'pinned - promotion skipped',
          };
        } else if (fromTier === 1) {
          tier_change = {
            from: 1,
            to: 1,
            reason: 'already at T1',
          };
        } else if (fromTier === toTier) {
          // Tier didn't change (maybe destination was full and all pinned)
          tier_change = {
            from: fromTier,
            to: toTier,
            reason: 'destination full - promotion skipped',
          };
        } else {
          tier_change = {
            from: fromTier,
            to: toTier,
            reason: 'auto-promote on read',
          };
        }

        // Get linked memory summaries
        const linkedSummaries = store.getLinkedMemorySummaries(memory.id);

        const links_to = linkedSummaries.links_to.map(l => ({
          name: l.name,
          space: l.space_name,
          ref: `${l.space_name}:${l.name}`,
          tier: l.tier,
          tags: l.tags,
          pinned: l.pinned,
          changed_at: l.changed_at,
        }));

        const linked_by = linkedSummaries.linked_by.map(l => ({
          name: l.name,
          space: l.space_name,
          ref: `${l.space_name}:${l.name}`,
          tier: l.tier,
          tags: l.tags,
          pinned: l.pinned,
          changed_at: l.changed_at,
        }));

        return {
          content: [
            { type: 'text', text: `Memory "${parsed.name}" read. Auto-promoted if applicable.` },
          ],
          memory: updatedMemory ? stripId(updatedMemory) : undefined,
          links_to,
          linked_by,
          tier_change,
        };
      },
    },

    memory_query: {
      schema: MemoryQuerySchema,
      description:
        'Query memories by metadata, date, or full-text search (search param uses FTS5 syntax). Use space="*" for all spaces.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args: unknown) => {
        let parsed;
        try {
          parsed = MemoryQuerySchema.parse(args ?? {});
        } catch (e: any) {
          if (e.issues?.length) {
            const spaceError = e.issues.find((err: any) => err.path?.includes('space'));
            if (spaceError) {
              throw new Error('space is required');
            }
          }
          throw e;
        }

        const spaceFilter = parsed.space === '*' ? undefined : parsed.space;

        let memories: any[];
        let totalCount: number;
        let search_method: string | undefined;

        if (parsed.search) {
          const searchResult = await store.searchFallback(parsed.search, {
            space: spaceFilter,
            tag: parsed.tag,
            tier: parsed.tier as Tier | undefined,
          });

          let filteredResults = searchResult.results;
          if (parsed.from) {
            const fromDate = new Date(parsed.from);
            filteredResults = filteredResults.filter(m => new Date(m.changed_at) >= fromDate);
          }
          if (parsed.to) {
            const toDate = new Date(parsed.to);
            toDate.setHours(23, 59, 59, 999);
            filteredResults = filteredResults.filter(m => new Date(m.changed_at) <= toDate);
          }

          totalCount = filteredResults.length;
          search_method = searchResult.search_method;

          const offset = parsed.offset ?? 0;
          const limit = parsed.limit ?? 25;
          memories = filteredResults.slice(offset, offset + limit);
        } else {
          memories = store.queryMemories({
            space: spaceFilter,
            tag: parsed.tag,
            tier: parsed.tier as Tier | undefined,
            from: parsed.from,
            to: parsed.to,
            limit: parsed.limit ?? 25,
            offset: parsed.offset ?? 0,
          });

          totalCount = await store.queryMemoriesCount({
            space: spaceFilter,
            tag: parsed.tag,
            tier: parsed.tier as Tier | undefined,
            from: parsed.from,
            to: parsed.to,
          });
        }

        const response: any = {
          content: [
            {
              type: 'text',
              text: `Found ${memories.length} memory/memories (total: ${totalCount}).`,
            },
          ],
          memories: memories.map(
            ({ id: _id, content: _c, rank: _r, similarity: _s, ...rest }: any) => rest
          ),
          total: totalCount,
          limit: parsed.limit ?? 25,
          offset: parsed.offset ?? 0,
        };

        if (search_method) {
          response.search_method = search_method;
        }

        return response;
      },
    },
  };
}

// =============================================================================
// Re-export types for convenience (used by MCP server)
// =============================================================================

export type { TierChange };
