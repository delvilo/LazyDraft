/**
 * @typedef {string | number} NoteId
 *
 * @typedef {Object} LegacyNote
 * @property {NoteId} id
 * @property {string} content
 * @property {string} color
 * @property {string} [created_at]
 * @property {string} [updated_at]
 * @property {undefined} [provenance]
 *
 * @typedef {Object} ReliableNote
 * @property {NoteId} id
 * @property {string} content
 * @property {string} color
 * @property {string} [created_at]
 * @property {string} updated_at
 * @property {'reliable'} provenance
 *
 * @typedef {LegacyNote | ReliableNote} Note
 *
 * @typedef {Object} CloudSnapshot
 * @property {'tabbypad'} app
 * @property {1} schema_version
 * @property {string} exported_at
 * @property {number} note_count
 * @property {Note[]} notes
 *
 * @typedef {Object} NotebookState
 * @property {number} revision
 * @property {Note[]} notes
 * @property {string} canonicalText
 *
 * @typedef {'merge' | 'overwrite'} RestoreMode
 *
 * @typedef {Object} RestorePlan
 * @property {RestoreMode} mode
 * @property {Note[]} targetNotes
 * @property {number} localCount
 * @property {number} targetCount
 * @property {number} addedCount
 * @property {number} updatedCount
 * @property {number} conflictCount
 * @property {number} unchangedCount
 * @property {boolean} isNoOp
 *
 * @typedef {Object} RecoveryCheckpoint
 * @property {'recovery'} key
 * @property {string} checkpointId
 * @property {string} createdAt
 * @property {Note[]} notes
 */

export const APPLICATION_NAME = 'tabbypad';
export const CURRENT_SCHEMA_VERSION = 1;
export const PROVENANCE_RELIABLE = 'reliable';
export const DEFAULT_COLOR = 'default-grid-color';
const NOTE_COLORS = new Set([
    DEFAULT_COLOR, 'pastel-yellow', 'pastel-blue', 'pastel-green', 'pastel-pink', 'pastel-purple'
]);
/**
 * Encodes an ID into a typed key string preserving difference between number 1 and string "1".
 * @param {unknown} id
 * @returns {string}
 */
export function toTypedKey(id) {
    if (typeof id === 'number') {
        if (!Number.isFinite(id)) {
            throw new TypeError('Note ID cannot be NaN or infinite');
        }
        return `n:${id}`;
    }
    if (typeof id === 'string') {
        if (id.length === 0) {
            throw new TypeError('Note ID string cannot be empty');
        }
        return `s:${id}`;
    }
    throw new TypeError(`Unsupported note ID type: ${typeof id}`);
}

/**
 * Checks whether a note has reliable new update provenance.
 * Existing updated_at alone is unreliable without explicit reliable provenance.
 * @param {unknown} note
 * @returns {boolean}
 */
export function isReliableUpdate(note) {
    if (typeof note !== 'object' || note === null) return false;
    const n = /** @type {Record<string, unknown>} */ (note);
    if (n.provenance !== PROVENANCE_RELIABLE) return false;
    if (typeof n.updated_at !== 'string' || !n.updated_at) return false;
    const time = new Date(n.updated_at).getTime();
    return !Number.isNaN(time);
}

/**
 * Validates note fields strictly at external boundaries.
 * @param {unknown} note
 * @returns {Note}
 */
export function validateNote(note) {
    if (typeof note !== 'object' || note === null) {
        throw new TypeError('Note must be a non-null object');
    }
    const n = /** @type {Record<string, unknown>} */ (note);

    if (typeof n.id !== 'string' && typeof n.id !== 'number') {
        throw new TypeError('Note id must be a string or finite number');
    }
    if (typeof n.id === 'number' && !Number.isFinite(n.id)) {
        throw new TypeError('Note numeric id must be finite');
    }
    if (typeof n.id === 'string' && n.id.length === 0) {
        throw new TypeError('Note string id cannot be empty');
    }

    if (typeof n.content !== 'string') {
        throw new TypeError(`Note content must be a string, got ${typeof n.content}`);
    }

    if (typeof n.color !== 'string' || !NOTE_COLORS.has(n.color)) {
        throw new TypeError('Note color must be a supported Tabbypad color');
    }

    if (n.created_at !== undefined) {
        if (typeof n.created_at !== 'string' || !n.created_at || Number.isNaN(new Date(n.created_at).getTime())) {
            throw new TypeError('Note created_at must be a valid date string when provided');
        }
    }

    if (n.updated_at !== undefined) {
        if (typeof n.updated_at !== 'string' || !n.updated_at || Number.isNaN(new Date(n.updated_at).getTime())) {
            throw new TypeError('Note updated_at must be a valid date string when provided');
        }
    }

    if (n.provenance !== undefined) {
        if (n.provenance !== PROVENANCE_RELIABLE) {
            throw new TypeError('Invalid provenance value');
        }
        if (typeof n.updated_at !== 'string' || !n.updated_at) {
            throw new TypeError('Reliable note must have valid updated_at');
        }
    }

    return projectNote(n);
}

