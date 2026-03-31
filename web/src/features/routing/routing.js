// @ts-check

/** @typedef {'list'|'map'} SpaceView */
/** @typedef {{ spaceName: string|null, view: SpaceView, memoryName: string|null, isLogsPage?: boolean }} AppRoute */
/** @typedef {{ spaceName?: string|null, view?: string|null, memoryName?: string|null, isLogsPage?: boolean }} BuildAppRouteInput */

/** @param {string|null} view @returns {SpaceView} */
function normalizeView(view) {
  return view === 'map' ? 'map' : 'list';
}

/** @param {string} value */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** @param {string} pathname @param {string} search @returns {AppRoute} */
function parseAppRoute(pathname, search) {
  if (pathname === '/') {
    return { spaceName: null, view: 'list', memoryName: null };
  }

  // Check for logs route
  if (pathname === '/logs') {
    return { spaceName: null, view: 'list', memoryName: null, isLogsPage: true };
  }

  const match = /^\/spaces\/([^/]+)$/.exec(pathname);
  if (!match) {
    return { spaceName: null, view: 'list', memoryName: null };
  }

  const decodedSpace = safeDecode(match[1] ?? '');
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

/** @param {BuildAppRouteInput} route */
function buildAppUrl(route) {
  if (route?.isLogsPage) {
    return '/logs';
  }

  if (!route?.spaceName) {
    return '/';
  }

  const encodedSpace = encodeURIComponent(route.spaceName);
  const query = [`view=${normalizeView(route.view ?? null)}`];
  if (route.memoryName) {
    query.push(`memory=${encodeURIComponent(route.memoryName)}`);
  }

  return `/spaces/${encodedSpace}?${query.join('&')}`;
}

export { parseAppRoute, buildAppUrl };
