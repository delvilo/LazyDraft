/**
 * @fileoverview Behavior tests for RegexRunner lifecycle, timeouts, cancellation,
 * error handling, and worker generation isolation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { RegexRunner } from '../ai-regexr/js/runner.js';
import { RegexError } from '../ai-regexr/js/contracts.js';

/**
 * Deterministic MockWorker simulating Web Worker messaging.
 */
class MockWorker {
    constructor() {
        /** @type {boolean} */
        this.terminated = false;
        /** @type {any[]} */
        this.postedMessages = [];
        /** @type {((event: any) => void) | null} */
        this.onmessage = null;
        /** @type {((event: any) => void) | null} */
        this.onerror = null;
        /** @type {((event: any) => void) | null} */
        this.onmessageerror = null;
    }

    /** @param {any} message */
    postMessage(message) {
        this.postedMessages.push(message);
    }

    terminate() {
        this.terminated = true;
    }

    /** @param {any} data */
    emitMessage(data) {
        if (!this.terminated && this.onmessage) {
            this.onmessage({ data });
        }
    }

    /** @param {string} message */
    emitError(message) {
        if (!this.terminated && this.onerror) {
            this.onerror({ message });
        }
    }

    emitMessageError() {
        if (!this.terminated && this.onmessageerror) {
            this.onmessageerror({});
        }
    }
}

test('initialization lifecycle: loading -> ready -> running -> result', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    /** @type {string[]} */
    const phases = [];

    const runner = new RegexRunner(phase => phases.push(phase), {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'javascript', pattern: 'hello', flags: 'g', text: 'hello world' });

    assert.equal(workers.length, 1);
    const worker = workers[0];
    assert.deepEqual(phases, ['loading']);
    assert.equal(worker.postedMessages.length, 1);
    assert.equal(worker.postedMessages[0].type, 'init');

    const initId = worker.postedMessages[0].id;
    worker.emitMessage({ type: 'ready', id: initId, version: 'JS-1.0' });

    assert.deepEqual(phases, ['loading', 'running']);
    assert.equal(worker.postedMessages.length, 2);
    assert.equal(worker.postedMessages[1].type, 'run');

    const runId = worker.postedMessages[1].id;
    /** @type {import('../ai-regexr/js/contracts.js').MatchResult} */
    const mockResult = { totalMatches: 1, ranges: new Uint32Array([0, 5]), executionMs: 1.2, version: 'JS-1.0' };
    worker.emitMessage({ type: 'result', id: runId, result: mockResult });

    const result = await runPromise;
    assert.deepEqual(result, mockResult);
    assert.equal(worker.terminated, false);
});

test('idle worker reuse: same engine reuses ready worker and skips loading phase', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    /** @type {string[]} */
    const phases = [];

    const runner = new RegexRunner(phase => phases.push(phase), {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const run1 = runner.run({ engine: 'javascript', pattern: 'a', flags: 'g', text: 'a' });
    const w = workers[0];
    w.emitMessage({ type: 'ready', id: w.postedMessages[0].id, version: 'v1' });
    w.emitMessage({
        type: 'result',
        id: w.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });
    await run1;

    phases.length = 0;
    const run2 = runner.run({ engine: 'javascript', pattern: 'b', flags: 'g', text: 'b' });

    assert.equal(workers.length, 1);
    assert.deepEqual(phases, ['running']);
    assert.equal(w.postedMessages.length, 3);
    assert.equal(w.postedMessages[2].type, 'run');

    w.emitMessage({
        type: 'result',
        id: w.postedMessages[2].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });
    const res2 = await run2;
    assert.equal(res2.totalMatches, 1);
});

test('switching engine terminates old worker and initializes fresh worker', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    /** @type {string[]} */
    const phases = [];

    const runner = new RegexRunner(phase => phases.push(phase), {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const run1 = runner.run({ engine: 'javascript', pattern: 'a', flags: 'g', text: 'a' });
    const w1 = workers[0];
    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'JS-1' });
    w1.emitMessage({
        type: 'result',
        id: w1.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'JS-1' }
    });
    await run1;

    phases.length = 0;
    const run2 = runner.run({ engine: 'pcre', pattern: '(?<=x)a', flags: 'g', text: 'xa' });

    assert.equal(w1.terminated, true);
    assert.equal(workers.length, 2);

    const w2 = workers[1];
    assert.deepEqual(phases, ['loading']);
    assert.equal(w2.postedMessages[0].type, 'init');
    assert.equal(w2.postedMessages[0].engine, 'pcre');

    w2.emitMessage({ type: 'ready', id: w2.postedMessages[0].id, version: 'PCRE-10.49' });
    assert.deepEqual(phases, ['loading', 'running']);

    w2.emitMessage({
        type: 'result',
        id: w2.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([1, 2]), executionMs: 2, version: 'PCRE-10.49' }
    });
    const res2 = await run2;
    assert.equal(res2.version, 'PCRE-10.49');
});