/**
 * Projects a raw note object into the canonical internal domain note shape.
 * Preserves exact text without trimming or fabricating missing dates.
 * @param {Record<string, unknown>} raw
 * @returns {Note}
 */
export function projectNote(raw) {
    const id = (typeof raw.id === 'number' || typeof raw.id === 'string') ? raw.id : String(raw.id ?? '');
    const content = typeof raw.content === 'string' ? raw.content : String(raw.content ?? '');
    const color = typeof raw.color === 'string' && raw.color ? raw.color : DEFAULT_COLOR;

    /** @type {LegacyNote} */
    const note = {
        id,
        content,
        color
    };

    if (typeof raw.created_at === 'string' && raw.created_at) {
        note.created_at = raw.created_at;
    }

    if (typeof raw.updated_at === 'string' && raw.updated_at) {
        note.updated_at = raw.updated_at;
    }

    if (raw.provenance === PROVENANCE_RELIABLE && typeof note.updated_at === 'string') {
        return { ...note, updated_at: note.updated_at, provenance: PROVENANCE_RELIABLE };
    }

    return note;
}

/**
 * Compares two typed keys in code-point order.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareTypedKeys(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalizes and sorts an array of notes deterministically by typed key.
 * @param {readonly Note[]} notes
 * @returns {Note[]}
 */
export function canonicalizeNotes(notes) {
    const projected = notes.map(n => projectNote(/** @type {Record<string, unknown>} */ (n)));
    return [...projected].sort((a, b) => compareTypedKeys(toTypedKey(a.id), toTypedKey(b.id)));
}

/**
 * Serializes a canonical note array into deterministic UTF-8 JSON text.
 * Sorted keys in fixed order, strictly identical representation.
 * @param {readonly Note[]} notes
 * @returns {string}
 */
export function canonicalizeNotesText(notes) {
    const sorted = canonicalizeNotes(notes);
    const normalized = sorted.map(note => {
        /** @type {Record<string, unknown>} */
        const obj = {
            id: note.id,
            content: note.content,
            color: note.color
        };
        if (note.created_at !== undefined) {
            obj.created_at = note.created_at;
        }
        if (note.updated_at !== undefined) {
            obj.updated_at = note.updated_at;
        }
        if (note.provenance !== undefined) {
            obj.provenance = note.provenance;
        }
        return obj;
    });
    return JSON.stringify(normalized);
}

/**
 * Computes a standard SHA-256 hex string asynchronously outside transactions.
 * Uses Web Crypto API.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256Hex(text) {
    const subtle = (typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined);
    if (!subtle || typeof subtle.digest !== 'function') {
        throw new Error('SHA-256 requires Web Crypto API (globalThis.crypto.subtle)');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hashBuffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

/**
 * Computes the full 64-character SHA-256 cloud fingerprint of the canonical note set.
 * Excludes export timestamp and snapshot metadata.
 * @param {readonly Note[]} notes
 * @returns {Promise<string>}
 */
export async function computeNotesFingerprint(notes) {
    const canonicalText = canonicalizeNotesText(notes);
    return sha256Hex(canonicalText);
}

/**
 * Computes unambiguous SHA-256 hash of a single note variant covering typed ID, content, color, and metadata.
 * Used for deterministic conflict copy identity.
 * @param {Note} note
 * @returns {Promise<string>}
 */
export async function computeVariantHash(note) {
    const variantRepresentation = JSON.stringify({
        typedId: toTypedKey(note.id),
        content: note.content,
        color: note.color || DEFAULT_COLOR,
        created_at: note.created_at || '',
        updated_at: note.updated_at || '',
        provenance: note.provenance || ''
    });
    return sha256Hex(variantRepresentation);
}

/**
 * Encodes a committed note set into a versioned UTF-8 JSON cloud snapshot string.
 * @param {readonly Note[]} notes
 * @param {{ exportedAt?: string }} [options]
 * @returns {string}
 */
