(function (root, factory) {
    const api = factory();
    root.appRouting = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeView(view) {
        return view === 'map' ? 'map' : 'list';
    }

    function safeDecode(value) {
        try {
            return decodeURIComponent(value);
        } catch {
            return null;
        }
    }

    function parseAppRoute(pathname, search) {
        if (pathname === '/') {
            return { spaceName: null, view: 'list', memoryName: null };
        }

        const match = /^\/spaces\/([^/]+)$/.exec(pathname);
        if (!match) {
            return { spaceName: null, view: 'list', memoryName: null };
        }

        const decodedSpace = safeDecode(match[1]);
        if (!decodedSpace) {
            return { spaceName: null, view: 'list', memoryName: null };
        }

        const params = new URLSearchParams(search ?? '');
        const view = normalizeView(params.get('view'));
        const memoryName = params.get('memory');

        return {
            spaceName: decodedSpace,
            view,
            memoryName: memoryName ?? null,
        };
    }

    function buildAppUrl(route) {
        if (!route?.spaceName) {
            return '/';
        }

        const encodedSpace = encodeURIComponent(route.spaceName);
        const query = [`view=${normalizeView(route.view)}`];
        if (route.memoryName) {
            query.push(`memory=${encodeURIComponent(route.memoryName)}`);
        }

        return `/spaces/${encodedSpace}?${query.join('&')}`;
    }

    return {
        parseAppRoute,
        buildAppUrl,
    };
});
