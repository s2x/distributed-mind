// ── FTS query sanitization helpers ──

/**
 * Sanitize an FTS5 query string.
 * - Strips apostrophes to prevent injection
 * - Splits on whitespace and filters empty terms
 * - Wraps each term in double quotes
 * - Preserves trailing asterisk for prefix matching
 *
 * @example
 * sanitizeFtsQuery("auth token")     // => '"auth" "token"'
 * sanitizeFtsQuery("auth*")          // => '"auth"*'
 */
export function sanitizeFtsQuery(query: string): string {
  const sanitized = query
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(term => {
      const trailing = term.endsWith('*');
      const clean = term.replace(/\*/g, '');
      if (!clean) return null;
      return trailing ? `"${clean}"*` : `"${clean}"`;
    })
    .filter(Boolean)
    .join(' ');

  return sanitized;
}
