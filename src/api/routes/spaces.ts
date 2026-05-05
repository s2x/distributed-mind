import { normalizeTag, normalizeTags } from '../../helpers/tags';

import type { RouteDefinition } from './types';
import { exact, regex } from './types';

export const spaceRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    match: exact('/api/spaces'),
    handle: async ({ url, store, json }) => {
      const tagRaw = url.searchParams.get('tag');
      const tag = tagRaw ? normalizeTag(tagRaw) : undefined;
      const includeHidden = url.searchParams.get('includeHidden') === 'true';
      return json(await store.listSpaces({ tag, includeHidden }));
    },
  },
  {
    method: 'POST',
    match: exact('/api/spaces'),
    handle: async ({ req, store, json }) => {
      const body = (await req.json()) as { name: string; description: string; tags?: string[] };
      const tags = body.tags ? normalizeTags(body.tags) : undefined;
      await store.createSpace(body.name, body.description ?? '', tags);
      return json(await store.getSpace(body.name), 201);
    },
  },
  {
    method: 'GET',
    match: regex(/^\/api\/spaces\/([^/]+)$/, ['space']),
    handle: async ({ params, store, json, err }) => {
      const spaceName = params.space!;
      const space = await store.getSpace(spaceName);
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
      if (body.description !== undefined)
        await store.updateSpace(space, { description: body.description });
      if (body.newName) await store.renameSpace(space, body.newName);
      if (body.addTag) await store.addSpaceTag(body.newName ?? space, body.addTag);
      if (body.removeTag) await store.removeSpaceTag(body.newName ?? space, body.removeTag);
      return json(await store.getSpace(body.newName ?? space));
    },
  },
  {
    method: 'DELETE',
    match: regex(/^\/api\/spaces\/([^/]+)$/, ['space']),
    handle: async ({ params, store, json }) => {
      await store.deleteSpace(params.space!);
      return json({ ok: true });
    },
  },
];
