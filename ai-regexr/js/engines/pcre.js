/**
 * @fileoverview PCRE2 WASM regex engine adapter for AI-RegExr.
 * Uses custom range-only native build of PCRE2 10.49.
 * Writes match boundaries directly into WASM memory, eliminating JSON serialization
 * and capture group materialization while preserving full empty-match retry+advance semantics.
 */

import { RegexError, MAX_HIGHLIGHTS, MATCH_TIMEOUT_MS } from '../contracts.js';
import { validateFlags } from '../pattern.js';
import { assertTextByteLimit } from './javascript.js';
import PCRE2Module from '../../vendor/pcre2/pcre2.js';

/** @typedef {import('../contracts.js').Snapshot} Snapshot */
/** @typedef {import('../contracts.js').MatchResult} MatchResult */
/** @typedef {import('../../vendor/pcre2/pcre2.d.ts').PCRE2ModuleInstance} PCRE2ModuleInstance */

export const PCRE_VERSION = 'PCRE2 10.49 (WASM)';

// PCRE2 compile flags
const PCRE2_CASELESS = 0x00000008;
const PCRE2_MULTILINE = 0x00000400;
const PCRE2_DOTALL = 0x00000020;
const PCRE2_EXTENDED = 0x00000080;
const PCRE2_UTF = 0x00080000;
const PCRE2_UCP = 0x00020000;

/** @type {PCRE2ModuleInstance | null} */
let pcreInstance = null;
/** @type {Promise<PCRE2ModuleInstance> | null} */
let pcreInitPromise = null;
/** @type {string} */
let pcreConfigVersion = '10.49';

/**
 * Validates that string contains no unpaired surrogate code units.
 * @param {string} str
 * @returns {boolean}
 */
export function hasLoneSurrogates(str) {
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            if (i + 1 >= str.length) return true;
            const next = str.charCodeAt(i + 1);
            if (next < 0xDC00 || next > 0xDFFF) return true;
            i++;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return true;
        }
    }
    return false;
}

/**
 * Projects UTF-8 byte ranges to UTF-16 code unit ranges for DOM rendering.
 * In byte-mode (no 'u' flag), matches can start or end inside multi-byte codepoints:
 * - Match start is projected to the floor codepoint boundary.
 * - Match end is projected to the ceil codepoint boundary.
 * Tracks if any match boundary fell strictly inside a multi-byte codepoint (`projected: true`).
 *
 * @param {string} text
 * @param {Uint32Array} byteRanges Flattened [bStart, bEnd, ...]
 * @param {number} pairCount Number of match pairs
 * @returns {{ranges: Uint32Array, projected: boolean}}
 */
export function projectByteRangesToCharRanges(text, byteRanges, pairCount) {
    const outCharRanges = new Uint32Array(pairCount * 2);
    if (pairCount === 0) return { ranges: outCharRanges, projected: false };

    /** @type {Array<{bStart: number, bEnd: number, cStart: number, cEnd: number}>} */
    const records = [];
    let b = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const cStart = i;
        let cUnits = 1;
        let bLen = 1;

        if (code < 0x80) {
            bLen = 1;
        } else if (code < 0x800) {
            bLen = 2;
        } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
            bLen = 4;
            cUnits = 2;
            i++;
        } else {
            bLen = 3;
        }
        const cEnd = cStart + cUnits;
        const bStart = b;
        const bEnd = b + bLen;
        b += bLen;
        records.push({ bStart, bEnd, cStart, cEnd });
    }
    const totalBytes = b;
    const totalChars = text.length;
    let wasProjected = false;

    /**
     * @param {number} bytePos
     * @param {boolean} isEnd
     * @returns {number}
     */
    function mapByte(bytePos, isEnd) {
        if (bytePos <= 0) return 0;
        if (bytePos >= totalBytes) return totalChars;
        let lo = 0, hi = records.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const r = records[mid];
            if (bytePos < r.bStart) {
                hi = mid - 1;
            } else if (bytePos > r.bEnd) {
                lo = mid + 1;
            } else {
                if (bytePos === r.bStart) return r.cStart;
                if (bytePos === r.bEnd) return r.cEnd;
                wasProjected = true;
                return isEnd ? r.cEnd : r.cStart;
            }
        }
        return totalChars;
    }

    for (let i = 0; i < pairCount; i++) {
        const bStart = byteRanges[i * 2];
        const bEnd = byteRanges[i * 2 + 1];
        if (bStart === bEnd) {
            const pos = mapByte(bStart, false);
            outCharRanges[i * 2] = pos;
            outCharRanges[i * 2 + 1] = pos;
        } else {
            const cStart = mapByte(bStart, false);
            const cEnd = mapByte(bEnd, true);
            outCharRanges[i * 2] = cStart;
            outCharRanges[i * 2 + 1] = Math.max(cStart, cEnd);
        }
    }

    return { ranges: outCharRanges, projected: wasProjected };
}

