/**
 * @fileoverview ES module Web Worker for AI-RegExr regex execution.
 * Statically loads only the JavaScript engine; dynamically loads the PCRE2 WASM
 * adapter only when PCRE execution is requested.
 */

import { RegexError } from './contracts.js';
import { runJavaScript, JS_VERSION } from './engines/javascript.js';

/** @typedef {import('./contracts.js').WorkerRequest} WorkerRequest */
/** @typedef {import('./contracts.js').WorkerResponse} WorkerResponse */
/** @typedef {import('./contracts.js').ErrorKind} ErrorKind */

/** @type {DedicatedWorkerGlobalScope} */
const workerScope = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (self));

/** @type {typeof import('./engines/pcre.js') | null} */
let pcreModule = null;

/**
 * Dynamically loads the PCRE2 engine adapter on demand.
 * @returns {Promise<typeof import('./engines/pcre.js')>}
 */
async function getPcreEngine() {
    if (!pcreModule) {
        try {
            pcreModule = await import('./engines/pcre.js');
        } catch (err) {
            throw new RegexError('load', `Failed to load PCRE2 engine: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return pcreModule;
}

workerScope.onmessage = async (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') {
        return;
    }

    const { type, id } = data;
    if (typeof id !== 'number') {
        return;
    }

    if (type === 'init') {
        try {
            const engine = data.engine;
            if (engine === 'javascript') {
                /** @type {WorkerResponse} */
                const res = { type: 'ready', id, version: JS_VERSION };
                workerScope.postMessage(res);
            } else if (engine === 'pcre') {
                const pcre = await getPcreEngine();
                await pcre.getPcre2();
                /** @type {WorkerResponse} */
                const res = { type: 'ready', id, version: pcre.PCRE_VERSION };
                workerScope.postMessage(res);
            } else {
                throw new RegexError('load', `Unknown regex engine: '${engine}'`);
            }
        } catch (err) {
            const kind = (err instanceof RegexError && err.kind) ? err.kind : 'load';
            const offset = (err && typeof /** @type {any} */ (err).offset === 'number') ? /** @type {any} */ (err).offset : undefined;
            /** @type {WorkerResponse} */
            const res = {
                type: 'error',
                id,
                kind,
                message: err instanceof Error ? err.message : String(err),
                offset
            };
            workerScope.postMessage(res);
        }
        return;
    }

    if (type === 'run') {
        try {
            const snapshot = data.snapshot;
            if (!snapshot || typeof snapshot !== 'object') {
                throw new RegexError('worker', 'Invalid snapshot payload');
            }

            const { engine } = snapshot;
            /** @type {import('./contracts.js').MatchResult} */
            let result;

            if (engine === 'javascript') {
                result = runJavaScript(snapshot);
            } else if (engine === 'pcre') {
                const pcre = await getPcreEngine();
                result = await pcre.runPcre(snapshot);
            } else {
                throw new RegexError('load', `Unknown regex engine: '${engine}'`);
            }

            /** @type {WorkerResponse} */
            const res = { type: 'result', id, result };
            workerScope.postMessage(res, [result.ranges.buffer]);
        } catch (err) {
            const kind = (err instanceof RegexError && err.kind) ? err.kind : 'worker';
            const offset = (err && typeof /** @type {any} */ (err).offset === 'number') ? /** @type {any} */ (err).offset : undefined;
            /** @type {WorkerResponse} */
            const res = {
                type: 'error',
                id,
                kind,
                message: err instanceof Error ? err.message : String(err),
                offset
            };
            workerScope.postMessage(res);
        }
    }
};
