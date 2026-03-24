import { normalizeTag, normalizeTags } from '../../helpers/tags';
import type { RouteDefinition } from './types';
import { exact, regex } from './types';

export const spaceRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        match: exact('/api/spaces'),
        handle: ({ url, store, json }) => {
            const tagRaw = url.searchParams.get('tag');
            const tag = tagRaw ? normalizeTag(tagRaw) : undefined;
            const includeHidden = url.searchParams.get('includeHidden') === 'true';
            return json(store.listSpaces({ tag, includeHidden }));
        },
    },
    {
        method: 'POST',
        match: exact('/api/spaces'),
        handle: async ({ req, store, json }) => {
            const body = (await req.json()) as { name: string; description: string; tags?: string[] };
            const tags = body.tags ? normalizeTags(body.tags) : undefined;
            store.createSpace(body.name, body.description ?? '', tags);
            return json(store.getSpace(body.name), 201);
        },
    },
    {
        method: 'GET',
        match: regex(/^\/api\/spaces\/([^/]+)$/, ['space']),
        handle: ({ params, store, json, err }) => {
            const spaceName = params.space!;
            const space = store.getSpace(spaceName);
            if (!space) return err('Space not found', 404);
            return json(space);
        },
    },
    {
        method: 'PATCH',
        match: regex(/^\/api\/spaces\/([^/]+)$/, ['space']),
        handle: async ({ req, params, store, json }) => {
            const body = (await req.json()) as {
                description?: string;
                newName?: string;
                addTag?: string;
                removeTag?: string;
            };
            const space = params.space!;
            if (body.description !== undefined) store.updateSpace(space, { description: body.description });
            if (body.newName) store.renameSpace(space, body.newName);
            if (body.addTag) store.addSpaceTag(body.newName ?? space, body.addTag);
            if (body.removeTag) store.removeSpaceTag(body.newName ?? space, body.removeTag);
            return json(store.getSpace(body.newName ?? space));
        },
    },
    {
        method: 'DELETE',
        match: regex(/^\/api\/spaces\/([^/]+)$/, ['space']),
        handle: ({ params, store, json }) => {
            store.deleteSpace(params.space!);
            return json({ ok: true });
        },
    },
];
