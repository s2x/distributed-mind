import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const LinkCreateSchema = z.object({
    sourceRef: z.string().describe('Source memory reference in "space:name" format or just "name" (uses source memory\'s space).'),
    targetRef: z.string().describe('Target memory reference in "space:name" format or just "name" (uses source memory\'s space if bare).'),
    label: z
        .string()
        .optional()
        .describe('Relationship label describing the link (e.g., "depends_on", "caused_by", "extends", "contradicts").'),
});

const LinkDeleteSchema = z.object({
    sourceRef: z.string().describe('Source memory reference of the link to remove in "space:name" format or just "name".'),
    targetRef: z.string().describe('Target memory reference of the link to remove in "space:name" format or just "name".'),
});

const LINK_TOOL_DESCRIPTIONS: Record<string, string> = {
    link_create:
        'Create a directional link between two memories so future agents can trace related decisions without searching. Use when a memory depends on, extends, or contradicts another (e.g., a bugfix caused by a prior decision, a discovery that updates a pattern). Requires source and target memory references in "space:name" format or bare names (same space).',
    link_delete: 'Remove a directional link between two memories. The memories themselves are not affected.',
};

/**
 * Resolve a memory reference string to a memory object.
 * - If ref contains ':', parse as "space:name" directly.
 * - If ref is bare (no colon), use fallbackSpace if provided, otherwise search all spaces.
 * - Returns null if ref format is invalid (no colon).
 * - Throws if memory not found in the resolved space.
 */
function resolveRef(store: MindStore, ref: string, fallbackSpace?: string): { id: number; space: string; name: string } {
    const parsed = store.resolveMemoryRef(ref);

    if (parsed) {
        // Fully qualified "space:name" format
        const memory = store.getMemory(parsed.space, parsed.name);
        if (!memory) {
            throw new Error(`memory not found: ${ref}`);
        }
        return { id: memory.id, space: parsed.space, name: memory.name };
    }

    // Bare name (no colon) - invalid format
    if (!ref.includes(':')) {
        throw new Error('invalid memory reference');
    }

    // This should never happen since resolveMemoryRef returns null for bare names
    throw new Error('invalid memory reference');
}

/**
 * Resolve a memory reference, searching all spaces if bare and no fallbackSpace.
 * Used when we need to find a memory by name alone.
 * Throws "invalid memory reference" if ref has no colon AND memory doesn't exist anywhere.
 * Throws "memory not found" if ref format is valid but memory doesn't exist.
 */
function resolveRefWithFallback(store: MindStore, ref: string, fallbackSpace?: string): { id: number; space: string; name: string } {
    const parsed = store.resolveMemoryRef(ref);

    if (parsed) {
        // Fully qualified "space:name" format
        const memory = store.getMemory(parsed.space, parsed.name);
        if (!memory) {
            throw new Error(`memory not found: ${ref}`);
        }
        return { id: memory.id, space: parsed.space, name: memory.name };
    }

    // resolveMemoryRef returns null for refs without ':'
    // If no ':' at all, it could be:
    // 1. A bare name that might exist -> search all spaces
    // 2. A malformed ref like "invalid-no-colon" -> "invalid memory reference"
    // Distinguish: if the memory exists anywhere, it's case 1 (bare name)
    //              if not found anywhere AND no ':' in ref, it's case 2 (invalid format)

    // First check: try fallbackSpace if provided
    if (fallbackSpace) {
        const memory = store.getMemory(fallbackSpace, ref);
        if (memory) {
            return { id: memory.id, space: fallbackSpace, name: memory.name };
        }
    }

    // Search all spaces for the memory (bare name lookup)
    const spaces = store.listSpaces();
    for (const spaceSummary of spaces) {
        const memory = store.getMemory(spaceSummary.name, ref);
        if (memory) {
            return { id: memory.id, space: spaceSummary.name, name: memory.name };
        }
    }

    // Memory not found anywhere
    // If ref has no ':', it was intended as a bare name but doesn't exist - invalid format
    if (!ref.includes(':')) {
        throw new Error('invalid memory reference');
    }

    // Should not reach here since resolveMemoryRef would have parsed it
    throw new Error(`memory not found: ${ref}`);
}

export function createLinkTools(store: MindStore) {
    return {
        link_create: {
            schema: LinkCreateSchema,
            description: LINK_TOOL_DESCRIPTIONS.link_create,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = LinkCreateSchema.parse(args ?? {});
                if (!parsed.sourceRef || !parsed.targetRef) {
                    throw new Error('Both sourceRef and targetRef are required.');
                }

                // Resolve source first to get its space
                const source = resolveRefWithFallback(store, parsed.sourceRef);
                // Resolve target using source's space as fallback for bare names
                const target = resolveRefWithFallback(store, parsed.targetRef, source.space);

                if (source.id === target.id) {
                    throw new Error('Cannot link a memory to itself.');
                }

                store.link(source.id, target.id, parsed.label);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Linked: "${source.name}" → "${target.name}"${parsed.label ? ` [${parsed.label}]` : ''}`,
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
                if (!parsed.sourceRef || !parsed.targetRef) {
                    throw new Error('Both sourceRef and targetRef are required.');
                }

                // Resolve source first to get its space
                const source = resolveRefWithFallback(store, parsed.sourceRef);
                // Resolve target using source's space as fallback for bare names
                const target = resolveRefWithFallback(store, parsed.targetRef, source.space);

                store.unlink(source.id, target.id);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Unlinked: "${source.name}" ✕ "${target.name}"`,
                        },
                    ],
                };
            },
        },
    };
}
