/**
 * @fileoverview PCRE2 WebAssembly C Shim for AI-RegExr.
 * Exposes a native range-only matching ABI that writes match boundaries
 * (start and end byte offsets) directly into a caller-allocated WASM buffer.
 *
 * Eliminates all intermediate string allocations, JSON serialization, and capture
 * group materialization. Handles PCRE2 global empty-match retry+advance semantics.
 */

#define PCRE2_CODE_UNIT_WIDTH 8
#include <emscripten.h>
#include <string.h>
#include <stdlib.h>
#include "pcre2.h"

/**
 * Compiles a PCRE2 regular expression pattern.
 * @param pattern Pointer to UTF-8 pattern string in WASM memory.
 * @param pattern_len Pattern byte length.
 * @param flags Bitwise PCRE2 compile options.
 * @param err_buf Buffer of at least 256 bytes for error messages.
 * @param err_offset Output pointer receiving byte offset of compile error.
 * @return Compiled pcre2_code pointer or NULL on error.
 */
EMSCRIPTEN_KEEPALIVE
pcre2_code* pcre2_shim_compile(
    const char* pattern,
    uint32_t pattern_len,
    uint32_t flags,
    char* err_buf,
    uint32_t* err_offset
) {
    int errcode = 0;
    PCRE2_SIZE erroffset = 0;

    pcre2_code* re = pcre2_compile(
        (PCRE2_SPTR)pattern,
        (PCRE2_SIZE)pattern_len,
        flags,
        &errcode,
        &erroffset,
        NULL
    );

    if (!re && err_buf) {
        pcre2_get_error_message(errcode, (PCRE2_UCHAR*)err_buf, 256);
        if (err_offset) {
            *err_offset = (uint32_t)erroffset;
        }
    }
    return re;
}

/**
 * Frees a compiled PCRE2 regular expression.
 * @param re Pointer to compiled pcre2_code.
 */
EMSCRIPTEN_KEEPALIVE
void pcre2_shim_free(pcre2_code* re) {
    if (re) {
        pcre2_code_free(re);
    }
}

/**
 * Retrieves human-readable error message for a PCRE2 error code.
 * @param errcode PCRE2 error code.
 * @param buf Output buffer.
 * @param bufsize Size of output buffer.
 * @return Number of code units written or negative error code.
 */
EMSCRIPTEN_KEEPALIVE
int pcre2_shim_error_message(int errcode, char* buf, uint32_t bufsize) {
    return (int)pcre2_get_error_message(errcode, (PCRE2_UCHAR*)buf, (PCRE2_SIZE)bufsize);
}

/**
 * Returns PCRE2 library version.
 */
EMSCRIPTEN_KEEPALIVE
int pcre2_shim_version(char* buf, uint32_t bufsize) {
    if (!buf || bufsize < 32) return -1;
    return pcre2_config(PCRE2_CONFIG_VERSION, buf);
}

/**
 * Matches a single occurrence (non-global mode) and outputs start/end byte offsets.
 * @param re Compiled pattern.
 * @param subject Pointer to UTF-8 subject string in WASM memory.
 * @param subject_len Subject length in bytes.
 * @param out_start Output pointer for match start byte offset.
 * @param out_end Output pointer for match end byte offset.
 * @param match_flags Match-time flags.
 * @return > 0 on match, -1 on no match, negative on error.
 */
EMSCRIPTEN_KEEPALIVE
int pcre2_shim_match_single(
    pcre2_code* re,
    const char* subject,
    uint32_t subject_len,
    uint32_t* out_start,
    uint32_t* out_end,
    uint32_t match_flags
) {
    if (!re || !subject || !out_start || !out_end) {
        return -1;
    }

    pcre2_match_data* md = pcre2_match_data_create_from_pattern(re, NULL);
    if (!md) {
        return -48;
    }

    int rc = pcre2_match(
        re,
        (PCRE2_SPTR)subject,
        (PCRE2_SIZE)subject_len,
        0,
        match_flags,
        md,
        NULL
    );

    if (rc > 0) {
        PCRE2_SIZE* ov = pcre2_get_ovector_pointer(md);
        *out_start = (uint32_t)ov[0];
        *out_end = (uint32_t)ov[1];
    }

    pcre2_match_data_free(md);
    return rc;
}

