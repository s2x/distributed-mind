import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const indexHtmlPath = join(import.meta.dir, '../public/index.html');

function getAssetAttributeValues(indexHtml: string, attributeName: 'href' | 'src'): string[] {
    const pattern = new RegExp(`${attributeName}="([^"]+)"`, 'g');
    return Array.from(indexHtml.matchAll(pattern), (match) => match[1]).filter((value): value is string =>
        typeof value === 'string'
    );
}

describe('web index asset paths', () => {
    test('uses root-absolute paths for local assets so deep-route reloads still load resources', () => {
        const indexHtml = readFileSync(indexHtmlPath, 'utf8');
        const hrefValues = getAssetAttributeValues(indexHtml, 'href');
        const srcValues = getAssetAttributeValues(indexHtml, 'src');

        expect(hrefValues).toContain('/assets/logo.svg');
        expect(hrefValues).toContain('/styles/main.css');

        expect(srcValues).toContain('/assets/logo.svg');
        expect(srcValues).toContain('/src/app.js');
    });
});
