import { describe, expect, test } from 'bun:test';

import { buildAppUrl, parseAppRoute } from '../src/features/routing/routing.js';

describe('SPA routing contract', () => {
    test('parses home route', () => {
        expect(parseAppRoute('/', '')).toEqual({
            spaceName: null,
            view: 'list',
            memoryName: null,
        });
    });

    test('parses encoded space, view, and memory from URL', () => {
        expect(parseAppRoute('/spaces/Project%20Alpha', '?view=map&memory=Task%20A')).toEqual({
            spaceName: 'Project Alpha',
            view: 'map',
            memoryName: 'Task A',
        });
    });

    test('falls back safely for invalid view', () => {
        expect(parseAppRoute('/spaces/demo', '?view=grid')).toEqual({
            spaceName: 'demo',
            view: 'list',
            memoryName: null,
        });
    });

    test('falls back safely for malformed path or bad encoding', () => {
        expect(parseAppRoute('/spaces', '?view=map')).toEqual({
            spaceName: null,
            view: 'list',
            memoryName: null,
        });

        expect(parseAppRoute('/spaces/%E0%A4%A', '?memory=abc')).toEqual({
            spaceName: null,
            view: 'list',
            memoryName: null,
        });
    });

    test('builds canonical home and space URLs', () => {
        expect(buildAppUrl({ spaceName: null, view: 'map', memoryName: 'ignored' })).toBe('/');
        expect(buildAppUrl({ spaceName: 'Project Alpha', view: 'list', memoryName: null })).toBe(
            '/spaces/Project%20Alpha?view=list'
        );
        expect(buildAppUrl({ spaceName: 'Project Alpha', view: 'map', memoryName: 'Task A' })).toBe(
            '/spaces/Project%20Alpha?view=map&memory=Task%20A'
        );
    });

    test('preserves memory names with literal percent signs', () => {
        const url = buildAppUrl({
            spaceName: 'Project Alpha',
            view: 'map',
            memoryName: 'Release 100% done',
        });
        expect(url).toBe('/spaces/Project%20Alpha?view=map&memory=Release%20100%25%20done');

        expect(parseAppRoute('/spaces/Project%20Alpha', '?view=map&memory=Release%20100%25%20done')).toEqual({
            spaceName: 'Project Alpha',
            view: 'map',
            memoryName: 'Release 100% done',
        });
    });
});
