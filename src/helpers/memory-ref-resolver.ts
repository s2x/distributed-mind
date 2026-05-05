import type { MindStore } from '../store/mind-store';

export async function resolveRefWithFallback(
  store: MindStore,
  ref: string,
  fallbackSpace?: string
): Promise<{ id: number; space: string; name: string }> {
  const parsed = await store.resolveMemoryRef(ref);

  if (parsed) {
    const memory = await store.getMemory(parsed.space, parsed.name);
    if (!memory) {
      throw new Error(`memory not found: ${ref}`);
    }
    return { id: memory.id, space: parsed.space, name: memory.name };
  }

  if (fallbackSpace) {
    const memory = await store.getMemory(fallbackSpace, ref);
    if (memory) {
      return { id: memory.id, space: fallbackSpace, name: memory.name };
    }
  }

  const spaces = await store.listSpaces();
  for (const spaceSummary of spaces) {
    const memory = await store.getMemory(spaceSummary.name, ref);
    if (memory) {
      return { id: memory.id, space: spaceSummary.name, name: memory.name };
    }
  }

  if (!ref.includes(':')) {
    throw new Error('invalid memory reference');
  }

  throw new Error(`memory not found: ${ref}`);
}