/**
 * Global match: iterates all matches with PCRE2 empty-match retry+advance semantics.
 * Records up to max_range_pairs into out_ranges as [start, end, start, end, ...].
 * Reports exact total_matches count across the entire subject.
 *
 * @param re Compiled pattern.
 * @param subject Pointer to UTF-8 subject in WASM memory.
 * @param subject_len Length of subject in bytes.
 * @param out_ranges Pointer to uint32_t buffer receiving byte offset pairs.
 * @param max_range_pairs Maximum number of match pairs to write (e.g. 10000).
 * @param match_flags Match-time flags.
 * @param out_total_matches Output pointer receiving the exact total match count.
 * @return Number of pairs recorded in out_ranges (>= 0), or negative on error.
 */
EMSCRIPTEN_KEEPALIVE
int pcre2_shim_match_ranges(
    pcre2_code* re,
    const char* subject,
    uint32_t subject_len,
    uint32_t* out_ranges,
    uint32_t max_range_pairs,
    uint32_t match_flags,
    uint32_t* out_total_matches
) {
    if (!re || !subject || !out_ranges || !out_total_matches) {
        return -1;
    }

    pcre2_match_data* md = pcre2_match_data_create_from_pattern(re, NULL);
    if (!md) {
        return -48;
    }

    PCRE2_SIZE subj_len = (PCRE2_SIZE)subject_len;
    PCRE2_SIZE offset = 0;
    uint32_t total_matches = 0;
    uint32_t recorded_pairs = 0;
    int after_empty = 0;
    int err = 0;

    uint32_t allopts = 0;
    uint32_t newline = 0;
    pcre2_pattern_info(re, PCRE2_INFO_ALLOPTIONS, &allopts);
    pcre2_pattern_info(re, PCRE2_INFO_NEWLINE, &newline);

    int crlf_is_newline = (newline == PCRE2_NEWLINE_CRLF ||
                          newline == PCRE2_NEWLINE_ANY ||
                          newline == PCRE2_NEWLINE_ANYCRLF);
    int is_utf = (allopts & PCRE2_UTF) != 0;

    for (;;) {
        PCRE2_SIZE current_offset = offset;
        uint32_t current_flags = match_flags;

        if (after_empty) {
            current_flags |= (PCRE2_NOTEMPTY_ATSTART | PCRE2_ANCHORED);
        }

        int rc = pcre2_match(
            re,
            (PCRE2_SPTR)subject,
            subj_len,
            current_offset,
            current_flags,
            md,
            NULL
        );

        if (after_empty && rc == PCRE2_ERROR_NOMATCH) {
            // Non-empty retry at current offset failed. Now advance by 1 character
            if (offset >= subj_len) {
                break;
            }
            if (crlf_is_newline && offset + 1 < subj_len && subject[offset] == '\r' && subject[offset + 1] == '\n') {
                offset += 2;
            } else {
                offset++;
                if (is_utf) {
                    while (offset < subj_len && ((unsigned char)subject[offset] & 0xC0) == 0x80) {
                        offset++;
                    }
                }
            }
            after_empty = 0;
            continue;
        }

        if (rc == PCRE2_ERROR_NOMATCH) {
            break;
        }

        if (rc < 0) {
            err = rc;
            break;
        }

        PCRE2_SIZE* ov = pcre2_get_ovector_pointer(md);
        PCRE2_SIZE start = ov[0];
        PCRE2_SIZE end = ov[1];

        if (end < start) {
            err = PCRE2_ERROR_BADSUBSPATTERN;
            break;
        }

        if (recorded_pairs < max_range_pairs) {
            out_ranges[recorded_pairs * 2] = (uint32_t)start;
            out_ranges[recorded_pairs * 2 + 1] = (uint32_t)end;
            recorded_pairs++;
        }
        total_matches++;

        offset = end;
        if (end == start) {
            after_empty = 1;
        } else {
            after_empty = 0;
        }
    }

    pcre2_match_data_free(md);
    if (err < 0) {
        return err;
    }

    *out_total_matches = total_matches;
    return (int)recorded_pairs;
}
