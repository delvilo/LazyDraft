import test from 'node:test';
import assert from 'node:assert/strict';
import {
    toTypedKey,
    isReliableUpdate,
    validateNote,
    projectNote,
    canonicalizeNotes,
    canonicalizeNotesText,
    computeNotesFingerprint,
    computeVariantHash,
    encodeSnapshot,
    decodeSnapshot,
    planRestore,
    isNotebookStateUnchanged,
    APPLICATION_NAME,
    CURRENT_SCHEMA_VERSION,
    PROVENANCE_RELIABLE
} from '../js/tabbypad/backup-core.js';

test('typed ID keys distinguish numeric 1 from string "1" across maps and merge', async () => {
    assert.notEqual(toTypedKey(1), toTypedKey('1'));

    const noteNum = { id: 1, content: '數值鍵筆記', color: 'default-grid-color' };
    const noteStr = { id: '1', content: '字串鍵筆記', color: 'default-grid-color' };

    const canonical = canonicalizeNotes([noteNum, noteStr]);
    assert.equal(canonical.length, 2);

    const plan = await planRestore([noteNum], [noteStr], 'merge');
    assert.equal(plan.targetNotes.length, 2);
    assert.ok(plan.targetNotes.some(n => n.id === 1));
    assert.ok(plan.targetNotes.some(n => n.id === '1'));
});

test('typed ID keys reject empty string, NaN, infinite, and unsupported types', () => {
    assert.throws(() => toTypedKey(''));
    assert.throws(() => toTypedKey(Number.NaN));
    assert.throws(() => toTypedKey(Infinity));
    assert.throws(() => toTypedKey(null));
    assert.throws(() => toTypedKey({}));
});

test('snapshot roundtrip preserves Unicode, CRLF, whitespace and missing historical dates', () => {
    const note = {
        id: 'unicode-note-1',
        content: ' \t\n繁體中文測試\r\n包含特殊符號 🚀🐱‍💻 與尾端空白   \n',
        color: 'pastel-yellow'
    };
    assert.deepEqual(decodeSnapshot(encodeSnapshot([note])).notes, [note]);
});

test('distinct IDs with identical text content remain completely distinct', async () => {
    const noteA = {
        id: 'note-a',
        content: '買牛奶與麵包',
        color: 'default-grid-color',
        created_at: '2026-10-24T08:00:00.000Z'
    };
    const noteB = {
        id: 'note-b',
        content: '買牛奶與麵包',
        color: 'default-grid-color',
        created_at: '2026-10-24T09:00:00.000Z'
    };

    const canonical = canonicalizeNotes([noteA, noteB]);
    assert.equal(canonical.length, 2);
    assert.notEqual(canonical[0].id, canonical[1].id);

    const plan = await planRestore([noteA], [noteB], 'merge');
    assert.equal(plan.targetNotes.length, 2);
    assert.equal(plan.addedCount, 1);
    assert.ok(plan.targetNotes.some(n => n.id === 'note-a'));
    assert.ok(plan.targetNotes.some(n => n.id === 'note-b'));
});

test('SHA-256 cloud fingerprint is order-independent and sensitive to note changes', async () => {
    const note1 = {
        id: 'id-1',
        content: '第一則筆記',
        color: 'pastel-blue',
        created_at: '2026-10-24T01:00:00.000Z'
    };
    const note2 = {
        id: 2,
        content: '第二則筆記',
        color: 'pastel-green',
        created_at: '2026-10-24T02:00:00.000Z'
    };

    const hashA = await computeNotesFingerprint([note1, note2]);
    const hashB = await computeNotesFingerprint([note2, note1]);
    assert.equal(hashA, hashB, 'Different array order must yield identical canonical SHA-256 fingerprint');
    assert.match(hashA, /^[a-f0-9]{64}$/);

    const modifiedNote = { ...note1, content: '第一則筆記（微調）' };
    const hashModified = await computeNotesFingerprint([modifiedNote, note2]);
    assert.notEqual(hashA, hashModified, 'Content change must change SHA-256 fingerprint');

    const colorModified = { ...note1, color: 'pastel-pink' };
    const hashColor = await computeNotesFingerprint([colorModified, note2]);
    assert.notEqual(hashA, hashColor, 'Color change must change SHA-256 fingerprint');
});

