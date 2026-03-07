import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const LinkCreateSchema = z.object({
    sourceId: z.number().describe('Source memory ID.'),
    targetId: z.number().describe('Target memory ID.'),
    label: z.string().optional().describe('Optional relationship label.'),
});

const LinkDeleteSchema = z.object({
    sourceId: z.number().describe('Source memory ID of the link to remove.'),
    targetId: z.number().describe('Target memory ID of the link to remove.'),
});

const LinksListSchema = z.object({
    memoryId: z.number().describe('Memory ID to list links for.'),
});

const LINK_TOOL_DESCRIPTIONS: Record<string, string> = {
    link_create: 'Create a directional link between two memories.',
    link_delete: 'Remove a link between two memories.',
    links_list: 'List all links for a memory.',
};

export function createLinkTools(store: MindStore) {
    return {
        link_create: {
            schema: LinkCreateSchema,
            description: LINK_TOOL_DESCRIPTIONS.link_create,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = LinkCreateSchema.parse(args ?? {});
                if (!parsed.sourceId || !parsed.targetId) {
                    throw new Error('Both sourceId and targetId are required.');
                }
                if (parsed.sourceId === parsed.targetId) {
                    throw new Error('Cannot link a memory to itself.');
                }

                store.link(parsed.sourceId, parsed.targetId, parsed.label);

                const sourceMemory = store.getMemoryById(parsed.sourceId);
                const targetMemory = store.getMemoryById(parsed.targetId);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Linked: "${sourceMemory?.name}" → "${targetMemory?.name}"${parsed.label ? ` [${parsed.label}]` : ''}`,
                        },
                    ],
                };
            },
        },
        link_delete: {
            schema: LinkDeleteSchema,
            description: LINK_TOOL_DESCRIPTIONS.link_delete,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = LinkDeleteSchema.parse(args ?? {});
                if (!parsed.sourceId || !parsed.targetId) {
                    throw new Error('Both sourceId and targetId are required.');
                }
                store.unlink(parsed.sourceId, parsed.targetId);

                const sourceMemory = store.getMemoryById(parsed.sourceId);
                const targetMemory = store.getMemoryById(parsed.targetId);

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
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = LinksListSchema.parse(args ?? {});
                if (!parsed.memoryId) {
                    throw new Error('Memory ID is required.');
                }
                const memory = store.getMemoryById(parsed.memoryId);
                if (!memory) {
                    throw new Error(`Memory with ID ${parsed.memoryId} not found.`);
                }

                const links = store.getLinks(parsed.memoryId);

                return {
                    content: [{ type: 'text', text: `Found ${links.length} link(s) for memory "${memory.name}".` }],
                    links,
                    memory,
                };
            },
        },
    };
}
