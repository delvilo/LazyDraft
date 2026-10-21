/**
 * @fileoverview Worker lifecycle and execution runner for AI-RegExr regex matching.
 */

import { RegexError, MATCH_TIMEOUT_MS, LOAD_TIMEOUT_MS } from './contracts.js';

/** @typedef {import('./contracts.js').Engine} Engine */
/** @typedef {import('./contracts.js').Snapshot} Snapshot */
/** @typedef {import('./contracts.js').MatchResult} MatchResult */
/** @typedef {import('./contracts.js').WorkerRequest} WorkerRequest */
/** @typedef {import('./contracts.js').WorkerResponse} WorkerResponse */

/** @typedef {'idle' | 'loading' | 'running'} RunnerPhase */

/**
 * @typedef {Object} RunnerOptions
 * @property {() => Worker} [workerFactory] Factory function returning a Worker instance.
 * @property {number} [matchTimeoutMs] Hard match timeout in milliseconds.
 * @property {number} [loadTimeoutMs] Engine initialization timeout in milliseconds.
 */

/**
 * @typedef {Object} ActiveJob
 * @property {number} id
 * @property {Snapshot} snapshot
 * @property {(result: MatchResult) => void} resolve
 * @property {(reason: any) => void} reject
 */

export class RegexRunner {
    /** @type {((phase: 'loading' | 'running') => void) | undefined} */
    #onPhase;
    /** @type {() => Worker} */
    #workerFactory;
    /** @type {number} */
    #matchTimeoutMs;
    /** @type {number} */
    #loadTimeoutMs;

    /** @type {Worker | null} */
    #worker = null;
    /** @type {number} */
    #workerGen = 0;
    /** @type {Engine | null} */
    #engine = null;
    /** @type {RunnerPhase} */
    #phase = 'idle';

    /** @type {ReturnType<typeof setTimeout> | null} */
    #timer = null;
    /** @type {number} */
    #nextId = 0;
    /** @type {ActiveJob | null} */
    #activeJob = null;

    /**
     * @param {((phase: 'loading' | 'running') => void)} [onPhase] Callback reporting current execution phase.
     * @param {RunnerOptions} [options] Optional dependency injection options for testing.
     */
    constructor(onPhase, options = {}) {
        this.#onPhase = typeof onPhase === 'function' ? onPhase : undefined;
        this.#workerFactory = options.workerFactory ?? (() => new Worker(new URL('./regex-worker.js', import.meta.url), { type: 'module' }));
        this.#matchTimeoutMs = typeof options.matchTimeoutMs === 'number' && options.matchTimeoutMs > 0 ? options.matchTimeoutMs : MATCH_TIMEOUT_MS;
        this.#loadTimeoutMs = typeof options.loadTimeoutMs === 'number' && options.loadTimeoutMs > 0 ? options.loadTimeoutMs : LOAD_TIMEOUT_MS;
    }

    /**
     * Executes regex matching for given snapshot, cancelling any previous active job.
     * @param {Snapshot} snapshot
     * @returns {Promise<MatchResult>}
     */
    run(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.engine !== 'string') {
            return Promise.reject(new TypeError('Invalid snapshot'));
        }

        // Cancel previous active job
        this.cancel();

        return new Promise((resolve, reject) => {
            const id = ++this.#nextId;
            const job = { id, snapshot, resolve, reject };
            this.#activeJob = job;

            // Reuse ready idle worker if engine matches
            if (this.#worker && this.#engine === snapshot.engine) {
                this.#dispatchRun(job);
                return;
            }

            // Engine switch or first run: terminate prior worker and initialize fresh
            this.#terminateWorker();

            let worker;
            try {
                worker = this.#workerFactory();
            } catch (err) {
                this.#fail(new RegexError('worker', err instanceof Error ? err.message : String(err)), true);
                return;
            }

            const gen = ++this.#workerGen;
            this.#worker = worker;
            this.#phase = 'loading';
            this.#onPhase?.('loading');

            worker.onmessage = (e) => this.#onMessage(gen, e);
            worker.onerror = (e) => this.#onError(gen, e);
            worker.onmessageerror = () => this.#onError(gen, new Error('Worker message deserialization failed'));

            this.#setTimer(this.#loadTimeoutMs, () => {
                this.#fail(new RegexError('load', 'Engine initialization timed out'), true);
            });

