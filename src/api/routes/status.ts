import type { RouteDefinition } from './types';
import { exact } from './types';

export const statusRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    match: exact('/api/status'),
    handle: async ({ url, store, json }) => {
      const space = url.searchParams.get('space') ?? undefined;
      return json(await store.getStatus(space));
    },
  },
];
