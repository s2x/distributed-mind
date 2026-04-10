import { resolveRefWithFallback } from '../../../helpers/memory-ref-resolver';
import type { MindStore } from '../../../store/mind-store';
import { LinkCreateSchema } from '../../schemas/links/create-link';

export function createLinkHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = LinkCreateSchema.parse(args ?? {});
    if (!parsed.sourceRef || !parsed.targetRef) {
      throw new Error('Both sourceRef and targetRef are required.');
    }

    const source = resolveRefWithFallback(store, parsed.sourceRef);
    const target = resolveRefWithFallback(store, parsed.targetRef, source.space);

    if (source.id === target.id) {
      throw new Error('Cannot link a memory to itself.');
    }

    store.link(source.id, target.id, parsed.label);

    return {
      content: [
        {
          type: 'text',
          text: `Linked: "${source.name}" → "${target.name}"${parsed.label ? ` [${parsed.label}]` : ''}`,
        },
      ],
    };
  };
}
