import test from 'node:test';
import assert from 'node:assert/strict';
import { BoshiamyCore } from '../js/ime/v76/core.js';

function key(core, value, options = {}) {
    const event = typeof value === 'string'
        ? { key: value, ...options }
        : { ...value, ...options };
    return core.handleKey(event);
}

function type(core, text) {
    for (const char of text) {
        const result = key(core, char);
        assert.equal(result.consume, true, `Expected radical '${char}' to be consumed`);
    }
}

// --- 7 Migrated Core Tests ---

test('overflow never falls through and leaves the last valid code selectable', () => {
    const core = new BoshiamyCore({ abcd: ['字'] });
    type(core, 'abcdabcdef');
    assert.equal(core.buffer, 'abcd');
    assert.deepEqual(core.candidates, ['字']);
    const backspaceRes = key(core, 'Backspace');
    assert.equal(backspaceRes.consume, true);
    assert.equal(core.buffer, 'abc');
    type(core, 'd');
    assert.deepEqual(core.candidates, ['字']);
});

test('dictionary replacement recalculates the boundary and cancels stale composition', () => {
    const core = new BoshiamyCore({ abcde: ['字'] });
    type(core, 'abcde');
    assert.equal(core.buffer, 'abcde');
    core.setDictionary({ ab: ['新'] });
    assert.equal(core.buffer, '');
    type(core, 'abc');
    assert.equal(core.buffer, 'ab');
    assert.deepEqual(core.candidates, ['新']);
});

test('unknown codes survive Space and Enter, and can be corrected or cancelled', () => {
    const core = new BoshiamyCore({ ab: ['字'] });
    type(core, 'az');
    for (const confirm of [' ', 'Enter']) {
        const res = key(core, confirm);
        assert.equal(res.consume, true);
        assert.equal(res.commit, null);
        assert.equal(core.buffer, 'az');
        assert.deepEqual(core.candidates, []);
        assert.ok(core.message.length > 0);
    }
    const backspaceRes = key(core, 'Backspace');
    assert.equal(backspaceRes.consume, true);
    assert.equal(core.buffer, 'a');
    type(core, 'b');
    assert.deepEqual(core.candidates, ['字']);
    const escRes = key(core, 'Escape');
    assert.equal(escRes.consume, true);
    assert.equal(core.buffer, '');
    assert.equal(core.message, '');
});

test('nonexistent candidate numbers are consumed on every candidate page', () => {
    const core = new BoshiamyCore({ a: Array.from('甲乙丙丁戊己庚辛壬癸子') });
    type(core, 'a');
    const pageDownRes = key(core, 'PageDown');
    assert.equal(pageDownRes.consume, true);
    assert.equal(core.pageIndex, 1);
    const nineRes = key(core, '9');
    assert.equal(nineRes.consume, true);
    assert.equal(nineRes.commit, null);
    assert.equal(core.buffer, 'a');
    assert.equal(core.pageIndex, 1);
    assert.ok(core.message.length > 0);
    const escRes = key(core, 'Escape');
    assert.equal(escRes.consume, true);
    assert.equal(core.buffer, '');
    type(core, 'z');
    const zeroRes = key(core, '0');
    assert.equal(zeroRes.consume, true);
    assert.equal(zeroRes.commit, null);
    assert.equal(core.buffer, 'z');
});

test('Shift and symbol radicals remain dictionary codes, not direct text', () => {
    const core = new BoshiamyCore({ 'a,': ['字'], '[': ['「'] });
    const shiftARes = key(core, 'A', { shiftKey: true });
    assert.equal(shiftARes.consume, true);
    type(core, ',');
    assert.equal(core.buffer, 'a,');
    assert.deepEqual(core.candidates, ['字']);
    key(core, 'Escape');
    type(core, '[');
    assert.deepEqual(core.candidates, ['「']);
});

test('native composition is not intercepted and stale web radicals are cleared', () => {
    const core = new BoshiamyCore({ a: ['字'] });
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
        type(core, 'a');
        const res = key(core, 'a', flags);
        assert.equal(res.consume, false);
        assert.equal(core.buffer, '');
    }
    // Direct reset clears composition cleanly
    type(core, 'a');
    assert.equal(core.buffer, 'a');
    core.reset();
    assert.equal(core.buffer, '');
    type(core, 'a');
    assert.equal(core.buffer, 'a');
});

test('disabled mode and shortcuts retain browser handling', () => {
    const core = new BoshiamyCore({ a: ['字'] });
    // Shortcuts when buffer is active cancel pending composition and pass through
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
        type(core, 'a');
        const res = key(core, 'c', { [modifier]: true });
        assert.equal(res.consume, false);
        assert.equal(core.buffer, '');
    }
    // When buffer is empty, Enter and candidate digits are not consumed
    assert.equal(key(core, 'Enter').consume, false);
    assert.equal(key(core, '9').consume, false);
    assert.equal(key(core, 'ArrowDown').consume, false);
});

// --- Additional Meaningful Transition and Boundary Tests ---

