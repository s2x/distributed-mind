import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const LinkCreateSchema = z.object({
    sourceId: z
        .number()
        .describe(
            '**Required.** Source memory ID (the "from" memory). Get ID from memory_list, memory_query, or search. Cannot link a memory to itself.'
        ),
    targetId: z
        .number()
        .describe(
            '**Required.** Target memory ID (the "to" memory). Get ID from memory_list, memory_query, or search. Cannot link to self.'
        ),
    label: z
        .string()
        .optional()
        .describe(
            'Optional. Relationship label. Common: "related" (default), "depends-on", "fixes", "blocks", "duplicates". Custom labels allowed.'
        ),
});

const LinkDeleteSchema = z.object({
    sourceId: z.number().describe('**Required.** Source memory ID of the link to remove.'),
    targetId: z.number().describe('**Required.** Target memory ID of the link to remove.'),
});

const LinksListSchema = z.object({
    memoryId: z
        .number()
        .describe(
            '**Required.** Memory ID to list links for. Returns both outgoing links (where this memory is source) and incoming links (where this memory is target).'
        ),
});

const LINK_TOOL_DESCRIPTIONS: Record<string, string> = {
    link_create: 'Create a directional link between two memories with an optional label.',
    link_delete: 'Remove a link between two memories.',
    links_list: 'List all links (incoming and outgoing) for a memory.',
};

export function createLinkTools(store: MindStore) {
    return {
        link_create: {
            schema: LinkCreateSchema,
            description: LINK_TOOL_DESCRIPTIONS.link_create,
            handler: async (args: z.infer<typeof LinkCreateSchema>) => {
                if (args.sourceId === args.targetId) {
                    throw new Error('Cannot link a memory to itself.');
                }

                store.link(args.sourceId, args.targetId, args.label);

                const sourceMemory = store.getMemoryById(args.sourceId);
                const targetMemory = store.getMemoryById(args.targetId);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Linked: "${sourceMemory?.name}" → "${targetMemory?.name}"${args.label ? ` [${args.label}]` : ''}`,
                        },
                    ],
                };
            },
        },
        link_delete: {
            schema: LinkDeleteSchema,
            description: LINK_TOOL_DESCRIPTIONS.link_delete,
            handler: async (args: z.infer<typeof LinkDeleteSchema>) => {
                store.unlink(args.sourceId, args.targetId);

                const sourceMemory = store.getMemoryById(args.sourceId);
                const targetMemory = store.getMemoryById(args.targetId);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Unlinked: "${sourceMemory?.name}" ✕ "${targetMemory?.name}"`,
                        },
                    ],
                };
            },
        },
        links_list: {
            schema: LinksListSchema,
            description: LINK_TOOL_DESCRIPTIONS.links_list,
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
