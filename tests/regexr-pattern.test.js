import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, formatPattern, utf8ByteLength } from '../ai-regexr/js/pattern.js';
import { MAX_TEXT_BYTES } from '../ai-regexr/js/contracts.js';

test('explicit empty delimiter flags replace saved global flags', () => {
    const parsed = parsePattern('/a/', 'gm', 'javascript');
    assert.equal(new RegExp(parsed.pattern, parsed.flags).global, false);
    assert.equal(parsed.flags, '');
});

test('raw whitespace and slash characters inside classes are significant', () => {
    const raw = parsePattern(' a ', 'g', 'javascript');
    assert.equal(new RegExp(raw.pattern, raw.flags).exec(' a ')[0], ' a ');
    assert.equal(new RegExp(raw.pattern, raw.flags).test('a'), false);
    const slashClass = parsePattern('/[/]/g', '', 'javascript');
    assert.deepEqual('a/b/c'.match(new RegExp(slashClass.pattern, slashClass.flags)), ['/', '/']);
    const escapedSlash = parsePattern(String.raw`/a\/b/i`, 'g', 'javascript');
    assert.equal(new RegExp(escapedSlash.pattern, escapedSlash.flags).exec('A/b')[0], 'A/b');
});

test('unsupported and duplicate flags cannot be silently discarded', () => {
    for (const source of ['/a/gg', '/a/x', '/a/Q', '/a/g trailing']) {
        assert.throws(() => parsePattern(source, 'g', 'javascript'), { kind: 'flags' });
    }
    assert.equal(parsePattern('/ a /x', '', 'pcre').flags, 'x');
});

test('copy format round trips source semantics without doubled delimiters', () => {
    for (const source of ['a/b', String.raw`a\/b`, String.raw`a\\/b`, 'a\nb', 'a\rb', '[\\/]']) {
        const formatted = formatPattern(source, 'gi', 'javascript');
        const parsed = parsePattern(formatted, 'm', 'javascript');
        const original = new RegExp(source, 'gi');
        const copied = new RegExp(parsed.pattern, parsed.flags);
        const subject = 'a/b A/b a\\/b a\nb a\rb /';
        assert.deepEqual([...subject.matchAll(copied)].map(match => [match.index, match[0]]), [...subject.matchAll(original)].map(match => [match.index, match[0]]));
    }
});

test('UTF8 limit counts astral characters and lone surrogates like TextEncoder', () => {
    for (const source of ['', 'a', '中', '😀', '\ud800', '\udc00', '\ud800a', '中😀\ud800\udc00\udc00']) {
        assert.equal(utf8ByteLength(source), new TextEncoder().encode(source).byteLength);
    }
    const exact = '😀'.repeat(MAX_TEXT_BYTES / 4);
    assert.equal(utf8ByteLength(exact), MAX_TEXT_BYTES);
    assert.ok(utf8ByteLength(exact + 'a') > MAX_TEXT_BYTES);
});