test('candidate page navigation boundary clamping consumes keys without wrapping', () => {
    // 12 candidates => page 0 (10 items), page 1 (2 items)
    const core = new BoshiamyCore({ a: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B'] });
    type(core, 'a');
    assert.equal(core.pageIndex, 0);

    // Moving up at page 0 must stay at page 0 and consume the key (do not move editor cursor)
    const upRes = key(core, 'ArrowUp');
    assert.equal(upRes.consume, true);
    assert.equal(core.pageIndex, 0);

    const pageUpRes = key(core, 'PageUp');
    assert.equal(pageUpRes.consume, true);
    assert.equal(core.pageIndex, 0);

    // Move to next page
    const downRes = key(core, 'ArrowDown');
    assert.equal(downRes.consume, true);
    assert.equal(core.pageIndex, 1);

    // Moving down at last page must stay at last page and consume the key
    const pageDownRes = key(core, 'PageDown');
    assert.equal(pageDownRes.consume, true);
    assert.equal(core.pageIndex, 1);

    const downRes2 = key(core, 'ArrowDown');
    assert.equal(downRes2.consume, true);
    assert.equal(core.pageIndex, 1);

    // Verify candidate() method behavior across boundaries
    assert.equal(core.candidate(0), 'A');
    assert.equal(core.candidate(1), 'B');
    assert.equal(core.candidate(2), null);
    assert.equal(core.candidate(9), null);
});

test('candidate selection returns a commit proposal while retaining pending composition', () => {
    const core = new BoshiamyCore({ a: ['第一', '第二'] });
    type(core, 'a');

    // Selection by Space commits candidate 0
    const spaceRes = key(core, ' ');
    assert.equal(spaceRes.consume, true);
    assert.equal(spaceRes.commit, '第一');

    // The controller owns the native insertion transaction and composition reset.
    assert.equal(core.buffer, 'a');
    assert.deepEqual(core.candidates, ['第一', '第二']);
});

test('direct select(index) validates candidate slot boundaries and error messaging', () => {
    const core = new BoshiamyCore({ a: ['零', '一'] });
    type(core, 'a');

    // Valid slot returns candidate commit without clearing buffer (host manages commit lifecycle)
    const selectRes = core.select(1);
    assert.equal(selectRes.consume, true);
    assert.equal(selectRes.commit, '一');
    assert.equal(core.buffer, 'a');
    assert.deepEqual(core.candidates, ['零', '一']);

    // Out of range slot sets error message and does not commit
    const invalidRes = core.select(5);
    assert.equal(invalidRes.consume, true);
    assert.equal(invalidRes.commit, null);
    assert.equal(core.message, '無此候選編號，請重新選字');
    assert.equal(core.buffer, 'a');
});

test('invalid code transition: error message set, Backspace recovers, Escape cancels', () => {
    const core = new BoshiamyCore({ a: ['對'], ab: ['新'] });
    type(core, 'a');
    assert.deepEqual(core.candidates, ['對']);
    assert.equal(core.message, '');

    // Type 'x' -> 'ax' is not in dictionary
    type(core, 'x');
    assert.equal(core.buffer, 'ax');
    assert.deepEqual(core.candidates, []);

    // Space on invalid code sets error message
    const spaceRes = key(core, ' ');
    assert.equal(spaceRes.consume, true);
    assert.equal(spaceRes.commit, null);
    assert.ok(core.message.length > 0);

    // Backspace to 'a' recovers candidate list and clears error message
    const bs1 = key(core, 'Backspace');
    assert.equal(bs1.consume, true);
    assert.equal(core.buffer, 'a');
    assert.deepEqual(core.candidates, ['對']);
    assert.equal(core.message, '');

    // Typing 'b' reaches 'ab'
    type(core, 'b');
    assert.equal(core.buffer, 'ab');
    assert.deepEqual(core.candidates, ['新']);
});

test('pending plain Undo vs shortcuts: pending radicals cancel cleanly', () => {
    const core = new BoshiamyCore({ a: ['對'] });
    type(core, 'a');
    assert.equal(core.buffer, 'a');

    // Ctrl+Z while buffer is pending: core handleKey consumes and resets pending composition
    const ctrlZRes = key(core, 'z', { ctrlKey: true });
    assert.equal(ctrlZRes.consume, true);
    assert.equal(ctrlZRes.commit, null);
    assert.equal(core.buffer, '');

    // Other shortcuts (e.g. Ctrl+C) with pending buffer reset buffer and pass through (consume: false)
    type(core, 'a');
    assert.equal(core.buffer, 'a');
    const ctrlCRes = key(core, 'c', { ctrlKey: true });
    assert.equal(ctrlCRes.consume, false);
    assert.equal(core.buffer, '');

    // Resetting when already empty remains empty
    core.reset();
    assert.equal(core.buffer, '');
});

test('standalone modifier keydowns preserve active composition until shortcut key fires', () => {
    const core = new BoshiamyCore({ a: ['對'] });
    type(core, 'a');
    assert.equal(core.buffer, 'a');

    // Physical keydown sequence: user presses Control/Meta/Shift/Alt key first
    for (const modKey of ['Control', 'Shift', 'Alt', 'Meta']) {
        const modRes = key(core, modKey, { ctrlKey: modKey === 'Control', shiftKey: modKey === 'Shift', altKey: modKey === 'Alt', metaKey: modKey === 'Meta' });
        assert.equal(modRes.consume, false);
        assert.equal(modRes.commit, null);
        assert.equal(core.buffer, 'a', `Pending buffer must be preserved when pressing ${modKey}`);
    }

    // Subsequent 'z' with ctrlKey consumes and cancels pending composition
    const undoRes = key(core, 'z', { ctrlKey: true });
    assert.equal(undoRes.consume, true);
    assert.equal(undoRes.commit, null);
    assert.equal(core.buffer, '');

    // Meta+Z on macOS also consumes and cancels pending composition
    type(core, 'a');
    const metaDownRes = key(core, 'Meta', { metaKey: true });
    assert.equal(metaDownRes.consume, false);
    assert.equal(core.buffer, 'a');
    const metaUndoRes = key(core, 'z', { metaKey: true });
    assert.equal(metaUndoRes.consume, true);
    assert.equal(core.buffer, '');
});
