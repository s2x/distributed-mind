import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const SpaceCreateSchema = z.object({
  name: z.string().describe('Space name (e.g., "projects/mind" or "user/preferences")'),
  description: z.string().describe('Space description'),
  tags: z.array(z.string()).optional().describe('Optional tags following conventions: type:project, type:user, type:config, type:learning, type:session'),
});

const SpaceListSchema = z.object({
  tag: z.string().optional().describe('Filter by tag'),
});

const SpaceGetSchema = z.object({
  name: z.string().describe('Space name'),
});

const SpaceUpdateSchema = z.object({
  name: z.string().describe('Space name'),
  description: z.string().describe('New description'),
});

const SpaceRenameSchema = z.object({
  oldName: z.string().describe('Current space name'),
  newName: z.string().describe('New space name'),
});

const SpaceDeleteSchema = z.object({
  name: z.string().describe('Space name'),
});

const SpaceTagAddSchema = z.object({
  space: z.string().describe('Space name'),
  tag: z.string().describe('Tag to add (check existing tags first to avoid duplicates)'),
});

const SpaceTagRemoveSchema = z.object({
  space: z.string().describe('Space name'),
  tag: z.string().describe('Tag to remove'),
});

export function createSpaceTools(store: MindStore) {
  return {
    space_create: {
      schema: SpaceCreateSchema,
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
      handler: async (args: z.infer<typeof SpaceGetSchema>) => {
        const space = store.getSpace(args.name);
        if (!space) {
          throw new Error(`Space "${args.name}" not found.`);
        }
        return {
          content: [{ type: 'text', text: `Space: ${space.name}` }],
          space,
        };
      },
    },
    space_update: {
      schema: SpaceUpdateSchema,
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
      handler: async (args: z.infer<typeof SpaceDeleteSchema>) => {
        store.deleteSpace(args.name);
        return {
          content: [{ type: 'text', text: `Space "${args.name}" deleted.` }],
        };
      },
    },
    space_tag_add: {
      schema: SpaceTagAddSchema,
      handler: async (args: z.infer<typeof SpaceTagAddSchema>) => {
        // Get existing tags to help LLM avoid duplicates
        const allTags = store.listAllTags();
        const existingTags = allTags.spaces.map(t => t.tag);
        
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
      handler: async (args: z.infer<typeof SpaceTagRemoveSchema>) => {
        store.removeSpaceTag(args.space, args.tag);
        return {
          content: [{ type: 'text', text: `Tag "${args.tag}" removed from space "${args.space}".` }],
        };
      },
    },
  };
}
