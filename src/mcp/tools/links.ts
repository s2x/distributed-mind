import type { MindStore } from '../../store/mind-store';
import { createLinkHandler } from '../handlers/links/create-link';
import { deleteLinkHandler } from '../handlers/links/delete-link';
import { LinkCreateSchema } from '../schemas/links/create-link';
import { LinkDeleteSchema } from '../schemas/links/delete-link';
import type { ToolDefinition } from '../tool-types';

const LINK_TOOL_DESCRIPTIONS: Record<string, string> = {
  link_create:
    'Create a directional link between two memories. Use when a memory depends on, extends, or relates to another.',
  link_delete:
    'Remove a directional link between two memories. The memories themselves are unaffected.',
};

export function createLinkTools(store: MindStore): Record<string, ToolDefinition> {
  return {
    link_create: {
      schema: LinkCreateSchema,
      description: LINK_TOOL_DESCRIPTIONS.link_create,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: createLinkHandler(store),
    },
    link_delete: {
      schema: LinkDeleteSchema,
      description: LINK_TOOL_DESCRIPTIONS.link_delete,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: deleteLinkHandler(store),
    },
  };
}
