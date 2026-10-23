import test from 'node:test';
import assert from 'node:assert/strict';
import { BoshiamyCore } from '../js/ime/v89/core.js';
import { packDictionary, createDictionaryIndex } from '../js/ime/v89/dictionary-table.js';

function indexedCore(dictionary) {
    return new BoshiamyCore(createDictionaryIndex(packDictionary(dictionary)));
}

function type(core, text) {
    for (const key of text) core.handleKey({ key });
}

test('indexed candidates distinguish prefixes and preserve punctuation and Unicode boundaries', () => {
    const core = indexedCore({ ab: ['界', '𠮷'], a: ['單字', ''], '[': ['「'] });
    type(core, 'a');
    assert.equal(core.handleKey({ key: ' ' }).commit, '單字');
    type(core, 'b');
    assert.equal(core.select(1).commit, '𠮷');
    core.handleKey({ key: 'Backspace' });
    assert.equal(core.select(1).commit, '');
    type(core, 'z');
    assert.equal(core.handleKey({ key: ' ' }).commit, null);
    assert.equal(core.buffer, 'az');
    core.handleKey({ key: 'Backspace' });
    assert.equal(core.select(0).commit, '單字');
    core.reset();
    type(core, '[');
    assert.equal(core.select(0).commit, '「');
});

test('indexed candidate pages keep numbering and multi-character words intact', () => {
    const core = indexedCore({ a: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '𠮷', '文字'] });
    type(core, 'a');
    core.handleKey({ key: 'PageDown' });
    assert.equal(core.select(0).commit, '𠮷');
    assert.equal(core.select(1).commit, '文字');
    assert.equal(core.select(9).commit, null);
    core.handleKey({ key: 'PageUp' });
    assert.equal(core.select(9).commit, '癸');
});

test('replacing an index restores raw lookup and code bounds without confusing a lookup radical', () => {
    const core = indexedCore({ abcd: ['舊'] });
    type(core, 'abcd');
    assert.equal(core.select(0).commit, '舊');
    core.setDictionary({ lookup: ['新'] });
    assert.equal(core.buffer, '');
    type(core, 'lookupx');
    assert.equal(core.buffer, 'lookup');
    assert.equal(core.select(0).commit, '新');
});