test('cancel during loading phase invalidates promise, terminates worker, and subsequent job recovers', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'pcre', pattern: 'foo', flags: '', text: 'foo' });
    const w1 = workers[0];
    assert.equal(w1.terminated, false);

    runner.cancel();

    await assert.rejects(runPromise, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'cancelled');
        return true;
    });

    assert.equal(w1.terminated, true);

    // Subsequent job recovers with fresh worker
    const run2 = runner.run({ engine: 'pcre', pattern: 'bar', flags: '', text: 'bar' });
    assert.equal(workers.length, 2);
    const w2 = workers[1];
    w2.emitMessage({ type: 'ready', id: w2.postedMessages[0].id, version: 'v1' });
    w2.emitMessage({
        type: 'result',
        id: w2.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 3]), executionMs: 1, version: 'v1' }
    });
    const res2 = await run2;
    assert.equal(res2.totalMatches, 1);
});

test('cancel during running phase terminates busy worker', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'javascript', pattern: 'foo', flags: '', text: 'foo' });
    const w1 = workers[0];
    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'v1' });

    assert.equal(w1.postedMessages[1].type, 'run');
    runner.cancel();

    await assert.rejects(runPromise, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'cancelled');
        return true;
    });

    assert.equal(w1.terminated, true);
});

test('overlapping run supersedes prior run immediately without queue', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const p1 = runner.run({ engine: 'javascript', pattern: 'first', flags: '', text: 'first' });
    const w1 = workers[0];
    assert.equal(w1.terminated, false);

    // Prior run is immediately cancelled when second run arrives
    const p2 = runner.run({ engine: 'javascript', pattern: 'second', flags: '', text: 'second' });

    await assert.rejects(p1, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'cancelled');
        return true;
    });

    assert.equal(w1.terminated, true);
    assert.equal(workers.length, 2);

    const w2 = workers[1];
    w2.emitMessage({ type: 'ready', id: w2.postedMessages[0].id, version: 'v1' });
    w2.emitMessage({
        type: 'result',
        id: w2.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 6]), executionMs: 1, version: 'v1' }
    });
    const res2 = await p2;
    assert.equal(res2.totalMatches, 1);
});

test('cancel when idle does not terminate ready worker', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const p1 = runner.run({ engine: 'javascript', pattern: '1', flags: '', text: '1' });
    const w1 = workers[0];
    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'v1' });
    w1.emitMessage({
        type: 'result',
        id: w1.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });
    await p1;

    // Worker is idle now
    runner.cancel();
    assert.equal(w1.terminated, false);

    const p2 = runner.run({ engine: 'javascript', pattern: '2', flags: '', text: '2' });
    assert.equal(workers.length, 1);
    w1.emitMessage({
        type: 'result',
        id: w1.postedMessages[2].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });
    const res2 = await p2;
    assert.equal(res2.totalMatches, 1);
});

test('hard load timeout terminates worker and rejects with load error', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        loadTimeoutMs: 20,
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'pcre', pattern: 'a', flags: '', text: 'a' });
    const w1 = workers[0];

    await assert.rejects(runPromise, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'load');
        return true;
    });

    assert.equal(w1.terminated, true);

    const run2 = runner.run({ engine: 'pcre', pattern: 'a', flags: '', text: 'a' });
    assert.equal(workers.length, 2);
    const w2 = workers[1];
    w2.emitMessage({ type: 'ready', id: w2.postedMessages[0].id, version: 'v1' });
    w2.emitMessage({
        type: 'result',
        id: w2.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });
    const res2 = await run2;
    assert.equal(res2.totalMatches, 1);
});

