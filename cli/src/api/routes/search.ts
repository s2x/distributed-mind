import { normalizeTag } from '../../helpers/tags';
import type { Tier } from '../../types';
import type { RouteDefinition } from './types';
import { exact } from './types';

function parseTier(raw: string | null): Tier | undefined {
    if (!raw) return undefined;
    const n = Number(raw);
    if (n >= 1 && n <= 4) return n as Tier;
    return undefined;
}

export const searchRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        match: exact('/api/search'),
        handle: async ({ url, store, json }) => {
            const q = url.searchParams.get('q') ?? '';
            if (!q) return json([]);

            const space = url.searchParams.get('space') ?? undefined;
            const tagRaw = url.searchParams.get('tag');
            const tag = tagRaw ? normalizeTag(tagRaw) : undefined;
            const tier = parseTier(url.searchParams.get('tier'));

            return json(await store.search(q, { space, tag, tier }));
        },
    },
];
