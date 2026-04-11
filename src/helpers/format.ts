import type { ArgParser } from '../cli/arg-parser';

import type { Logger } from './logger';
import { style } from './style';

export const TIER_LABELS: Record<number, string> = {
  1: '🔴 T1 (hot)',
  2: '🟡 T2 (warm)',
  3: '🔵 T3 (cold)',
};

export function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `T${tier}`;
}

export function formatTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return tags.map(t => style(`#${t}`, ['cyan'])).join(' ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLocalTimestamp(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export function formatChangedLine(value: string): string {
  return `· ${formatLocalTimestamp(value)}`;
}

export function formatMemoryLine(
  memory: {
    name: string;
    space_name?: string;
    tier: number;
    pinned: boolean;
    tags: string[];
    changed_at: string;
  },
  opts?: { showSpace?: boolean }
): string {
  const showSpace = opts?.showSpace ?? false;
  const ref =
    showSpace && memory.space_name
      ? `${style(`[${memory.space_name}]`, ['magenta'])} / ${style(`[${memory.name}]`, ['bold'])}`
      : style(`[${memory.name}]`, ['bold']);
  const pin = memory.pinned ? ' 📌' : '';
  const tags = formatTags(memory.tags);
  const tagsPart = tags ? ` ${tags}` : '';
  return `${ref} [${tierLabel(memory.tier)}]${pin}${tagsPart} ${style(formatChangedLine(memory.changed_at), ['dim'])}`;
}

export function renderCommands(cmds: ArgParser[], logger: Logger): void {
  for (const cmd of cmds) {
    logger.logInfo(`   ${cmd.getRendered()}`);
  }
}

export function parseMemoryRef(ref: string): { space: string; name: string } {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1)
    throw new Error(`Invalid memory reference "${ref}". Expected format: space/name`);
  return { space: ref.slice(0, slashIdx), name: ref.slice(slashIdx + 1) };
}
