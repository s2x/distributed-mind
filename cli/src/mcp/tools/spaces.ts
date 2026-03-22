import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const SpaceCreateSchema = z.object({
    name: z
        .string()
        .min(1)
        .describe('Space name. Use hierarchical format: projects/project-name, user/preferences, global/config.'),
    description: z.string().min(1).describe('Description of the space purpose.'),
    tags: z.array(z.string()).min(1).describe('Tags for the space. At least 1 tag required.'),
});

const SpaceListSchema = z.object({
    tag: z.string().optional().describe('Filter by tag.'),
});

const SpaceGetSchema = z.object({
    name: z.string().min(1).describe('Space name to retrieve.'),
});

const SpaceUpdateSchema = z.object({
    name: z.string().min(1).describe('Space name to update.'),
    description: z.string().optional().describe('New description.'),
    tags: z.array(z.string()).optional().describe('New tags array. Replaces all existing tags if provided.'),
});

const SpaceDeleteSchema = z.object({
    name: z.string().min(1).describe('Space name to delete.'),
});

const SPACE_TOOL_DESCRIPTIONS: Record<string, string> = {
    space_create:
        'Create a new space with required tags. Use hierarchical names: projects/<repo-name>, user/preferences, sessions/<repo-name>.',
    space_list: 'List all spaces, optionally filtered by tag. Use at session start to discover existing project spaces.',
    space_get: 'Get space details including description, tags, and hot (T1+T2) memories preview.',
    space_update: 'Update space description and/or tags. Tags array replaces existing tags if provided.',
    space_delete: 'Delete a space and ALL its memories, links, and checkpoints permanently. Cannot be undone.',
};

export function createSpaceTools(store: MindStore) {
    return {
        space_create: {
            schema: SpaceCreateSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_create,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                let parsed: z.infer<typeof SpaceCreateSchema>;

                try {
                    parsed = SpaceCreateSchema.parse(args);
                } catch (e: any) {
                    // Zod errors are in e.message as JSON string
                    const msg = e.message ?? '';
                    if (msg.includes('"code":"invalid_type"') || msg.includes('"invalid_type"')) {
                        throw new Error('tags is required');
                    }
                    if (msg.includes('"code":"too_small"') || msg.includes('"too_small"')) {
                        throw new Error('at least 1 tag');
                    }
                    throw new Error(`Invalid arguments: ${msg}`);
                }

                store.createSpace(parsed.name, parsed.description, parsed.tags);
                const space = store.getSpace(parsed.name);
                return {
                    content: [{ type: 'text', text: `Space "${parsed.name}" created successfully.` }],
                    space,
                };
            },
        },
        space_list: {
            schema: SpaceListSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_list,
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = SpaceListSchema.parse(args ?? {});
                const spaces = store.listSpaces(parsed.tag ? { tag: parsed.tag } : undefined);
                return {
                    content: [{ type: 'text', text: `Found ${spaces.length} space(s).` }],
                    spaces,
                };
            },
        },
        space_get: {
            schema: SpaceGetSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_get,
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = SpaceGetSchema.parse(args ?? {});
                if (!parsed.name) {
                    throw new Error('Space name is required.');
                }
                const space = store.getSpace(parsed.name);
                if (!space) {
                    throw new Error(`Space "${parsed.name}" does not exist.`);
                }
                const hot_memories = store.getHotMemories(parsed.name);
                return {
                    content: [{ type: 'text', text: `Space: ${space.name}` }],
                    space,
                    hot_memories,
                };
            },
        },
        space_update: {
            schema: SpaceUpdateSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_update,
            annotations: { readOnlyHint: false, destructiveHint: false },
            handler: async (args: unknown) => {
                const parsed = SpaceUpdateSchema.parse(args ?? {});
                if (!parsed.name) {
                    throw new Error('Space name is required.');
                }

                // Build updates object for description/hidden
                const updates: { description?: string; hidden?: boolean } = {};
                if (parsed.description !== undefined) {
                    updates.description = parsed.description;
                }
                store.updateSpace(parsed.name, updates);

                // Handle tags replacement if provided
                if (parsed.tags !== undefined) {
                    const currentSpace = store.getSpace(parsed.name);
                    const currentTags = currentSpace?.tags ?? [];

                    // Remove tags that are not in the new array
                    for (const tag of currentTags) {
                        if (!parsed.tags.includes(tag)) {
                            store.removeSpaceTag(parsed.name, tag);
                        }
                    }

                    // Add tags that are not in the current array
                    for (const tag of parsed.tags) {
                        if (!currentTags.includes(tag)) {
                            store.addSpaceTag(parsed.name, tag);
                        }
                    }
                }

                const space = store.getSpace(parsed.name);
                return {
                    content: [{ type: 'text', text: `Space "${parsed.name}" updated.` }],
                    space,
                };
            },
        },
        space_delete: {
            schema: SpaceDeleteSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_delete,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = SpaceDeleteSchema.parse(args ?? {});
                if (!parsed.name) {
                    throw new Error('Space name is required.');
                }
                store.deleteSpace(parsed.name);
                return {
                    content: [{ type: 'text', text: `Space "${parsed.name}" deleted.` }],
                };
            },
        },
    };
}
