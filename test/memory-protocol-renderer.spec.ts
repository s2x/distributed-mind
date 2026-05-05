import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { renderMemoryProtocol } from '../src/cli/memory-protocol';

function readSnapshot(name: string): string {
  return readFileSync(join(import.meta.dir, 'snapshots', name), 'utf-8');
}

describe('memory protocol renderer', () => {
  test('renders OpenCode protocol variant snapshot', async () => {
    const rendered = renderMemoryProtocol('opencode');
    const snapshot = readSnapshot('memory-protocol.opencode.md');

    expect(rendered).toBe(snapshot);
  });

  test('renders Claude protocol variant snapshot', async () => {
    const rendered = renderMemoryProtocol('claude-code');
    const snapshot = readSnapshot('memory-protocol.claude-code.md');

    expect(rendered).toBe(snapshot);
  });

  test('renders Codex protocol variant snapshot', async () => {
    const rendered = renderMemoryProtocol('codex');
    const snapshot = readSnapshot('memory-protocol.codex.md');

    expect(rendered).toBe(snapshot);
  });
});
