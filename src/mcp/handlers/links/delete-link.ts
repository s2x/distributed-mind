import { resolveRefWithFallback } from '../../../helpers/memory-ref-resolver';
import type { MindStore } from '../../../store/mind-store';
import { LinkDeleteSchema } from '../../schemas/links/delete-link';

export function deleteLinkHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = LinkDeleteSchema.parse(args ?? {});
    if (!parsed.sourceRef || !parsed.targetRef) {
      throw new Error('Both sourceRef and targetRef are required.');
    }

    const source = resolveRefWithFallback(store, parsed.sourceRef);
    const target = resolveRefWithFallback(store, parsed.targetRef, source.space);

    store.unlink(source.id, target.id);

    return {
      content: [
        {
          type: 'text',
          text: `Unlinked: "${source.name}" ✕ "${target.name}"`,
        },
      ],
    };
  };
}
