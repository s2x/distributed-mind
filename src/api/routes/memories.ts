import { normalizeTag, normalizeTags } from '../../helpers/tags';
import type { Tier } from '../../types';

import type { RouteDefinition } from './types';
import { regex } from './types';

function parseTier(raw: string | null): Tier | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (n >= 1 && n <= 3) return n as Tier;
  return undefined;
}

function parseIntParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) return undefined;
  return n;
}

export const memoryRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    match: regex(/^\/api\/spaces\/([^/]+)\/graph$/, ['space']),
    handle: async ({ params, url, store, json }) => {
      const rawLimit = parseIntParam(url.searchParams.get('limit'));
      const graph = await store.getSpaceGraph(params.space!, { limit: rawLimit, maxLimit: 1000 });
      return json(graph);
    },
  },
  {
    method: 'GET',
    match: regex(/^\/api\/memories\/query$/, []),
    handle: async ({ url, store, json }) => {
      const tier = parseTier(url.searchParams.get('tier'));
      const tagRaw = url.searchParams.get('tag');
      const tag = tagRaw ? normalizeTag(tagRaw) : undefined;

      return json(
        await store.queryMemories({
          space: url.searchParams.get('space') ?? undefined,
          tag,
          tier,
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          limit: parseIntParam(url.searchParams.get('limit')),
          offset: parseIntParam(url.searchParams.get('offset')),
        })
      );
    },
  },
  {
    method: 'GET',
    match: regex(/^\/api\/spaces\/([^/]+)\/memories$/, ['space']),
    handle: async ({ params, url, store, json }) => {
      const space = params.space!;
      const tier = parseTier(url.searchParams.get('tier'));
      const tagRaw = url.searchParams.get('tag');
      const tag = tagRaw ? normalizeTag(tagRaw) : undefined;

      if (tier !== undefined) {
        return json(await store.listMemories(space, { tier, tag }));
      }

      const t1 = await store.listMemories(space, { tier: 1, tag });
      const t2 = await store.listMemories(space, { tier: 2, tag });
      const t3 = await store.listMemories(space, { tier: 3, tag });
      return json([...t1, ...t2, ...t3]);
    },
  },
  {
    method: 'POST',
    match: regex(/^\/api\/spaces\/([^/]+)\/memories$/, ['space']),
    handle: async ({ params, req, store, json, err }) => {
      const space = params.space!;
      const body = (await req.json()) as {
        name: string;
        content: string;
        tags?: string[];
        tier?: 1 | 2 | 3;
      };

      if (body.tier !== undefined && (body.tier < 1 || body.tier > 3)) {
        return err('tier must be 1, 2, or 3.', 400);
      }

      const tags = body.tags ? normalizeTags(body.tags) : undefined;
      const memory = await store.addMemory(space, body.name, body.content, {
        tags,
        tier: body.tier,
      });
      return json(memory, 201);
    },
  },
  {
    method: 'GET',
    match: regex(/^\/api\/spaces\/([^/]+)\/memories\/([^/]+)$/, ['space', 'name']),
    handle: async ({ params, store, json, err }) => {
      const memory = await store.getMemory(params.space!, params.name!);
      if (!memory) return err('Memory not found', 404);
      return json(memory);
    },
  },
  {
    method: 'PATCH',
    match: regex(/^\/api\/spaces\/([^/]+)\/memories\/([^/]+)$/, ['space', 'name']),
    handle: async ({ params, req, store, json, err }) => {
      const space = params.space!;
      const name = params.name!;
      const memory = await store.getMemory(space, name);
      if (!memory) return err('Memory not found', 404);

      const body = (await req.json()) as {
        content?: string;
        pinned?: boolean;
        addTag?: string;
        removeTag?: string;
        promote?: boolean;
        demote?: boolean;
      };

      if (body.content !== undefined)
        await store.updateMemory(memory.id, { content: body.content });
      if (body.promote) await store.promote(memory.id);
      if (body.demote) await store.demote(memory.id);
      if (body.pinned === true) await store.pin(memory.id);
      if (body.pinned === false) await store.unpin(memory.id);
      if (body.addTag) await store.addMemoryTag(memory.id, body.addTag);
      if (body.removeTag) await store.removeMemoryTag(memory.id, body.removeTag);

      return json(await store.getMemoryById(memory.id));
    },
  },
  {
    method: 'DELETE',
    match: regex(/^\/api\/spaces\/([^/]+)\/memories\/([^/]+)$/, ['space', 'name']),
    handle: async ({ params, store, json }) => {
      await store.deleteMemoryByName(params.space!, params.name!);
      return json({ ok: true });
    },
  },
];
