import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

import { presentHotMemoryResponse } from './memory-response';

export type TrendingCoverage = 'complete' | 'subset';

export interface TrendingTierBlock {
  total_count: number;
  returned_count: number;
  coverage: TrendingCoverage;
  memories: ReturnType<typeof presentHotMemoryResponse>[];
}

const TRENDING_BATCH_SIZE = 500;

export function determineTrendingCoverage(
  returnedCount: number,
  totalCount: number
): TrendingCoverage {
  if (returnedCount === totalCount || (returnedCount === 0 && totalCount === 0)) {
    return 'complete';
  }

  return 'subset';
}

export async function buildTrendingTierBlock(
  store: MindStore,
  space: string,
  tier: Tier,
  previewLimit: number
): Promise<TrendingTierBlock> {
  const totalInTier = await store.queryMemoriesCount({ space, tier });
  const filteredMemories: Array<ReturnType<typeof presentHotMemoryResponse>> = [];

  for (let offset = 0; offset < totalInTier; offset += TRENDING_BATCH_SIZE) {
    const memories = store.queryMemories({
      space,
      tier,
      limit: TRENDING_BATCH_SIZE,
      offset,
    });

    filteredMemories.push(
      ...memories
        .filter(memory => !memory.tags.includes('checkpoint'))
        .map(memory => presentHotMemoryResponse(memory))
    );
  }

  const memories = filteredMemories.slice(0, previewLimit);

  return {
    total_count: filteredMemories.length,
    returned_count: memories.length,
    coverage: determineTrendingCoverage(memories.length, filteredMemories.length),
    memories,
  };
}
