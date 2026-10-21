/**
 * @fileoverview Behavior tests for AI-RegExr JavaScript and PCRE2 engine adapters.
 * Designed to be executed by parent test suite runner (`node --test tests/*.test.*`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runJavaScript } from '../ai-regexr/js/engines/javascript.js';
import { runPcre, getPcre2 } from '../ai-regexr/js/engines/pcre.js';
import { validateFlags } from '../ai-regexr/js/pattern.js';
import { RegexError } from '../ai-regexr/js/contracts.js';

test('JavaScript Engine: basic global and non-global matches', () => {
    // Non-global match
    const single = runJavaScript({
        engine: 'javascript',
        pattern: '\\d+',
        flags: '',
        text: 'items 42 and 99'
    });
    assert.equal(single.totalMatches, 1);
    assert.equal(single.ranges.length, 2);
    assert.equal(single.ranges[0], 6);
    assert.equal(single.ranges[1], 8);
    assert.match(single.version, /JavaScript/);

    // Global match
    const multi = runJavaScript({
        engine: 'javascript',
        pattern: '\\d+',
        flags: 'g',
        text: 'items 42 and 99'
    });
    assert.equal(multi.totalMatches, 2);
    assert.equal(multi.ranges.length, 4);
    assert.equal(multi.ranges[0], 6);
    assert.equal(multi.ranges[1], 8);
    assert.equal(multi.ranges[2], 13);
    assert.equal(multi.ranges[3], 15);
});

test('JavaScript Engine: zero-length match progression with Unicode astral characters', () => {
    const text = 'a🚀b';
    const res = runJavaScript({
        engine: 'javascript',
        pattern: '🚀|',
        flags: 'gu',
        text
    });
    assert.equal(res.totalMatches, 4);
    assert.equal(res.ranges[0], 0);
    assert.equal(res.ranges[1], 0);
    assert.equal(res.ranges[2], 1);
    assert.equal(res.ranges[3], 3); // '🚀' takes 2 UTF-16 code units (1..3)
    assert.equal(res.ranges[4], 3);
    assert.equal(res.ranges[5], 3);
    assert.equal(res.ranges[6], 4);
    assert.equal(res.ranges[7], 4);
});

test('JavaScript Engine: strict flag validation and lone surrogate native support', () => {
    assert.throws(() => validateFlags('gx', 'javascript'), (err) => err instanceof RegexError && err.kind === 'flags');
    assert.throws(() => validateFlags('gg', 'javascript'), (err) => err instanceof RegexError && err.kind === 'flags');

    // Native JS RegExp legitimately matches lone surrogates without error
    const match = runJavaScript({
        engine: 'javascript',
        pattern: '\\uD800',
        flags: 'g',
        text: 'unpaired \uD800 surrogate'
    });
    assert.equal(match.totalMatches, 1);
    assert.equal(match.ranges[0], 9);
    assert.equal(match.ranges[1], 10);
});

test('PCRE2 Engine: initialization and version metadata', async () => {
    const pcre2 = await getPcre2();
    assert.ok(pcre2, 'PCRE2 instance loaded');

    const res = await runPcre({
        engine: 'pcre',
        pattern: 'test',
        flags: 'i',
        text: 'TESTING'
    });
    assert.equal(res.totalMatches, 1);
    assert.equal(res.ranges[0], 0);
    assert.equal(res.ranges[1], 4);
    assert.match(res.version, /PCRE2 10\.49/);
});

test('PCRE2 Engine: empty-match retry non-empty alternative at same offset', async () => {
    // (?=a)|a on "a" must yield empty match at 0, then non-empty 'a' at 0
    const res = await runPcre({
        engine: 'pcre',
        pattern: '(?=a)|a',
        flags: 'gu',
        text: 'a'
    });
    assert.equal(res.totalMatches, 2);
    assert.equal(res.ranges.length, 4);
    assert.equal(res.ranges[0], 0);
    assert.equal(res.ranges[1], 0);
    assert.equal(res.ranges[2], 0);
    assert.equal(res.ranges[3], 1);
});
test('PCRE2 Engine: regression $ on nonempty text', async () => {
    const res = await runPcre({
        engine: 'pcre',
        pattern: '$',
        flags: 'g',
        text: 'ab'
    });
    assert.equal(res.totalMatches, 1);
    assert.equal(res.ranges.length, 2);
    assert.equal(res.ranges[0], 2);
    assert.equal(res.ranges[1], 2);
});

test('PCRE2 Engine: regression (?=b) on "ab"', async () => {
    const res = await runPcre({
        engine: 'pcre',
        pattern: '(?=b)',
        flags: 'g',
        text: 'ab'
    });
    assert.equal(res.totalMatches, 1);
    assert.equal(res.ranges.length, 2);
    assert.equal(res.ranges[0], 1);
    assert.equal(res.ranges[1], 1);
});

test('PCRE2 Engine: byte-mode projection on multi-byte codepoints', async () => {
    const text = '中😀';
    const res = await runPcre({
        engine: 'pcre',
        pattern: '.',
        flags: 'g',
        text
    });
    assert.equal(res.totalMatches, 7);
    assert.equal(res.projected, true);
    for (let i = 0; i < res.ranges.length; i += 2) {
        const s = res.ranges[i];
        const e = res.ranges[i + 1];
        assert.ok(s <= e);
        if (s === 1) assert.equal(e, 3);
    }
});


test('PCRE2 Engine: astral code points and Chinese character UTF-16 DOM offset alignment', async () => {
    const text = 'Hello 🚀 world 你好 𝄞!';
    const res = await runPcre({
        engine: 'pcre',
        pattern: '🚀|你好|𝄞',
        flags: 'gu',
        text
    });
    assert.equal(res.totalMatches, 3);
    assert.equal(res.ranges.length, 6);

    // 🚀
    assert.equal(res.ranges[0], 6);
    assert.equal(res.ranges[1], 8);
    assert.equal(text.substring(res.ranges[0], res.ranges[1]), '🚀');

    // 你好
    assert.equal(res.ranges[2], 15);
    assert.equal(res.ranges[3], 17);
    assert.equal(text.substring(res.ranges[2], res.ranges[3]), '你好');

    // 𝄞
    assert.equal(res.ranges[4], 18);
    assert.equal(res.ranges[5], 20);
    assert.equal(text.substring(res.ranges[4], res.ranges[5]), '𝄞');
});

test('PCRE2 Engine: extended flag x comments and whitespace', async () => {
    const pattern = `
        \\d+   # Match digits
        \\s+   # Match space
        \\w+   # Match word
    `;
    const res = await runPcre({
        engine: 'pcre',
        pattern,
        flags: 'x',
        text: '123 abc'
    });
    assert.equal(res.totalMatches, 1);
    assert.equal(res.ranges[0], 0);
    assert.equal(res.ranges[1], 7);
});

test('PCRE2 Engine: compile syntax error offset', async () => {
    await assert.rejects(
        () => runPcre({
            engine: 'pcre',
            pattern: 'abc[def',
            flags: 'g',
            text: 'abcdef'
        }),
        (err) => {
            assert.ok(err instanceof RegexError);
            assert.equal(err.kind, 'syntax');
            assert.equal(typeof err.offset, 'number');
            assert.ok(/** @type {number} */ (err.offset) > 0);
            return true;
        }
    );
});

