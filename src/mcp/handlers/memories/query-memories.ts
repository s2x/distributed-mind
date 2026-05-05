import type { MindStore } from '../../../store/mind-store';
import type { Tier } from '../../../types';
import { presentMemoryResponse } from '../../helpers/memory-response';
import { buildYamlContent } from '../../helpers/yaml-response';
import { MemoryQuerySchema } from '../../schemas/memories/query-memories';

interface MemoryQueryPayload {
  memories: any[];
  total: number;
  limit: number;
  offset: number;
  search_method?: string;
}

function applyDateFilters(
  results: { changed_at: string }[],
  from?: string,
  to?: string
): typeof results {
  let filtered = results;

  if (from) {
    const fromDate = new Date(from);
    filtered = filtered.filter(memory => new Date(memory.changed_at) >= fromDate);
  }

  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter(memory => new Date(memory.changed_at) <= toDate);
  }

  return filtered;
}

function buildMemoryQueryResponse(
  memories: any[],
  totalCount: number,
  search_method: string | undefined,
  parsed: { limit?: number; offset?: number }
): ReturnType<typeof buildYamlContent<MemoryQueryPayload>> {
  const response: MemoryQueryPayload = {
    memories: memories.map(
      ({
        id: _id,
        content: _c,
        rank: _r,
        similarity: _s,
        created_at: _created_at,
        updated_at: _updated_at,
        ...rest
      }: any) => presentMemoryResponse(rest)
    ),
    total: totalCount,
    limit: parsed.limit ?? 25,
    offset: parsed.offset ?? 0,
  };

  if (search_method) {
    response.search_method = search_method;
  }

  return buildYamlContent(response);
}

export function queryMemoriesHandler(store: MindStore) {
  return async (args: unknown) => {
    let parsed;
    try {
      parsed = MemoryQuerySchema.parse(args ?? {});
    } catch (e: any) {
      if (e.issues?.length) {
        const spaceError = e.issues.find((err: any) => err.path?.includes('space'));
        if (spaceError) {
          throw new Error('space is required');
        }
      }
      throw e;
    }

    const spaceFilter = parsed.space === '*' ? undefined : parsed.space;
    const tierFilter = parsed.tier ?? undefined;

    let memories: any[];
    let totalCount: number;
    let search_method: string | undefined;

    if (parsed.search) {
      const searchResult = await store.searchFallback(parsed.search, {
        space: spaceFilter,
        tag: parsed.tag,
        tier: tierFilter as Tier | undefined,
      });

      const filteredResults = applyDateFilters(searchResult.results, parsed.from, parsed.to);

      totalCount = filteredResults.length;
      search_method = searchResult.search_method;

      const offset = parsed.offset ?? 0;
      const limit = parsed.limit ?? 25;
      memories = filteredResults.slice(offset, offset + limit);
    } else {
      memories = await store.queryMemories({
        space: spaceFilter,
        tag: parsed.tag,
        tier: tierFilter as Tier | undefined,
        from: parsed.from,
        to: parsed.to,
        limit: parsed.limit ?? 25,
        offset: parsed.offset ?? 0,
      });

      totalCount = await store.queryMemoriesCount({
        space: spaceFilter,
        tag: parsed.tag,
        tier: tierFilter as Tier | undefined,
        from: parsed.from,
        to: parsed.to,
      });
    }

    return buildMemoryQueryResponse(memories, totalCount, search_method, parsed);
  };
}
