// @ts-check

/**
 * @template T
 * @param {Response} response
 * @returns {Promise<T>}
 */
async function parseResponse(response) {
    if (!response.ok) {
        const payload = /** @type {{ error?: string }} */ (await response.json());
        throw new Error(payload.error ?? response.statusText);
    }

    return /** @type {Promise<T>} */ (response.json());
}

export const api = {
    /** @template T @param {string} path @returns {Promise<T>} */
    async get(path) {
        return parseResponse(await fetch(path));
    },

    /** @template T @param {string} path @param {unknown} body @returns {Promise<T>} */
    async post(path, body) {
        return parseResponse(
            await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
        );
    },

    /** @template T @param {string} path @param {unknown} body @returns {Promise<T>} */
    async patch(path, body) {
        return parseResponse(
            await fetch(path, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
        );
    },

    /** @template T @param {string} path @returns {Promise<T>} */
    async del(path) {
        return parseResponse(await fetch(path, { method: 'DELETE' }));
    },

    // Logs API
    /** @param {{source?: string, operation?: string, search?: string, from?: string, to?: string, level?: string, limit?: number, offset?: number, order?: string, since?: number}} filter @returns {Promise<{logs: any[], total: number, limit: number, offset: number}>} */
    async getLogs(filter = {}) {
        const params = new URLSearchParams();
        if (filter.source) params.set('source', filter.source);
        if (filter.operation) params.set('operation', filter.operation);
        if (filter.search) params.set('search', filter.search);
        if (filter.from) params.set('from', filter.from);
        if (filter.to) params.set('to', filter.to);
        if (filter.level) params.set('level', filter.level);
        if (filter.limit) params.set('limit', String(filter.limit));
        if (filter.offset) params.set('offset', String(filter.offset));
        if (filter.order) params.set('order', filter.order);
        if (filter.since) params.set('since', String(filter.since));
        
        return parseResponse(await fetch(`/api/logs?${params}`));
    },
};