export function encodeSnapshot(notes, options = {}) {
    const seen = new Set();
    for (const note of notes) {
        const key = toTypedKey(note.id);
        if (seen.has(key)) {
            throw new Error(`Duplicate note ID cannot be encoded into snapshot: ${note.id}`);
        }
        seen.add(key);
    }

    const canonicalNotes = canonicalizeNotes(notes);
    const snapshot = {
        app: APPLICATION_NAME,
        schema_version: CURRENT_SCHEMA_VERSION,
        exported_at: options.exportedAt || new Date().toISOString(),
        note_count: canonicalNotes.length,
        notes: canonicalNotes
    };

    return JSON.stringify(snapshot, null, 2);
}

/**
 * Decodes and strictly validates a UTF-8 JSON cloud snapshot string at the boundary.
 * Rejects invalid JSON, unknown app, unsupported schema version, duplicate IDs, or invalid notes.
 * @param {string} jsonString
 * @returns {CloudSnapshot}
 */
export function decodeSnapshot(jsonString) {
    if (typeof jsonString !== 'string') {
        throw new TypeError('Snapshot input must be a JSON string');
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonString);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`INVALID_SNAPSHOT_JSON: ${message}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('INVALID_SNAPSHOT_SCHEMA: Root must be an object');
    }

    if (parsed.app !== APPLICATION_NAME) {
        throw new Error(`UNSUPPORTED_SNAPSHOT_APP: Expected "${APPLICATION_NAME}", got "${parsed.app}"`);
    }

    if (parsed.schema_version !== CURRENT_SCHEMA_VERSION) {
        throw new Error(`UNSUPPORTED_SCHEMA_VERSION: Expected ${CURRENT_SCHEMA_VERSION}, got ${parsed.schema_version}`);
    }

    if (typeof parsed.exported_at !== 'string' || Number.isNaN(Date.parse(parsed.exported_at))) {
        throw new Error('INVALID_SNAPSHOT_TIMESTAMP: exported_at must be a valid date string');
    }

    if (!Array.isArray(parsed.notes)) {
        throw new Error('INVALID_SNAPSHOT_NOTES: notes must be an array');
    }

    if (!Number.isSafeInteger(parsed.note_count) || parsed.note_count < 0 || parsed.note_count !== parsed.notes.length) {
        throw new Error('NOTE_COUNT_MISMATCH: A valid count matching the notes array is required');
    }

    const validatedNotes = [];
    const seenIds = new Set();

    for (let i = 0; i < parsed.notes.length; i++) {
        const rawNote = parsed.notes[i];
        const validNote = validateNote(rawNote);
        const typedKey = toTypedKey(validNote.id);
        if (seenIds.has(typedKey)) {
            throw new Error(`DUPLICATE_NOTE_ID: Snapshot contains duplicate note id: ${validNote.id}`);
        }
        seenIds.add(typedKey);
        validatedNotes.push(validNote);
    }

    return {
        app: APPLICATION_NAME,
        schema_version: CURRENT_SCHEMA_VERSION,
        exported_at: parsed.exported_at,
        note_count: validatedNotes.length,
        notes: validatedNotes
    };
}

/**
 * Checks whether captured notebook baseline exactly matches current state.
 * Synchronous and exact: checks revision and canonical text.
 * Catches ABA mutations and same-length/same-timestamp edits.
 * @param {NotebookState} captured
 * @param {{ revision: number, notes: readonly Note[] }} current
 * @returns {boolean}
 */
export function isNotebookStateUnchanged(captured, current) {
    if (captured.revision !== current.revision) {
        return false;
    }
    const currentCanonicalText = canonicalizeNotesText(current.notes);
    return captured.canonicalText === currentCanonicalText;
}

/**
 * Computes a lossless restore plan (Merge or Overwrite).
 * Computation happens purely outside IndexedDB transactions.
 * @param {readonly Note[]} localNotes
 * @param {readonly Note[]} snapshotNotes
 * @param {RestoreMode} mode
 * @returns {Promise<RestorePlan>}
 */
export async function planRestore(localNotes, snapshotNotes, mode) {
    const validSnapshotNotes = snapshotNotes.map(n => validateNote(n));
    const validLocalNotes = localNotes.map(n => validateNote(n));

    if (mode === 'overwrite') {
        if (validSnapshotNotes.length === 0) {
            throw new Error('EMPTY_CLOUD_BACKUP: Empty cloud data must never silently clear local notes');
        }

        const targetNotes = canonicalizeNotes(validSnapshotNotes);
        const localCanonical = canonicalizeNotesText(validLocalNotes);
        const targetCanonical = canonicalizeNotesText(targetNotes);
        const isNoOp = localCanonical === targetCanonical;

        return {
            mode: 'overwrite',
            targetNotes,
            localCount: validLocalNotes.length,
            targetCount: targetNotes.length,
            addedCount: isNoOp ? 0 : targetNotes.length,
            updatedCount: 0,
            conflictCount: 0,
            unchangedCount: isNoOp ? targetNotes.length : 0,
            isNoOp
        };
    }

    if (mode === 'merge') {
        /** @type {Map<string, Note>} */
        const localMap = new Map();
        /** @type {Set<string>} */
        const allOccupiedKeys = new Set();

        for (const note of validLocalNotes) {
            const key = toTypedKey(note.id);
            localMap.set(key, note);
            allOccupiedKeys.add(key);
        }
        for (const note of validSnapshotNotes) {
            allOccupiedKeys.add(toTypedKey(note.id));
        }

        /** @type {Map<string, Note>} */
        const resultMap = new Map();
        for (const note of validLocalNotes) {
            resultMap.set(toTypedKey(note.id), { ...note });
        }

        let addedCount = 0;
        let updatedCount = 0;
        let conflictCount = 0;
        let unchangedCount = 0;

        for (const cloudNote of validSnapshotNotes) {
            const typedKey = toTypedKey(cloudNote.id);
            const localNote = localMap.get(typedKey);

            if (!localNote) {
                resultMap.set(typedKey, { ...cloudNote });
                allOccupiedKeys.add(typedKey);
                addedCount++;
                continue;
            }

            const isDataEqual = localNote.content === cloudNote.content && localNote.color === cloudNote.color;
            if (isDataEqual) {
                unchangedCount++;
                continue;
            }

            const localReliable = isReliableUpdate(localNote);
            const cloudReliable = isReliableUpdate(cloudNote);

            if (localReliable && cloudReliable) {
                const localTime = new Date(/** @type {string} */ (localNote.updated_at)).getTime();
                const cloudTime = new Date(/** @type {string} */ (cloudNote.updated_at)).getTime();

                if (cloudTime > localTime) {
                    resultMap.set(typedKey, { ...cloudNote });
                    updatedCount++;
                    continue;
                }

                if (localTime > cloudTime) {
                    unchangedCount++;
                    continue;
                }
            }

            const variantHash = await computeVariantHash(cloudNote);
            const baseConflictId = `conflict-${toTypedKey(cloudNote.id).replace(':', '-')}-${variantHash}`;

            let alreadyPreserved = false;
            let probeId = baseConflictId;
            let probeSuffix = 1;
            while (localMap.has(toTypedKey(probeId))) {
                const existing = localMap.get(toTypedKey(probeId));
                if (existing
                    && existing.content === cloudNote.content
                    && existing.color === cloudNote.color
                    && (existing.created_at || '') === (cloudNote.created_at || '')
                    && (existing.updated_at || '') === (cloudNote.updated_at || '')
                    && (existing.provenance || '') === (cloudNote.provenance || '')) {
                    alreadyPreserved = true;
                    break;
                }
                probeId = `${baseConflictId}-${probeSuffix}`;
                probeSuffix++;
            }

            if (alreadyPreserved) {
                unchangedCount++;
                continue;
            }

            let candidateId = baseConflictId;
            let counter = 1;
            while (allOccupiedKeys.has(toTypedKey(candidateId))) {
                candidateId = `${baseConflictId}-${counter}`;
                counter++;
            }

            /** @type {Note} */
            const conflictNote = {
                ...cloudNote,
                id: candidateId
            };

            const candidateKey = toTypedKey(candidateId);
            resultMap.set(candidateKey, conflictNote);
            allOccupiedKeys.add(candidateKey);
            conflictCount++;
        }

        const targetNotes = canonicalizeNotes(Array.from(resultMap.values()));
        const localCanonical = canonicalizeNotesText(validLocalNotes);
        const targetCanonical = canonicalizeNotesText(targetNotes);
        const isNoOp = localCanonical === targetCanonical;

        return {
            mode: 'merge',
            targetNotes,
            localCount: validLocalNotes.length,
            targetCount: targetNotes.length,
            addedCount,
            updatedCount,
            conflictCount,
            unchangedCount,
            isNoOp
        };
    }

    throw new Error(`UNSUPPORTED_RESTORE_MODE: Expected "merge" or "overwrite", got "${mode}"`);
}
