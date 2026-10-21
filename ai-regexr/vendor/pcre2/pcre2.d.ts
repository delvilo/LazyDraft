/**
 * @fileoverview Type definitions for PCRE2 WASM runtime module.
 */

export interface PCRE2ModuleInstance {
    _malloc(size: number): number;
    _free(ptr: number): void;
    _pcre2_shim_compile(
        pattern: number,
        pattern_len: number,
        flags: number,
        err_buf: number,
        err_offset: number
    ): number;
    _pcre2_shim_free(re: number): void;
    _pcre2_shim_match_ranges(
        re: number,
        subject: number,
        subject_len: number,
        out_ranges: number,
        max_range_pairs: number,
        match_flags: number,
        out_total_matches: number
    ): number;
    _pcre2_shim_match_single(
        re: number,
        subject: number,
        subject_len: number,
        out_start: number,
        out_end: number,
        match_flags: number
    ): number;
    _pcre2_shim_error_message(errcode: number, buf: number, bufsize: number): number;
    _pcre2_shim_version(buf: number, bufsize: number): number;
    stringToUTF8(str: string, ptr: number, maxBytesToWrite: number): void;
    lengthBytesUTF8(str: string): number;
    UTF8ToString(ptr: number): string;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
}

export default function PCRE2Module(moduleArg?: Record<string, unknown>): Promise<PCRE2ModuleInstance>;
