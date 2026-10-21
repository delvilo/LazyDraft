/** @typedef {'javascript' | 'pcre'} Engine */
/** @typedef {'load' | 'syntax' | 'flags' | 'timeout' | 'worker' | 'cancelled' | 'memory' | 'input'} ErrorKind */
/** @typedef {{engine: Engine, pattern: string, flags: string, text: string}} Snapshot */
/** @typedef {{totalMatches: number, ranges: Uint32Array, executionMs: number, version: string, projected?: boolean}} MatchResult */
/** @typedef {{type: 'init', id: number, engine: Engine} | {type: 'run', id: number, snapshot: Snapshot}} WorkerRequest */
/** @typedef {{type: 'ready', id: number, version: string} | {type: 'result', id: number, result: MatchResult} | {type: 'error', id: number, kind: ErrorKind, message: string, offset?: number}} WorkerResponse */

export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_HIGHLIGHTS = 10000;
export const DEBOUNCE_MS = 300;
export const MATCH_TIMEOUT_MS = 3000;
export const LOAD_TIMEOUT_MS = 15000;

export class RegexError extends Error {
    /** @param {ErrorKind} kind @param {string} message @param {number} [offset] */
    constructor(kind, message, offset) {
        super(message);
        this.name = 'RegexError';
        this.kind = kind;
        this.offset = offset;
    }
}
