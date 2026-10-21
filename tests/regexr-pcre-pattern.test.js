import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, formatPattern } from '../ai-regexr/js/pattern.js';
import { runPcre } from '../ai-regexr/js/engines/pcre.js';

test('PCRE POSIX classes do not terminate slash notation', async () => {
    const parsed = parsePattern('/[[:alpha:]/]/g', '', 'pcre');
    const result = await runPcre({ engine: 'pcre', ...parsed, text: 'a/9B' });
    assert.equal(result.totalMatches, 3);
    assert.deepEqual(Array.from(result.ranges), [0, 1, 1, 2, 3, 4]);
});

test('copy preserves PCRE quoted slashes, backslashes and newlines', async () => {
    for (const [source, text] of [
        [String.raw`\Qfoo/bar\E`, 'foo/bar'],
        [String.raw`\Qfoo\/bar\E`, 'foo\\/bar'],
        ['\\Qfoo\n/bar\\E', 'foo\n/bar'],
        [String.raw`\Qfoo\\E/bar`, 'foo\\/bar']
    ]) {
        const original = await runPcre({ engine: 'pcre', pattern: source, flags: 'g', text });
        assert.equal(original.totalMatches, 1, source);
        assert.deepEqual(Array.from(original.ranges), [0, text.length], source);
        const parsed = parsePattern(formatPattern(source, 'g', 'pcre'), 'im', 'pcre');
        const copied = await runPcre({ engine: 'pcre', ...parsed, text });
        assert.equal(copied.totalMatches, 1, source);
        assert.deepEqual(Array.from(copied.ranges), [0, text.length], source);
    }
});
