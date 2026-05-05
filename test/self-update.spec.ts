import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, test } from 'bun:test';

import { getCurrentVersion, getInstallerPath, getRootPath } from '../src/cli/self-update';

describe('self-update path resolution', () => {
  test('resolves repo-local paths under the current src layout', async () => {
    const expectedRepoRoot = path.resolve(import.meta.dir, '..');
    const oneLevelAboveRepo = path.resolve(expectedRepoRoot, '..');

    expect(getRootPath()).toBe(expectedRepoRoot);
    expect(getRootPath()).not.toBe(oneLevelAboveRepo);
    expect(fs.existsSync(path.join(getRootPath(), 'package.json'))).toBe(true);
    expect(fs.existsSync(getInstallerPath())).toBe(true);
  });

  test('reads the current version from the repo-local package.json', async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(path.resolve(import.meta.dir, '..'), 'package.json'), 'utf-8')
    ) as { version: string };

    expect(getCurrentVersion()).toBe(packageJson.version);
  });
});