test('hard match timeout kills pathological execution and subsequent job succeeds', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        matchTimeoutMs: 25,
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'javascript', pattern: '(a+)+$', flags: '', text: 'aaaaaaaaaaaaaaaaaaaa!' });
    const w1 = workers[0];
    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'v1' });

    await assert.rejects(runPromise, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'timeout');
        return true;
    });

    assert.equal(w1.terminated, true);

    const run2 = runner.run({ engine: 'javascript', pattern: 'a', flags: '', text: 'a' });
    assert.equal(workers.length, 2);
    const w2 = workers[1];
    w2.emitMessage({ type: 'ready', id: w2.postedMessages[0].id, version: 'v1' });
    w2.emitMessage({
        type: 'result',
        id: w2.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });
    const res2 = await run2;
    assert.equal(res2.totalMatches, 1);
});

test('match deadline starts after init ready, not during loading', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        loadTimeoutMs: 200,
        matchTimeoutMs: 40,
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'pcre', pattern: 'x', flags: '', text: 'x' });
    const w1 = workers[0];

    await new Promise(r => setTimeout(r, 50));
    assert.equal(w1.terminated, false);

    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'v1' });
    w1.emitMessage({
        type: 'result',
        id: w1.postedMessages[1].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' }
    });

    const res = await runPromise;
    assert.equal(res.totalMatches, 1);
    assert.equal(w1.terminated, false);
});

test('worker transport error rejects with worker kind (not syntax) and terminates worker', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'javascript', pattern: 'foo', flags: '', text: 'foo' });
    const w1 = workers[0];
    w1.emitError('Script error: out of memory');

    await assert.rejects(runPromise, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'worker');
        assert.notEqual(err.kind, 'syntax');
        return true;
    });

    assert.equal(w1.terminated, true);
});

test('worker syntax error rejects with syntax kind and preserves worker for reuse', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const runPromise = runner.run({ engine: 'javascript', pattern: '(unclosed', flags: '', text: 'text' });
    const w1 = workers[0];
    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'v1' });
    w1.emitMessage({
        type: 'error',
        id: w1.postedMessages[1].id,
        kind: 'syntax',
        message: 'Invalid regular expression: unclosed group',
        offset: 0
    });

    await assert.rejects(runPromise, (/** @type {any} */ err) => {
        assert.ok(err instanceof RegexError);
        assert.equal(err.kind, 'syntax');
        assert.equal(err.offset, 0);
        return true;
    });

    assert.equal(w1.terminated, false);

    const run2 = runner.run({ engine: 'javascript', pattern: 'closed', flags: '', text: 'closed' });
    assert.equal(workers.length, 1);
    w1.emitMessage({
        type: 'result',
        id: w1.postedMessages[2].id,
        result: { totalMatches: 1, ranges: new Uint32Array([0, 6]), executionMs: 1, version: 'v1' }
    });
    const res2 = await run2;
    assert.equal(res2.totalMatches, 1);
});

test('stale callbacks and messages from old generations or idle state are safely ignored', async () => {
    /** @type {MockWorker[]} */
    const workers = [];
    const runner = new RegexRunner(undefined, {
        workerFactory: () => {
            const w = new MockWorker();
            workers.push(w);
            return /** @type {any} */ (w);
        }
    });

    const run1 = runner.run({ engine: 'javascript', pattern: 'a', flags: '', text: 'a' });
    const w1 = workers[0];

    // Emit mismatched request ID
    w1.emitMessage({ type: 'ready', id: 9999, version: 'fake' });
    assert.equal(w1.postedMessages.length, 1);

    // Legitimate ready and result
    w1.emitMessage({ type: 'ready', id: w1.postedMessages[0].id, version: 'v1' });
    const runId = w1.postedMessages[1].id;

    w1.emitMessage({ type: 'result', id: 9998, result: { totalMatches: 99, ranges: new Uint32Array([]), executionMs: 0, version: 'fake' } });
    w1.emitMessage({ type: 'result', id: runId, result: { totalMatches: 1, ranges: new Uint32Array([0, 1]), executionMs: 1, version: 'v1' } });
    const res1 = await run1;
    assert.equal(res1.totalMatches, 1);

    // Idle messages
    w1.emitMessage({ type: 'ready', id: 1, version: 'stale' });
    w1.emitMessage({ type: 'result', id: 1, result: null });
    w1.emitMessage({ type: 'error', id: 1, kind: 'worker', message: 'stale' });
});

test('run rejects invalid snapshot with TypeError', async () => {
    const runner = new RegexRunner();
    // @ts-expect-error testing invalid input
    await assert.rejects(runner.run(null), TypeError);
    // @ts-expect-error testing invalid input
    await assert.rejects(runner.run({}), TypeError);
});
