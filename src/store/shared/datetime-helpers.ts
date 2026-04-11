// ── Datetime helper functions ──

/**
 * Return current timestamp in SQLite DATETIME format (YYYY-MM-DD HH:MM:SS).
 */
export function now(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}

/**
 * Normalize a date bound (from/to) to SQLite DATETIME format.
 * @param raw - the raw date string
 * @param endOfDay - if true, set time to 23:59:59 instead of 00:00:00
 */
export function normalizeDateBound(raw: string, endOfDay = false): string {
  const text = raw.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = dateOnly
    ? new Date(`${text}T${endOfDay ? '23:59:59' : '00:00:00'}`)
    : new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${raw}`);
  }

  return parsed.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}
