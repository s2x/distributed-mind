import { mapLinkedSummariesToLinksFormat } from '../../../helpers/link-building';
import type { MindStore } from '../../../store/mind-store';
import type { Tier } from '../../../types';
import { presentMemoryResponse } from '../../helpers/memory-response';
import { buildYamlContent } from '../../helpers/yaml-response';
import { MemoryReadSchema } from '../../schemas/memories/read-memory';

export interface TierChange {
  from: Tier;
  to: Tier;
  reason: string;
}

function calculateTierChange(fromTier: Tier, toTier: Tier, wasPinned: boolean): TierChange | null {
  if (fromTier === toTier) {
    if (wasPinned) {
      return { from: fromTier, to: fromTier, reason: 'pinned - promotion skipped' };
    }
    if (fromTier === 1) {
      return { from: 1, to: 1, reason: 'already at T1' };
    }
    return { from: fromTier, to: toTier, reason: 'destination full - promotion skipped' };
  }

  return { from: fromTier, to: toTier, reason: 'auto-promote on read' };
}

export function readMemoryHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = MemoryReadSchema.parse(args ?? {});
    if (!parsed.space || !parsed.name) {
      throw new Error('Both space and memory name are required.');
    }

    const memory = await store.getMemory(parsed.space, parsed.name);
    if (!memory) {
      throw new Error(`Memory "${parsed.name}" not found in space "${parsed.space}".`);
    }

    if (parsed.noPromote) {
      const linkedSummaries = await store.getLinkedMemorySummaries(memory.id);
      const { links_to, linked_by } = mapLinkedSummariesToLinksFormat(linkedSummaries);

      return buildYamlContent({
        memory: presentMemoryResponse(memory),
        links_to,
        linked_by,
        tier_change: null,
      });
    }

    const fromTier = memory.tier;
    const wasPinned = memory.pinned;

    await store.recordAccess(memory.id);

    const updatedMemory = await store.getMemoryById(memory.id);
    const toTier = updatedMemory?.tier ?? fromTier;
    const tier_change = calculateTierChange(fromTier, toTier, wasPinned);

    const linkedSummaries = await store.getLinkedMemorySummaries(memory.id);
    const { links_to, linked_by } = mapLinkedSummariesToLinksFormat(linkedSummaries);

    return buildYamlContent({
      memory: updatedMemory ? presentMemoryResponse(updatedMemory) : undefined,
      links_to,
      linked_by,
      tier_change,
    });
  };
}