test('snapshot encoding and strict boundary decoding round-trip', () => {
    const notes = [
        {
            id: 101,
            content: '備份項目 101',
            color: 'default-grid-color',
            created_at: '2026-10-24T00:00:00.000Z'
        },
        {
            id: 'uuid-string-key',
            content: '備份項目 202',
            color: 'pastel-yellow',
            created_at: '2026-10-24T01:00:00.000Z',
            updated_at: '2026-10-24T02:00:00.000Z',
            provenance: PROVENANCE_RELIABLE
        }
    ];

    const json = encodeSnapshot(notes, { exportedAt: '2026-10-24T03:00:00.000Z' });
    const decoded = decodeSnapshot(json);

    assert.equal(decoded.app, APPLICATION_NAME);
    assert.equal(decoded.schema_version, CURRENT_SCHEMA_VERSION);
    assert.equal(decoded.exported_at, '2026-10-24T03:00:00.000Z');
    assert.equal(decoded.note_count, 2);
    assert.equal(decoded.notes.length, 2);

    const decodedFirst = decoded.notes.find(n => n.id === 101);
    assert.ok(decodedFirst);
    assert.equal(decodedFirst.content, '備份項目 101');

    const decodedSecond = decoded.notes.find(n => n.id === 'uuid-string-key');
    assert.ok(decodedSecond);
    assert.equal(decodedSecond.provenance, PROVENANCE_RELIABLE);
    assert.equal(decodedSecond.updated_at, '2026-10-24T02:00:00.000Z');
});

test('snapshot decoding refuses corrupted JSON, incompatible schemas and duplicate IDs', () => {
    const snapshot = {
        app: 'tabbypad',
        schema_version: 1,
        exported_at: '2026-10-24T00:00:00Z',
        note_count: 0,
        notes: []
    };
    const duplicate = { id: 1, content: 'a', color: 'default-grid-color' };
    for (const input of [
        '{ not valid json',
        '["not an object"]',
        JSON.stringify({ ...snapshot, app: 'otherapp' }),
        JSON.stringify({ ...snapshot, schema_version: 99 }),
        JSON.stringify({ ...snapshot, notes: 'not an array' }),
        JSON.stringify({ ...snapshot, note_count: 2, notes: [duplicate, { ...duplicate, content: 'duplicate' }] })
    ]) {
        assert.throws(() => decodeSnapshot(input));
    }
});

test('editing an undated legacy note retains its known update through backup', async () => {
    const earlier = {
        id: 'undated-edit',
        content: 'first known edit',
        color: 'pastel-blue',
        updated_at: '2026-01-01T00:00:00.000Z',
        provenance: PROVENANCE_RELIABLE
    };
    const later = { ...earlier, content: 'later known edit', updated_at: '2026-01-02T00:00:00.000Z' };
    const backedUp = decodeSnapshot(encodeSnapshot([earlier])).notes;
    assert.deepEqual(backedUp, [earlier]);
    const plan = await planRestore(backedUp, [later], 'merge');
    assert.deepEqual(plan.targetNotes, [later]);
});

test('snapshot decoding refuses invalid export dates, counts and color tokens', () => {
    const note = { id: 'valid-note', content: 'retained', color: 'pastel-blue' };
    const valid = { app: APPLICATION_NAME, schema_version: CURRENT_SCHEMA_VERSION, exported_at: '2026-01-01T00:00:00Z', note_count: 1, notes: [note] };
    for (const note_count of [undefined, '1', -1, 0, 1.5]) {
        assert.throws(() => decodeSnapshot(JSON.stringify({ ...valid, note_count })));
    }
    assert.throws(() => decodeSnapshot(JSON.stringify({ ...valid, exported_at: 'not-a-date' })));
    assert.throws(() => decodeSnapshot(JSON.stringify({ ...valid, notes: [{ ...note, color: 'invalid"]' }] })));
});

