import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Main-notepad utilities are classic browser scripts, not ES modules.
const context = createContext({ window: {} });
runInContext(readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8'), context);
const count = text => ({ ...context.countText(text) });

test('text counts distinguish empty text from whitespace-only content', () => {
    assert.deepEqual(count(''), { characters: 0, chinese: 0, english: 0 });
    assert.deepEqual(count(' \t\n'), { characters: 3, chinese: 0, english: 0 });
});

test('total counts Unicode code points rather than UTF-16 code units', () => {
    assert.deepEqual(count('中 A😀\n'), { characters: 5, chinese: 1, english: 1 });
    assert.deepEqual(count('👩‍💻'), { characters: 3, chinese: 0, english: 0 });
});

test('Chinese count includes supplementary Han and ideographic zero, not punctuation', () => {
    assert.deepEqual(count('我喜歡寫程式'), { characters: 6, chinese: 6, english: 0 });
    assert.deepEqual(count('𠀀〇，。'), { characters: 4, chinese: 2, english: 0 });
});

test('English count preserves internal apostrophes and hyphens', () => {
    assert.equal(count("don't we’re state-of-the-art co‐operate non‑breaking").english, 5);
    assert.equal(count("'quoted' foo--bar — baz").english, 4);
});

test('mixed text does not require whitespace between Han and English', () => {
    assert.deepEqual(count('中文Hello世界world123'), { characters: 17, chinese: 4, english: 2 });
});

test('digits and punctuation do not become English words or join separate letter runs', () => {
    assert.deepEqual(count('2026 3.14，！'), { characters: 11, chinese: 0, english: 0 });
    assert.deepEqual(count('abc123def 2026 3.14'), { characters: 19, chinese: 0, english: 2 });
});
