import type { MindStore } from '../store/mind-store';
import type { RouteContext, RouteDefinition } from './routes/types';
import { spaceRoutes } from './routes/spaces';
import { memoryRoutes } from './routes/memories';
import { searchRoutes } from './routes/search';
import { statusRoutes } from './routes/status';

const ALL_ROUTES: RouteDefinition[] = [
  ...spaceRoutes,
  ...memoryRoutes,
  ...searchRoutes,
  ...statusRoutes,
];

export async function matchApiRoute(req: Request, store: MindStore): Promise<Response | null> {
  const url = new URL(req.url);

  const json = (data: unknown, status = 200): Response => Response.json(data, { status });
  const err = (msg: string, status = 400): Response => Response.json({ error: msg }, { status });
  const parseBody = async <T>(request: Request): Promise<T> => request.json() as Promise<T>;

  for (const route of ALL_ROUTES) {
    if (route.method !== req.method) continue;
    const params = route.match(url.pathname);
    if (!params) continue;

    const ctx: RouteContext = {
      req,
      url,
      store,
      params,
      json,
      err,
      parseBody,
    };

    return await route.handle(ctx);
  }

  return null;
}
