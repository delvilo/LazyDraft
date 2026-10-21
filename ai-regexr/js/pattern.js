import { RegexError } from './contracts.js';

/** @type {Record<import('./contracts.js').Engine, ReadonlyArray<{flag: string, label: string}>>} */
export const ENGINE_FLAGS = {
    javascript: [
        { flag: 'g', label: 'g (global)' },
        { flag: 'i', label: 'i (ignore case)' },
        { flag: 'm', label: 'm (multiline)' },
        { flag: 's', label: 's (dotAll)' },
        { flag: 'u', label: 'u (unicode)' }
    ],
    pcre: [
        { flag: 'g', label: 'g (global)' },
        { flag: 'i', label: 'i (caseless)' },
        { flag: 'm', label: 'm (multiline)' },
        { flag: 's', label: 's (dotAll)' },
        { flag: 'x', label: 'x (extended)' },
        { flag: 'u', label: 'u (unicode)' }
    ]
};

/** @param {string} flags @param {import('./contracts.js').Engine} engine */
export function validateFlags(flags, engine) {
    const allowed = ENGINE_FLAGS[engine].map(item => item.flag);
    const seen = new Set();
    for (const flag of flags) {
        if (!allowed.includes(flag)) throw new RegexError('flags', `此引擎不支援旗標 ${flag}`);
        if (seen.has(flag)) throw new RegexError('flags', `重複旗標 ${flag}`);
        seen.add(flag);
    }
    return flags;
}

/** Preserve source whitespace. Delimited input explicitly replaces, never merges flags.
 * @param {string} raw @param {string} selectedFlags @param {import('./contracts.js').Engine} engine
 */
export function parsePattern(raw, selectedFlags, engine) {
    let pattern = raw;
    let flags = selectedFlags;
    let delimited = false;
    if (raw.startsWith('/')) {
        // The final unescaped slash closes the notation. Engine-specific
        // classes and PCRE quoted regions do not need a second regex parser.
        for (let index = raw.length - 1; index > 0; index--) {
            if (raw[index] !== '/') continue;
            let backslashes = 0;
            for (let preceding = index - 1; preceding >= 0 && raw[preceding] === '\\'; preceding--) backslashes++;
            if (backslashes % 2 === 0) {
                pattern = raw.slice(1, index);
                flags = raw.slice(index + 1);
                delimited = true;
                break;
            }
        }
    }
    validateFlags(flags, engine);
    return { pattern, flags, delimited };
}

/** @param {string} pattern @param {string} flags @param {import('./contracts.js').Engine} engine */
export function formatPattern(pattern, flags, engine) {
    let escaped = '';
    let quoted = false;
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === '\\' && index + 1 < pattern.length) {
            const next = pattern[index + 1];
            if (!quoted || next === 'E') {
                index++;
                if (engine === 'pcre' && next === 'Q' && !quoted) quoted = true;
                else if (engine === 'pcre' && next === 'E' && quoted) quoted = false;
                escaped += '\\' + next;
                continue;
            }
        }
        const replacement = char === '/' ? '\\/' : char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\u2028' ? '\\u2028' : char === '\u2029' ? '\\u2029' : null;
        escaped += replacement === null ? char : quoted ? '\\E' + replacement + '\\Q' : replacement;
    }
    return `/${escaped}/${flags}`;
}

/** Count UTF-8 bytes without allocating a second copy of the document.
 * Unpaired UTF-16 surrogates encode as the replacement character, like TextEncoder.
 * @param {string} text
 */
export function utf8ByteLength(text) {
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code < 0x80) bytes++;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index++;
        } else bytes += 3;
    }
    return bytes;
}
