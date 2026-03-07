const TAG_REGEX = /^[a-zA-Z0-9\-_.:/=+@]+$/;
const VALID_TAG_CHARS = 'a-z, A-Z, 0-9, -, _, ., :, /, =, +, @';

export function normalizeTag(tag: string): string {
    const normalized = tag.trim().toLowerCase().replace(/^#/, '');
    if (!normalized) {
        throw new Error(`Tag cannot be empty. Valid: ${VALID_TAG_CHARS}`);
    }
    if (!TAG_REGEX.test(normalized)) {
        throw new Error(`Tag contains invalid characters. Valid: ${VALID_TAG_CHARS}`);
    }
    return normalized;
}

export function normalizeTags(tags: string[]): string[] {
    return tags.map(normalizeTag);
}
