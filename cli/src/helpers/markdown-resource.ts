import * as fs from 'node:fs';

export function loadMarkdownResource(resourcePath: string): string {
    try {
        return fs.readFileSync(resourcePath, 'utf-8');
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load markdown resource at "${resourcePath}": ${reason}`);
    }
}
