import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const SpaceCreateSchema = z.object({
    name: z
        .string()
        .describe(
            '**Required.** Space name. Use hierarchical format: projects/project-name, user/preferences, global/config, sessions/project-name. See system_instructions for conventions.'
        ),
    description: z
        .string()
        .describe('Description of the space purpose. Example: "Project-specific decisions and patterns".'),
    tags: z
        .array(z.string())
        .optional()
        .describe(
            'Optional tags. Recommended: type:project, type:user, type:config, type:learning, type:session. List existing tags first to avoid duplicates.'
        ),
});

const SpaceListSchema = z.object({
    tag: z.string().optional().describe('Filter by tag. Example: "type:project" to list all project spaces.'),
});

const SpaceGetSchema = z.object({
    name: z
        .string()
        .describe('**Required.** Space name to retrieve. Must exist — create with space_create first if needed.'),
});

const SpaceUpdateSchema = z.object({
    name: z.string().describe('**Required.** Space name to update. Must exist.'),
    description: z.string().describe('New description. Provides full text — it replaces the existing description.'),
});

const SpaceRenameSchema = z.object({
    oldName: z
        .string()
        .describe(
            '**Required.** Current space name. Must exist. Note: All memories in this space will move to the new name.'
        ),
    newName: z
        .string()
        .describe('**Required.** New space name. Must not already exist. Use same hierarchical format as oldName.'),
});

const SpaceDeleteSchema = z.object({
    name: z
        .string()
        .describe(
            '**Required.** Space name to delete. This is PERMANENT — all memories in the space will be deleted. There is no undo.'
        ),
});

const SpaceTagAddSchema = z.object({
    space: z.string().describe('**Required.** Space to tag. Must exist.'),
    tag: z
        .string()
        .describe(
            '**Required.** Tag to add. List existing tags first with memory_tags_list to avoid duplicates. Recommended: type:project, type:user, cat:decision, cat:bugfix, cat:pattern, cat:discovery, cat:preference, cat:config.'
        ),
});

const SpaceTagRemoveSchema = z.object({
    space: z.string().describe('**Required.** Space to untag. Must exist.'),
    tag: z.string().describe('**Required.** Tag to remove from the space.'),
});

const SPACE_TOOL_DESCRIPTIONS: Record<string, string> = {
    space_create: 'Create a new space with hierarchical naming (e.g., projects/name, user/preferences).',
    space_list: 'List all spaces, optionally filtered by tag.',
    space_get: 'Get details of a specific space by name.',
    space_update: 'Update a space description.',
    space_rename: 'Rename a space. All memories move to the new name.',
    space_delete: 'Delete a space and ALL its memories PERMANENTLY.',
    space_tag_add: 'Add a tag to a space.',
    space_tag_remove: 'Remove a tag from a space.',
};

export function createSpaceTools(store: MindStore) {
    return {
        space_create: {
            schema: SpaceCreateSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_create,
            handler: async (args: z.infer<typeof SpaceCreateSchema>) => {
                store.createSpace(args.name, args.description, args.tags);
                const space = store.getSpace(args.name);
                return {
                    content: [{ type: 'text', text: `Space "${args.name}" created successfully.` }],
                    space,
                };
            },
        },
        space_list: {
            schema: SpaceListSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_list,
            handler: async (args: z.infer<typeof SpaceListSchema>) => {
                const spaces = store.listSpaces(args.tag ? { tag: args.tag } : undefined);
                return {
                    content: [{ type: 'text', text: `Found ${spaces.length} space(s).` }],
                    spaces,
                };
            },
        },
        space_get: {
            schema: SpaceGetSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_get,
            handler: async (args: z.infer<typeof SpaceGetSchema>) => {
                const space = store.getSpace(args.name);
                if (!space) {
                    throw new Error(`Space "${args.name}" does not exist.`);
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
            handler: async (args: z.infer<typeof SpaceUpdateSchema>) => {
                store.updateSpace(args.name, { description: args.description });
                const space = store.getSpace(args.name);
                return {
                    content: [{ type: 'text', text: `Space "${args.name}" updated.` }],
                    space,
                };
            },
        },
        space_rename: {
            schema: SpaceRenameSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_rename,
            handler: async (args: z.infer<typeof SpaceRenameSchema>) => {
                store.renameSpace(args.oldName, args.newName);
                const space = store.getSpace(args.newName);
                return {
                    content: [{ type: 'text', text: `Space renamed from "${args.oldName}" to "${args.newName}".` }],
                    space,
                };
            },
        },
        space_delete: {
            schema: SpaceDeleteSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_delete,
            handler: async (args: z.infer<typeof SpaceDeleteSchema>) => {
                store.deleteSpace(args.name);
                return {
                    content: [{ type: 'text', text: `Space "${args.name}" deleted.` }],
                };
            },
        },
        space_tag_add: {
            schema: SpaceTagAddSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_tag_add,
            handler: async (args: z.infer<typeof SpaceTagAddSchema>) => {
                const allTags = store.listAllTags();
                const existingTags = allTags.spaces.map((t) => t.tag);

                store.addSpaceTag(args.space, args.tag);
                return {
                    content: [{ type: 'text', text: `Tag "${args.tag}" added to space "${args.space}".` }],
                    existingTagsInSystem: existingTags,
                    note: 'Check existingTagsInSystem to avoid creating duplicate tags in the future.',
                };
            },
        },
        space_tag_remove: {
            schema: SpaceTagRemoveSchema,
            description: SPACE_TOOL_DESCRIPTIONS.space_tag_remove,
            handler: async (args: z.infer<typeof SpaceTagRemoveSchema>) => {
                store.removeSpaceTag(args.space, args.tag);
                return {
                    content: [{ type: 'text', text: `Tag "${args.tag}" removed from space "${args.space}".` }],
                };
            },
        },
    };
}
