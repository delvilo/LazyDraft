/** Flat dictionary records avoid per-entry object reconstruction on warm loads. */
/** @typedef {import('./core.js').BoshiamyDictionary} Dictionary */
/** @typedef {{maxCodeLength: number, lookup: (code: string) => readonly string[]}} IndexedDictionary */
/**
 * Offsets index UTF-16 code units in the corresponding strings. Candidate
 * offsets index words, preserving their original order and multi-character text.
 * @typedef {Object} PackedDictionary
 * @property {1} format
 * @property {string} codes
 * @property {Uint32Array} codeOffsets
 * @property {Uint32Array} candidateOffsets
 * @property {string} text
 * @property {Uint32Array} textOffsets
 * @property {number} maxCodeLength
 */

/** @type {readonly string[]} */
const EMPTY = Object.freeze([]);

/** @param {Dictionary} dictionary @returns {PackedDictionary} */
export function packDictionary(dictionary) {
    const codes = Object.keys(dictionary).sort();
    const codeOffsets = new Uint32Array(codes.length + 1);
    const candidateOffsets = new Uint32Array(codes.length + 1);
    let codeLength = 0;
    let wordCount = 0;
    let maxCodeLength = 0;
    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        codeOffsets[i] = codeLength;
        candidateOffsets[i] = wordCount;
        codeLength += code.length;
        wordCount += dictionary[code].length;
        if (code.length > maxCodeLength) maxCodeLength = code.length;
    }
    codeOffsets[codes.length] = codeLength;
    candidateOffsets[codes.length] = wordCount;

    const words = new Array(wordCount);
    const textOffsets = new Uint32Array(wordCount + 1);
    let index = 0;
    let textLength = 0;
    for (const code of codes) {
        for (const word of dictionary[code]) {
            words[index] = word;
            textOffsets[index++] = textLength;
            textLength += word.length;
        }
    }
    textOffsets[wordCount] = textLength;
    return {
        format: 1, codes: codes.join(''), codeOffsets, candidateOffsets,
        text: words.join(''), textOffsets, maxCodeLength,
    };
}

/** @param {any} value @returns {value is PackedDictionary} */
export function isPackedDictionary(value) {
    return value?.format === 1 && typeof value.codes === 'string' && typeof value.text === 'string'
        && value.codeOffsets instanceof Uint32Array && value.codeOffsets.length > 0
        && value.candidateOffsets instanceof Uint32Array
        && value.candidateOffsets.length === value.codeOffsets.length
        && value.textOffsets instanceof Uint32Array && value.textOffsets.length > 0
        && value.codeOffsets[0] === 0 && value.candidateOffsets[0] === 0 && value.textOffsets[0] === 0
        && value.codeOffsets[value.codeOffsets.length - 1] === value.codes.length
        && value.candidateOffsets[value.candidateOffsets.length - 1] === value.textOffsets.length - 1
        && value.textOffsets[value.textOffsets.length - 1] === value.text.length
        && Number.isInteger(value.maxCodeLength) && value.maxCodeLength >= 0;
}

/** @param {PackedDictionary} table @returns {IndexedDictionary} */
export function createDictionaryIndex(table) {
    /** @type {Map<string, readonly string[]>} */
    const decoded = new Map();
    return {
        maxCodeLength: table.maxCodeLength,
        lookup(code) {
            const cached = decoded.get(code);
            if (cached) return cached;
            if (code.length > table.maxCodeLength) return EMPTY;
            let low = 0;
            let high = table.codeOffsets.length - 2;
            while (low <= high) {
                const middle = (low + high) >>> 1;
                const start = table.codeOffsets[middle];
                const length = table.codeOffsets[middle + 1] - start;
                const common = Math.min(length, code.length);
                let order = 0;
                for (let i = 0; i < common; i++) {
                    order = table.codes.charCodeAt(start + i) - code.charCodeAt(i);
                    if (order !== 0) break;
                }
                if (order === 0) order = length - code.length;
                if (order < 0) low = middle + 1;
                else if (order > 0) high = middle - 1;
                else {
                    const first = table.candidateOffsets[middle];
                    const end = table.candidateOffsets[middle + 1];
                    if (first === end) return EMPTY;
                    const candidates = new Array(end - first);
                    for (let word = first; word < end; word++) {
                        candidates[word - first] = table.text.slice(table.textOffsets[word], table.textOffsets[word + 1]);
                    }
                    // Only actual dictionary entries are memoized; unknown codes
                    // do not grow a cache, and repeated edits reuse decoded arrays.
                    decoded.set(code, candidates);
                    return candidates;
                }
            }
            return EMPTY;
        },
    };
}