test('overwrite planning replaces local notes exactly and forbids empty cloud backup', async () => {
    const localNotes = [
        { id: 'local-1', content: '舊本地筆記', color: 'pastel-yellow', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    const cloudNotes = [
        { id: 'cloud-1', content: '雲端筆記 A', color: 'pastel-blue', created_at: '2026-10-24T01:00:00.000Z' },
        { id: 'cloud-2', content: '雲端筆記 B', color: 'pastel-green', created_at: '2026-10-24T02:00:00.000Z' }
    ];

    await assert.rejects(() => planRestore(localNotes, [], 'overwrite'));

    const plan = await planRestore(localNotes, cloudNotes, 'overwrite');
    assert.equal(plan.mode, 'overwrite');
    assert.equal(plan.localCount, 1);
    assert.equal(plan.targetCount, 2);
    assert.equal(plan.targetNotes.length, 2);
    assert.ok(plan.targetNotes.some(n => n.id === 'cloud-1'));
    assert.ok(plan.targetNotes.some(n => n.id === 'cloud-2'));
    assert.ok(!plan.targetNotes.some(n => n.id === 'local-1'));
    assert.equal(plan.isNoOp, false);

    const noOpPlan = await planRestore(cloudNotes, cloudNotes, 'overwrite');
    assert.equal(noOpPlan.isNoOp, true);
    assert.equal(noOpPlan.addedCount, 0);
    assert.equal(noOpPlan.unchangedCount, 2);
});

test('merge planning deduplicates same-ID with identical content and color', async () => {
    const local = [
        { id: 50, content: '相同內容', color: 'pastel-yellow', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    const cloud = [
        { id: 50, content: '相同內容', color: 'pastel-yellow', created_at: '2026-10-24T00:00:00.000Z' }
    ];

    const plan = await planRestore(local, cloud, 'merge');
    assert.equal(plan.targetNotes.length, 1);
    assert.equal(plan.unchangedCount, 1);
    assert.equal(plan.conflictCount, 0);
    assert.equal(plan.addedCount, 0);
    assert.equal(plan.isNoOp, true);
});

test('merge planning chooses strictly later update only when both sides have reliable provenance', async () => {
    const local = [
        {
            id: 'sync-note',
            content: '本地舊版本',
            color: 'default-grid-color',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T01:00:00.000Z',
            provenance: PROVENANCE_RELIABLE
        }
    ];
    const cloud = [
        {
            id: 'sync-note',
            content: '雲端新版本',
            color: 'default-grid-color',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T02:00:00.000Z',
            provenance: PROVENANCE_RELIABLE
        }
    ];

    const plan = await planRestore(local, cloud, 'merge');
    assert.equal(plan.targetNotes.length, 1);
    assert.equal(plan.updatedCount, 1);
    assert.equal(plan.conflictCount, 0);
    assert.equal(plan.targetNotes[0].content, '雲端新版本');

    const localNewer = [
        {
            id: 'sync-note',
            content: '本地新版本',
            color: 'default-grid-color',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T03:00:00.000Z',
            provenance: PROVENANCE_RELIABLE
        }
    ];
    const planLocalWins = await planRestore(localNewer, cloud, 'merge');
    assert.equal(planLocalWins.targetNotes.length, 1);
    assert.equal(planLocalWins.targetNotes[0].content, '本地新版本');
    assert.equal(planLocalWins.unchangedCount, 1);
});

test('same-ID text and color equality does not promote legacy note to reliable provenance', async () => {
    const legacyLocal = [
        { id: 'item-x', content: '文字A', color: 'default-grid-color' }
    ];
    const reliableCloudA = [
        {
            id: 'item-x',
            content: '文字A',
            color: 'default-grid-color',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T01:00:00.000Z',
            provenance: PROVENANCE_RELIABLE
        }
    ];

    const plan1 = await planRestore(legacyLocal, reliableCloudA, 'merge');
    assert.equal(plan1.targetNotes.length, 1);
    assert.equal(plan1.targetNotes[0].provenance, undefined);

    const reliableCloudB = [
        {
            id: 'item-x',
            content: '文字B',
            color: 'default-grid-color',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T02:00:00.000Z',
            provenance: PROVENANCE_RELIABLE
        }
    ];
    const plan2 = await planRestore(plan1.targetNotes, reliableCloudB, 'merge');
    assert.equal(plan2.targetNotes.length, 2);
    assert.ok(plan2.targetNotes.some(n => n.content === '文字A'));
    assert.ok(plan2.targetNotes.some(n => n.content === '文字B'));
});

test('supported legacy missing created_at is preserved without date manufacturing', () => {
    const legacyNote = {
        id: 'legacy-undated',
        content: '無日期的舊筆記',
        color: 'pastel-blue'
    };
    const projected = projectNote(legacyNote);
    assert.equal(projected.created_at, undefined);

    const json = encodeSnapshot([projected]);
    const decoded = decodeSnapshot(json);
    assert.equal(decoded.notes.length, 1);
    assert.equal(decoded.notes[0].created_at, undefined);
    assert.equal(decoded.notes[0].content, '無日期的舊筆記');
});
test('merge planning preserves both variants as conflict copies when timestamps are equal or provenance is unreliable', async () => {
    const legacyLocal = [
        {
            id: 999,
            content: '本地遺留筆記（無可靠來源標記）',
            color: 'pastel-blue',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T05:00:00.000Z'
        }
    ];
    const legacyCloud = [
        {
            id: 999,
            content: '雲端筆記（不同文字，亦無可靠來源）',
            color: 'pastel-pink',
            created_at: '2026-10-24T00:00:00.000Z',
            updated_at: '2026-10-24T06:00:00.000Z'
        }
    ];

    const plan = await planRestore(legacyLocal, legacyCloud, 'merge');
    assert.equal(plan.targetNotes.length, 2);
    assert.equal(plan.conflictCount, 1);

    const originalNote = plan.targetNotes.find(n => n.id === 999);
    assert.ok(originalNote);
    assert.equal(originalNote.content, '本地遺留筆記（無可靠來源標記）');

    const conflictNote = plan.targetNotes.find(n => typeof n.id === 'string' && n.id.startsWith('conflict-n-999-'));
    assert.ok(conflictNote);
    assert.equal(conflictNote.content, '雲端筆記（不同文字，亦無可靠來源）');
    assert.equal(conflictNote.color, 'pastel-pink');
    assert.equal(conflictNote.created_at, '2026-10-24T00:00:00.000Z');
    assert.equal(conflictNote.updated_at, '2026-10-24T06:00:00.000Z');
});

test('repeated merge is idempotent and does not multiply conflict copies', async () => {
    const local = [
        { id: 'item-1', content: '在地內容 A', color: 'default-grid-color', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    const cloud = [
        { id: 'item-1', content: '雲端內容 B', color: 'default-grid-color', created_at: '2026-10-24T00:00:00.000Z' }
    ];

    const firstPlan = await planRestore(local, cloud, 'merge');
    assert.equal(firstPlan.targetNotes.length, 2);
    assert.equal(firstPlan.conflictCount, 1);

    const secondPlan = await planRestore(firstPlan.targetNotes, cloud, 'merge');
    assert.equal(secondPlan.targetNotes.length, 2);
    assert.equal(secondPlan.conflictCount, 0);
    assert.equal(secondPlan.isNoOp, true);
});

test('edited conflict copy re-merge restores cloud variant without overwriting edited note', async () => {
    const local = [
        { id: 'orig-id', content: '本地原始版', color: 'default-grid-color', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    const cloud = [
        { id: 'orig-id', content: '雲端衝突版', color: 'pastel-green', created_at: '2026-10-24T00:00:00.000Z' }
    ];

    const firstPlan = await planRestore(local, cloud, 'merge');
    const conflictNote = firstPlan.targetNotes.find(n => typeof n.id === 'string' && n.id.startsWith('conflict-s-orig-id-'));
    assert.ok(conflictNote);

    const editedConflictNote = {
        ...conflictNote,
        content: '使用者自行編輯衝突複本後的新文字',
        provenance: PROVENANCE_RELIABLE,
        created_at: '2026-10-24T00:00:00.000Z',
        updated_at: '2026-10-24T05:00:00.000Z'
    };

    const localAfterEdit = [
        local[0],
        editedConflictNote
    ];

    const reMergePlan = await planRestore(localAfterEdit, cloud, 'merge');
    assert.equal(reMergePlan.targetNotes.length, 3);

    const editedStillPresent = reMergePlan.targetNotes.find(n => n.id === conflictNote.id);
    assert.ok(editedStillPresent);
    assert.equal(editedStillPresent.content, '使用者自行編輯衝突複本後的新文字');

    const reRestoredCloud = reMergePlan.targetNotes.find(n => n.content === '雲端衝突版');
    assert.ok(reRestoredCloud);
    assert.notEqual(reRestoredCloud.id, conflictNote.id);

    const thirdPlan = await planRestore(reMergePlan.targetNotes, cloud, 'merge');
    assert.equal(thirdPlan.targetNotes.length, 3, 'Repeated merge after restored variant must remain 3 notes');
    assert.equal(thirdPlan.conflictCount, 0);
    assert.equal(thirdPlan.isNoOp, true);
});

test('collision guard prevents overwriting unrelated note occupying conflict ID', async () => {
    const cloudNote = {
        id: 'coll-target',
        content: '衝突內容',
        color: 'pastel-yellow',
        created_at: '2026-10-24T00:00:00.000Z'
    };
    const expectedHash = await computeVariantHash(cloudNote);
    const candidateConflictId = `conflict-${toTypedKey(cloudNote.id).replace(':', '-')}-${expectedHash}`;

    const local = [
        { id: 'coll-target', content: '本地內容', color: 'pastel-yellow', created_at: '2026-10-24T00:00:00.000Z' },
        { id: candidateConflictId, content: '已存在的不相關檔案', color: 'default-grid-color', created_at: '2026-10-24T00:00:00.000Z' }
    ];

    const plan = await planRestore(local, [cloudNote], 'merge');
    assert.equal(plan.targetNotes.length, 3);

    const occupant = plan.targetNotes.find(n => n.id === candidateConflictId);
    assert.ok(occupant);
    assert.equal(occupant.content, '已存在的不相關檔案');

    const guardedConflictCopy = plan.targetNotes.find(n => n.content === '衝突內容');
    assert.ok(guardedConflictCopy);
    assert.equal(guardedConflictCopy.id, `${candidateConflictId}-1`);
});

test('isNotebookStateUnchanged checks revision and full canonical content synchronously', () => {
    const notes = [
        { id: 1, content: '筆記 1', color: 'default-grid-color', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    const canonicalText = canonicalizeNotesText(notes);
    const baseline = { revision: 5, notes, canonicalText };

    assert.equal(isNotebookStateUnchanged(baseline, { revision: 5, notes }), true);
    assert.equal(isNotebookStateUnchanged(baseline, { revision: 6, notes }), false);

    const alteredNotes = [
        { id: 1, content: '筆記 A', color: 'default-grid-color', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    assert.equal(isNotebookStateUnchanged(baseline, { revision: 5, notes: alteredNotes }), false);

    const colorAltered = [
        { id: 1, content: '筆記 1', color: 'pastel-pink', created_at: '2026-10-24T00:00:00.000Z' }
    ];
    assert.equal(isNotebookStateUnchanged(baseline, { revision: 5, notes: colorAltered }), false);
});
