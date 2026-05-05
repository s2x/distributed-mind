import type { MindStore } from '../../store/mind-store';
import { addMemoryHandler } from '../handlers/memories/add-memory';
import { deleteMemoryHandler } from '../handlers/memories/delete-memory';
import { demoteMemoryToSoftHandler } from '../handlers/memories/demote-memory-to-soft';
import { noteMemoryHandler } from '../handlers/memories/note-memory';
import { promoteMemoryToHardHandler } from '../handlers/memories/promote-memory-to-hard';
import { queryMemoriesHandler } from '../handlers/memories/query-memories';
import { readMemoryHandler, type TierChange } from '../handlers/memories/read-memory';
import { rememberMemoryHandler } from '../handlers/memories/remember-memory';
import { updateMemoryHandler } from '../handlers/memories/update-memory';
import { MemoryAddSchema } from '../schemas/memories/add-memory';
import { MemoryDeleteSchema } from '../schemas/memories/delete-memory';
import { MemoryDemoteToSoftSchema } from '../schemas/memories/memory-demote-to-soft';
import { MemoryNoteSchema } from '../schemas/memories/memory-note';
import { MemoryPromoteToHardSchema } from '../schemas/memories/memory-promote-to-hard';
import { MemoryRememberSchema } from '../schemas/memories/memory-remember';
import { MemoryQuerySchema } from '../schemas/memories/query-memories';
import { MemoryReadSchema } from '../schemas/memories/read-memory';
import { MemoryUpdateSchema } from '../schemas/memories/update-memory';
import type { ToolDefinition } from '../tool-types';

const MEMORY_TOOL_DESCRIPTIONS: Record<string, string> = {
  memory_add:
    'Add a memory to a space with tags. Use after decisions, bug fixes, discoveries, or config changes. Returns links_created and links_failed arrays.',
  memory_update:
    'Update a memory name, content, or tags. Use when memory content or metadata changes.',
  memory_delete: 'Permanently delete a memory and all its links.',
  memory_read:
    'Read a memory with links. Auto-promotes tier (T3→T2→T1) unless noPromote:true. Use when actively working with a memory.',
  memory_remember:
    "Save a memory permanently. Use when user says 'remember this', 'save this', 'don't forget this'. Creates an audit trail entry. Hard memories are exempt from LRU eviction.",
  memory_note:
    'Record an autonomous note. Use for agent-generated session summaries, observed patterns, internal bookkeeping. Soft persistence — may be evicted on conflict. Use memory_remember for user-critical info.',
  memory_promote_to_hard:
    'Promote a soft memory to hard persistence. Use when realizing a previously soft note should be permanently retained. Hard memories are exempt from LRU eviction.',
  memory_demote_to_soft:
    'Demote a hard memory to soft persistence. Makes the memory subject to LRU eviction and tier limits again.',
};

export interface MemoryTools {
  memory_add: ToolDefinition;
  memory_update: ToolDefinition;
  memory_delete: ToolDefinition;
  memory_read: ToolDefinition;
  memory_query: ToolDefinition;
  memory_remember: ToolDefinition;
  memory_note: ToolDefinition;
  memory_promote_to_hard: ToolDefinition;
  memory_demote_to_soft: ToolDefinition;
}

export function createMemoryTools(store: MindStore): MemoryTools {
  return {
    memory_add: {
      schema: MemoryAddSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_add,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: addMemoryHandler(store),
    },
    memory_update: {
      schema: MemoryUpdateSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_update,
      annotations: { readOnlyHint: false, destructiveHint: false },
      handler: updateMemoryHandler(store),
    },
    memory_delete: {
      schema: MemoryDeleteSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_delete,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: deleteMemoryHandler(store),
    },
    memory_read: {
      schema: MemoryReadSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_read,
      annotations: { readOnlyHint: false },
      handler: readMemoryHandler(store),
    },
    memory_query: {
      schema: MemoryQuerySchema,
      description:
        'Query memories by metadata, date, or full-text search (search param uses FTS5 syntax). Use space="*" for all spaces.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: queryMemoriesHandler(store),
    },
    memory_remember: {
      schema: MemoryRememberSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_remember,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: rememberMemoryHandler(store),
    },
    memory_note: {
      schema: MemoryNoteSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_note,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: noteMemoryHandler(store),
    },
    memory_promote_to_hard: {
      schema: MemoryPromoteToHardSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_promote_to_hard,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: promoteMemoryToHardHandler(store),
    },
    memory_demote_to_soft: {
      schema: MemoryDemoteToSoftSchema,
      description: MEMORY_TOOL_DESCRIPTIONS.memory_demote_to_soft,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: demoteMemoryToSoftHandler(store),
    },
  };
}

export type { TierChange };
