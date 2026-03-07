import type { RouteDefinition } from './types';
import { exact } from './types';

export const statusRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    match: exact('/api/status'),
    handle: ({ url, store, json }) => {
      const space = url.searchParams.get('space') ?? undefined;
      return json(store.getStatus(space));
    },
  },
];