test('PCRE2 Engine: bounded ranges and exact total count', async () => {
    const text = 'x'.repeat(25000);
    const res = await runPcre({
        engine: 'pcre',
        pattern: 'x',
        flags: 'g',
        text
    });
    assert.equal(res.totalMatches, 25000);
    assert.equal(res.ranges.length, 20000); // capped at 10000 pairs * 2
});

test('PCRE2 Engine: strict flag validation and lone surrogate classification', async () => {
    assert.throws(() => validateFlags('gz', 'pcre'), (err) => err instanceof RegexError && err.kind === 'flags');
    assert.throws(() => validateFlags('gss', 'pcre'), (err) => err instanceof RegexError && err.kind === 'flags');

    // Lone surrogate in subject text is classified as 'input'
    await assert.rejects(
        () => runPcre({
            engine: 'pcre',
            pattern: 'test',
            flags: 'g',
            text: 'lone \uDC00 surrogate'
        }),
        (err) => err instanceof RegexError && err.kind === 'input'
    );

    // Lone surrogate in pattern is classified as 'syntax'
    await assert.rejects(
        () => runPcre({
            engine: 'pcre',
            pattern: 'lone \uDC00 surrogate',
            flags: 'g',
            text: 'text'
        }),
        (err) => err instanceof RegexError && err.kind === 'syntax'
    );
});
