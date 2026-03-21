import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const SpaceCreateSchema = z.object({
    name: z
        .string()
        .min(1)
        .describe('Space name. Use hierarchical format: projects/project-name, user/preferences, global/config.'),
    description: z.string().min(1).describe('Description of the space purpose.'),
    tags: z.array(z.string()).optional().describe('Optional tags.'),
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
});

const SpaceRenameSchema = z.object({
    oldName: z.string().min(1).describe('Current space name.'),
    newName: z.string().min(1).describe('New space name.'),
});

const SpaceDeleteSchema = z.object({
    name: z.string().min(1).describe('Space name to delete.'),
});

const SpaceTagAddSchema = z.object({
    space: z.string().min(1).describe('Space to tag.'),
    tag: z.string().min(1).describe('Tag to add.'),
});

const SpaceTagRemoveSchema = z.object({
    space: z.string().min(1).describe('Space to untag.'),
    tag: z.string().min(1).describe('Tag to remove.'),
});

const SPACE_TOOL_DESCRIPTIONS: Record<string, string> = {
    space_create:
        'Create a new space. Required before adding memories. Use hierarchical names based on the repo/directory: projects/<repo-name>, user/preferences, sessions/<repo-name>.',
    space_list: 'List all spaces, optionally filtered by tag. Use at session start to discover existing project spaces.',
    space_get: 'Get details of a specific space by name, including description, tags, and memory count.',
    space_update: 'Update a space description.',
    space_rename: 'Rename a space. All memories and links are preserved under the new name.',
    space_delete: 'Delete a space and ALL its memories, links, and checkpoints permanently. Cannot be undone.',
    space_tag_add: 'Add a tag to a space. Use type: prefixed tags (type:project, type:user, type:session).',
    space_tag_remove: 'Remove a tag from a space.',
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
                    throw new Error(`Invalid arguments: ${e.message}. Provide: name, description, tags (optional).`);
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
                return {
                    content: [{ type: 'text', text: `Space: ${space.name}` }],
                    space,
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
                store.updateSpace(parsed.name, { description: parsed.description });
                const space = store.getSpace(parsed.name);
                return {
                    content: [{ type: 'text', text: `Space "${parsed.name}" updated.` }],
                    space,
                };
            },
        },
        space_rename: {
            schema: SpaceRenameSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_rename,
            annotations: { readOnlyHint: false, destructiveHint: false },
            handler: async (args: unknown) => {
                const parsed = SpaceRenameSchema.parse(args ?? {});
                if (!parsed.oldName || !parsed.newName) {
                    throw new Error('Both oldName and newName are required.');
                }
                store.renameSpace(parsed.oldName, parsed.newName);
                const space = store.getSpace(parsed.newName);
                return {
                    content: [{ type: 'text', text: `Space renamed from "${parsed.oldName}" to "${parsed.newName}".` }],
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
        space_tag_add: {
            schema: SpaceTagAddSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_tag_add,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = SpaceTagAddSchema.parse(args ?? {});
                if (!parsed.space || !parsed.tag) {
                    throw new Error('Both space and tag are required.');
                }
                store.addSpaceTag(parsed.space, parsed.tag);
                return {
                    content: [{ type: 'text', text: `Tag "${parsed.tag}" added to space "${parsed.space}".` }],
                };
            },
        },
        space_tag_remove: {
            schema: SpaceTagRemoveSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_tag_remove,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = SpaceTagRemoveSchema.parse(args ?? {});
                if (!parsed.space || !parsed.tag) {
                    throw new Error('Both space and tag are required.');
                }
                store.removeSpaceTag(parsed.space, parsed.tag);
                return {
                    content: [{ type: 'text', text: `Tag "${parsed.tag}" removed from space "${parsed.space}".` }],
                };
            },
        },
    };
}