            try {
                /** @type {WorkerRequest} */
                const req = { type: 'init', id: job.id, engine: snapshot.engine };
                worker.postMessage(req);
            } catch (err) {
                this.#fail(new RegexError('worker', err instanceof Error ? err.message : String(err)), true);
            }
        });
    }

    /**
     * Cancels any active matching job and terminates busy worker.
     */
    cancel() {
        if (!this.#activeJob) return;
        this.#fail(new RegexError('cancelled', 'Operation cancelled'), true);
    }

    /**
     * Dispatches run request to worker and arms match timeout.
     * @param {ActiveJob} job
     */
    #dispatchRun(job) {
        this.#clearTimer();
        this.#phase = 'running';
        this.#onPhase?.('running');

        this.#setTimer(this.#matchTimeoutMs, () => {
            this.#fail(new RegexError('timeout', 'Regex match timed out'), true);
        });

        try {
            /** @type {WorkerRequest} */
            const req = { type: 'run', id: job.id, snapshot: job.snapshot };
            this.#worker?.postMessage(req);
        } catch (err) {
            this.#fail(new RegexError('worker', err instanceof Error ? err.message : String(err)), true);
        }
    }

    /**
     * @param {number} gen
     * @param {MessageEvent} event
     */
    #onMessage(gen, event) {
        if (gen !== this.#workerGen) return;

        const data = event?.data;
        if (!data || typeof data !== 'object') {
            if (this.#activeJob) {
                this.#fail(new RegexError('worker', 'Malformed worker message'), true);
            }
            return;
        }

        // Discard stale messages or callbacks not matching active job
        if (!this.#activeJob || data.id !== this.#activeJob.id) return;

        const job = this.#activeJob;

        if (this.#phase === 'loading') {
            if (data.type === 'ready') {
                this.#engine = job.snapshot.engine;
                this.#dispatchRun(job);
            } else if (data.type === 'error') {
                this.#fail(new RegexError(data.kind || 'load', data.message || 'Engine load failed', data.offset), true);
            } else {
                this.#fail(new RegexError('worker', `Unexpected message type during init: ${data.type}`), true);
            }
            return;
        }

        if (this.#phase === 'running') {
            if (data.type === 'result') {
                this.#clearTimer();
                this.#activeJob = null;
                this.#phase = 'idle';
                job.resolve(data.result);
            } else if (data.type === 'error') {
                const kind = data.kind || 'worker';
                const err = new RegexError(kind, data.message || 'Regex matching error', data.offset);
                // Syntax and flags errors keep worker alive for reuse; others terminate
                const shouldTerminate = kind !== 'syntax' && kind !== 'flags';
                this.#fail(err, shouldTerminate);
            } else {
                this.#fail(new RegexError('worker', `Unexpected message type during run: ${data.type}`));
            }
        }
    }

    /**
     * @param {number} gen
     * @param {any} event
     */
    #onError(gen, event) {
        if (gen !== this.#workerGen) return;
        const msg = (event && typeof event.message === 'string' && event.message) || 'Worker error';
        this.#fail(new RegexError('worker', msg), true);
    }

    /**
     * Cleans up timer, optionally terminates worker, and rejects active job.
     * @param {RegexError} error
     * @param {boolean} [terminateWorker=true]
     */
    #fail(error, terminateWorker = true) {
        this.#clearTimer();
        const job = this.#activeJob;
        this.#activeJob = null;
        this.#phase = 'idle';

        if (terminateWorker) {
            this.#terminateWorker();
        }

        job?.reject(error);
    }

    /**
     * @param {number} ms
     * @param {() => void} fn
     */
    #setTimer(ms, fn) {
        this.#clearTimer();
        this.#timer = setTimeout(fn, ms);
    }

    #clearTimer() {
        if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }

    #terminateWorker() {
        this.#clearTimer();
        if (this.#worker) {
            try {
                this.#worker.terminate();
            } catch {
                // Ignore termination errors
            }
            this.#worker = null;
        }
        this.#workerGen++;
        this.#engine = null;
        this.#phase = 'idle';
    }
}
