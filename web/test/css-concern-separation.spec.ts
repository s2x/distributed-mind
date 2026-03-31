import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const stylesDir = join(import.meta.dir, '../styles');

function readStyleFile(name: string): string {
  return readFileSync(join(stylesDir, name), 'utf8');
}

describe('CSS concern separation', () => {
  test('components.css excludes token/base/layout/utility concerns', () => {
    const componentsCss = readStyleFile('components.css');

    const forbiddenSelectors = [
      ':root',
      '*::before',
      '*::after',
      'body',
      '#app',
      '#sidebar',
      '#main',
      '#space-detail',
      '#tiers',
      '::-webkit-scrollbar',
      '.hidden',
      '.editable',
      '.muted',
    ];

    for (const selector of forbiddenSelectors) {
      expect(componentsCss.includes(selector)).toBe(false);
    }
  });
});
