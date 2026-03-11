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
};
