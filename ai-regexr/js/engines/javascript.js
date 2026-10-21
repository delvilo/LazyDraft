/**
 * @fileoverview JavaScript RegExp engine adapter for AI-RegExr.
 * Implements flag validation, Unicode zero-length advancement,
 * exact match counting, bounded range collection, and cooperative timeout enforcement.
 */

import { RegexError, MAX_TEXT_BYTES, MAX_HIGHLIGHTS, MATCH_TIMEOUT_MS } from '../contracts.js';
import { validateFlags, utf8ByteLength } from '../pattern.js';

/** @typedef {import('../contracts.js').Snapshot} Snapshot */
/** @typedef {import('../contracts.js').MatchResult} MatchResult */

export const JS_VERSION = 'JavaScript (ECMAScript RegExp)';

/**
 * Validates that subject text does not exceed MAX_TEXT_BYTES (10 MiB) in UTF-8.
 * Uses pattern.js utf8ByteLength without allocating Blob or Buffer.
 * @param {string} text
 */
export function assertTextByteLimit(text) {
    if (text.length > MAX_TEXT_BYTES) {
        throw new RegexError('memory', 'Subject text exceeds maximum limit of 10 MiB');
    }
    const byteSize = utf8ByteLength(text);
    if (byteSize > MAX_TEXT_BYTES) {
        throw new RegexError('memory', `Subject text exceeds maximum limit of 10 MiB (${byteSize} bytes)`);
    }
}

/**
 * Executes regex matching using the JavaScript RegExp engine.
 * @param {Snapshot} snapshot
 * @returns {MatchResult}
 */
export function runJavaScript(snapshot) {
    const { pattern, flags, text } = snapshot;

    validateFlags(flags, 'javascript');
    assertTextByteLimit(text);

    /** @type {RegExp} */
    let regex;
    try {
        regex = new RegExp(pattern, flags);
    } catch (err) {
        throw new RegexError('syntax', err instanceof Error ? err.message : String(err));
    }

    const startTime = performance.now();
    const isGlobal = flags.includes('g');
    const hasUnicode = flags.includes('u');

    if (!isGlobal) {
        const match = regex.exec(text);
        const executionMs = Math.max(0, Math.round(performance.now() - startTime));
        if (!match) {
            return {
                totalMatches: 0,
                ranges: new Uint32Array(0),
                executionMs,
                version: JS_VERSION
            };
        }

        const ranges = new Uint32Array(2);
        ranges[0] = match.index;
        ranges[1] = match.index + match[0].length;
        return {
            totalMatches: 1,
            ranges,
            executionMs,
            version: JS_VERSION
        };
    }

    // Global matching with bounded ranges buffer
    const ranges = new Uint32Array(MAX_HIGHLIGHTS * 2);
    let rangeCount = 0;
    let totalMatches = 0;
    let loopCount = 0;
    /** @type {RegExpExecArray | null} */
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (rangeCount < MAX_HIGHLIGHTS) {
            ranges[rangeCount * 2] = match.index;
            ranges[rangeCount * 2 + 1] = match.index + match[0].length;
            rangeCount++;
        }
        totalMatches++;

        // Zero-length match progression guard (aware of Unicode astral code points)
        if (match[0].length === 0) {
            if (hasUnicode) {
                const cp = text.codePointAt(regex.lastIndex);
                regex.lastIndex += (cp !== undefined && cp > 0xFFFF) ? 2 : 1;
            } else {
                regex.lastIndex++;
            }
        }

        loopCount++;
        if ((loopCount & 2047) === 0) {
            if (performance.now() - startTime > MATCH_TIMEOUT_MS) {
                throw new RegexError('timeout', 'Regex execution timed out (3s limit exceeded)');
            }
        }
    }

    const executionMs = Math.max(0, Math.round(performance.now() - startTime));
    const finalRanges = rangeCount === MAX_HIGHLIGHTS ? ranges : ranges.slice(0, rangeCount * 2);

    return {
        totalMatches,
        ranges: finalRanges,
        executionMs,
        version: JS_VERSION
    };
}