/**
 * Initializes and caches the PCRE2 WebAssembly instance.
 * @returns {Promise<PCRE2ModuleInstance>}
 */
export async function getPcre2() {
    if (pcreInstance) {
        return pcreInstance;
    }
    if (pcreInitPromise) {
        return pcreInitPromise;
    }
    pcreInitPromise = (async () => {
        try {
            pcreInstance = await PCRE2Module();
            const vBuf = pcreInstance._malloc(64);
            pcreInstance._pcre2_shim_version(vBuf, 64);
            const queried = pcreInstance.UTF8ToString(vBuf);
            pcreInstance._free(vBuf);
            if (queried) {
                pcreConfigVersion = queried.split(' ')[0] || '10.49';
            }
            return pcreInstance;
        } catch (err) {
            pcreInitPromise = null;
            throw new RegexError('load', `Failed to initialize PCRE2 WASM engine: ${err instanceof Error ? err.message : String(err)}`);
        }
    })();
    return pcreInitPromise;
}

/**
 * Executes regex matching using the native range-only PCRE2 WebAssembly engine.
 * @param {Snapshot} snapshot
 * @returns {Promise<MatchResult>}
 */
export async function runPcre(snapshot) {
    const { pattern, flags, text } = snapshot;

    validateFlags(flags, 'pcre');
    assertTextByteLimit(text);

    // PCRE UTF-8 requires well-formed Unicode. Unpaired surrogates in subject classified as 'input'.
    if (hasLoneSurrogates(text)) {
        throw new RegexError('input', 'Subject text contains unpaired Unicode surrogate');
    }
    if (hasLoneSurrogates(pattern)) {
        throw new RegexError('syntax', 'Pattern contains unpaired Unicode surrogate');
    }

    const mod = await getPcre2();

    // Map PCRE flag letters to PCRE2 bitmask
    let compileFlags = 0;
    for (let i = 0; i < flags.length; i++) {
        const ch = flags[i];
        if (ch === 'i') compileFlags |= PCRE2_CASELESS;
        else if (ch === 'm') compileFlags |= PCRE2_MULTILINE;
        else if (ch === 's') compileFlags |= PCRE2_DOTALL;
        else if (ch === 'x') compileFlags |= PCRE2_EXTENDED;
        else if (ch === 'u') compileFlags |= (PCRE2_UTF | PCRE2_UCP);
    }

    const patLen = mod.lengthBytesUTF8(pattern);
    const patPtr = mod._malloc(patLen + 1);
    mod.stringToUTF8(pattern, patPtr, patLen + 1);

    const errBuf = mod._malloc(256);
    const errOff = mod._malloc(4);

    const re = mod._pcre2_shim_compile(patPtr, patLen, compileFlags, errBuf, errOff);
    mod._free(patPtr);

    if (re === 0) {
        const msg = mod.UTF8ToString(errBuf);
        const offset = mod.HEAPU32[errOff >> 2];
        mod._free(errBuf);
        mod._free(errOff);
        throw new RegexError('syntax', `PCRE2 compile error: ${msg}`, offset);
    }

    mod._free(errBuf);
    mod._free(errOff);

    const startTime = performance.now();
    const isGlobal = flags.includes('g');
    const versionLabel = `PCRE2 ${pcreConfigVersion} (WASM)`;

    // Single subject allocation in WASM memory for the entire match run
    const subjLen = mod.lengthBytesUTF8(text);
    const subjPtr = mod._malloc(subjLen + 1);
    mod.stringToUTF8(text, subjPtr, subjLen + 1);

    try {
        if (!isGlobal) {
            const outStart = mod._malloc(4);
            const outEnd = mod._malloc(4);
            try {
                const rc = mod._pcre2_shim_match_single(re, subjPtr, subjLen, outStart, outEnd, 0);
                const executionMs = Math.max(0, Math.round(performance.now() - startTime));

                if (rc <= 0) {
                    if (rc < -1) {
                        if (rc === -48) throw new RegexError('memory', 'PCRE2 match-data allocation failed');
                        if (rc === -47 || rc === -53) {
                            throw new RegexError('timeout', `PCRE2 limit exceeded (code ${rc})`);
                        }
                        throw new RegexError('worker', `PCRE2 match error (code ${rc})`);
                    }
                    return {
                        totalMatches: 0,
                        ranges: new Uint32Array(0),
                        executionMs,
                        version: versionLabel
                    };
                }

                const bStart = mod.HEAPU32[outStart >> 2];
                const bEnd = mod.HEAPU32[outEnd >> 2];
                const rawRanges = new Uint32Array([bStart, bEnd]);
                const { ranges: charRanges, projected } = projectByteRangesToCharRanges(text, rawRanges, 1);

                /** @type {MatchResult} */
                const result = {
                    totalMatches: 1,
                    ranges: charRanges,
                    executionMs,
                    version: versionLabel
                };
                if (projected) {
                    result.projected = true;
                }
                return result;
            } finally {
                mod._free(outStart);
                mod._free(outEnd);
            }
        }

        // Global mode: range-only native execution
        const outRanges = mod._malloc(MAX_HIGHLIGHTS * 2 * 4);
        const outTotal = mod._malloc(4);

        try {
            const pairsRecorded = mod._pcre2_shim_match_ranges(
                re,
                subjPtr,
                subjLen,
                outRanges,
                MAX_HIGHLIGHTS,
                0,
                outTotal
            );

            if (pairsRecorded < 0) {
                if (pairsRecorded === -48) throw new RegexError('memory', 'PCRE2 match-data allocation failed');
                if (pairsRecorded === -47 || pairsRecorded === -53) {
                    throw new RegexError('timeout', `PCRE2 resource limit exceeded (code ${pairsRecorded})`);
                }
                throw new RegexError('worker', `PCRE2 matching error (code ${pairsRecorded})`);
            }

            const totalMatches = mod.HEAPU32[outTotal >> 2];
            const executionMs = Math.max(0, Math.round(performance.now() - startTime));

            if (executionMs > MATCH_TIMEOUT_MS) {
                throw new RegexError('timeout', 'Regex execution timed out (3s limit exceeded)');
            }

            // Project directly from the native range view before its finally
            // cleanup; the returned UTF-16 array owns its separate buffer.
            const byteRanges = mod.HEAPU32.subarray(outRanges >> 2, (outRanges >> 2) + pairsRecorded * 2);

            // Project byte ranges to UTF-16 DOM codepoint bounds
            const { ranges: charRanges, projected } = projectByteRangesToCharRanges(text, byteRanges, pairsRecorded);

            /** @type {MatchResult} */
            const result = {
                totalMatches,
                ranges: charRanges,
                executionMs,
                version: versionLabel
            };
            if (projected) {
                result.projected = true;
            }
            return result;
        } finally {
            mod._free(outRanges);
            mod._free(outTotal);
        }
    } finally {
        // Guaranteed cleanup of subject buffer and compiled pattern in WebAssembly memory
        mod._free(subjPtr);
        mod._pcre2_shim_free(re);
    }
}
