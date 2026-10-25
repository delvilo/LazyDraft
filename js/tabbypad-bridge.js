(function () {
    const SCRIPT_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
        ? document.currentScript.src
        : null;

    let _corePromise = null;
    function getCore() {
        if (!_corePromise) {
            let coreUrl;
            if (SCRIPT_URL) {
                coreUrl = new URL('./tabbypad/backup-core.js', SCRIPT_URL).href;
            } else if (typeof location !== 'undefined') {
                if (location.pathname.includes('/tabbypad/')) {
                    coreUrl = new URL('../js/tabbypad/backup-core.js', location.href).href;
                } else {
                    coreUrl = new URL('js/tabbypad/backup-core.js', location.href).href;
                }
            } else {
                coreUrl = './tabbypad/backup-core.js';
            }
            _corePromise = import(coreUrl);
        }
        return _corePromise;
    }

    if (typeof window !== 'undefined') {
        getCore().catch(() => {});
    }

    const subscribers = new Set();
    let syncChannel = null;
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            syncChannel = new BroadcastChannel('tabbypad-storage-sync');
            syncChannel.onmessage = (event) => {
                for (const callback of subscribers) {
                    try {
                        callback(event.data);
                    } catch (err) {
                        console.error('[Tabbypad Storage] Subscriber error:', err);
                    }
                }
            };
        } catch (e) {
            // BroadcastChannel unavailable or blocked in context
        }
    }

    function notifySubscribers(payload) {
        if (syncChannel) {
            try {
                syncChannel.postMessage(payload);
            } catch {}
        }
        for (const callback of subscribers) {
            try {
                callback(payload);
            } catch (err) {
                console.error('[Tabbypad Storage] Subscriber error:', err);
            }
        }
    }

    let cachedDb = null;
    let cachedOpenPromise = null;

    function notifyBlockedUpgrade() {
        const message = 'Tabbypad 資料庫升級等待中：請關閉或重新整理其他已開啟的分頁，以完成升級。';
        console.warn('[Tabbypad Storage] Database upgrade blocked:', message);
        if (typeof document === 'undefined') return;

        if (window.Swal && typeof window.Swal.fire === 'function') {
            window.Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'warning',
                title: '資料庫升級中',
                text: message,
                showConfirmButton: false,
                timer: 8000
            });
        }

        if (!document.getElementById('tabbypad-blocked-alert')) {
            const banner = document.createElement('div');
            banner.id = 'tabbypad-blocked-alert';
            banner.className = 'alert alert-warning';
            banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:90%;font-size:14px;';
            banner.textContent = message;
            document.body.appendChild(banner);
        }
    }

    function createLegacyNoteRecord(raw, fallbackId) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.content !== 'string') {
            throw new TypeError('Unrecognized legacy note; its source has been retained');
        }
        const id = raw.id !== undefined && raw.id !== null && raw.id !== '' ? raw.id : fallbackId;
        const content = raw.content;
        const color = typeof raw.color === 'string' && raw.color ? raw.color : 'default-grid-color';
        const note = { id, content, color };
        if (raw && typeof raw.created_at === 'string' && raw.created_at) {
            note.created_at = raw.created_at;
        }
        if (raw && typeof raw.updated_at === 'string' && raw.updated_at) {
            note.updated_at = raw.updated_at;
        }
        return note;
    }

    async function importLegacyRecords(storage, notes, migrationKey) {
        const core = await getCore();
        const before = await storage.captureNotebookState();
        const plan = await core.planRestore(before.notes, notes, 'merge');
        const db = await storage._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['notes', 'meta'], 'readwrite');
            const store = tx.objectStore('notes');
            const meta = tx.objectStore('meta');
            const notesRequest = store.getAll();
            const revisionRequest = meta.get('revision');
            const markerRequest = meta.get(migrationKey);
            let loaded = 0;
            let inserted = 0;
            let revision = 0;
            const prepare = () => {
                if (++loaded !== 3 || markerRequest.result) return;
                revision = revisionRequest.result?.value ?? 0;
                if (!core.isNotebookStateUnchanged(before, { revision, notes: notesRequest.result })) {
                    tx.abort();
                    return;
                }
                const existing = new Set(notesRequest.result.map(note => core.toTypedKey(note.id)));
                for (const note of plan.targetNotes) {
                    if (!existing.has(core.toTypedKey(note.id))) {
                        store.add(note);
                        inserted++;
                    }
                }
                meta.put({ key: migrationKey, value: true });
                if (inserted) meta.put({ key: 'revision', value: ++revision });
            };
            notesRequest.onsuccess = prepare;
            revisionRequest.onsuccess = prepare;
            markerRequest.onsuccess = prepare;
            tx.oncomplete = () => {
                if (inserted) storage._notifyChange(revision);
                resolve();
            };
            tx.onabort = () => reject(tx.error || new Error('Legacy migration changed concurrently; source retained'));
            tx.onerror = () => reject(tx.error || new Error('Legacy migration failed; source retained'));
        });
    }

    const TabbypadStorage = {
        DB_NAME: 'NotesDB',
        DB_VERSION: 2,
        STORE_NAME: 'notes',
        META_STORE_NAME: 'meta',

        getCore,

        _openDB() {
            if (cachedDb) {
                return Promise.resolve(cachedDb);
            }
            if (cachedOpenPromise) {
                return cachedOpenPromise;
            }

            cachedOpenPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('notes')) {
                        db.createObjectStore('notes', { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains('meta')) {
                        db.createObjectStore('meta', { keyPath: 'key' });
                    }
                    const tx = request.transaction;
                    if (tx) {
                        const metaStore = tx.objectStore('meta');
                        metaStore.put({ key: 'revision', value: 0 });
                    }
                };

                request.onsuccess = () => {
                    cachedDb = request.result;
                    cachedOpenPromise = null;
                    document.getElementById('tabbypad-blocked-alert')?.remove();

                    cachedDb.onversionchange = () => {
                        if (cachedDb) {
                            cachedDb.close();
                            cachedDb = null;
                        }
                        cachedOpenPromise = null;
                    };

                    cachedDb.onclose = () => {
                        cachedDb = null;
                        cachedOpenPromise = null;
                    };

                    resolve(cachedDb);
                };

                request.onerror = () => {
                    cachedOpenPromise = null;
                    reject(request.error || new Error('Failed to open Tabbypad NotesDB'));
                };

                request.onblocked = () => {
                    notifyBlockedUpgrade();
                };
            });

            return cachedOpenPromise;
        },

        _notifyChange(newRevision) {
            notifySubscribers({ type: 'notes-changed', revision: newRevision });
        },

        subscribe(callback) {
            if (typeof callback === 'function') {
                subscribers.add(callback);
                return () => subscribers.delete(callback);
            }
            return () => {};
        },

        async getAllNotes() {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.getAll();

                request.onsuccess = () => {
                    const results = request.result || [];
                    results.sort((a, b) => {
                        const timeA = new Date(a.created_at || a.id).getTime();
                        const timeB = new Date(b.created_at || b.id).getTime();
                        return timeB - timeA;
                    });
                    resolve(results);
                };

                request.onerror = (e) => reject(request.error || (e.target && e.target.error));
            });
        },

        async getNoteById(id) {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.get(id);

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = (e) => reject(request.error || (e.target && e.target.error));
            });
        },

        async createNote(content, color = 'default-grid-color') {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE_NAME], 'readwrite');
                const notesStore = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE_NAME);

                const revReq = metaStore.get('revision');
                revReq.onsuccess = () => {
                    const currentRev = revReq.result?.value ?? 0;
                    const nextRev = currentRev + 1;

                    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                        ? crypto.randomUUID()
                        : (Date.now() + '-' + Math.random().toString(36).slice(2, 9));
                    const now = new Date().toISOString();

                    const note = {
                        id,
                        content: content || '',
                        created_at: now,
                        updated_at: now,
                        color: color || 'default-grid-color',
                        provenance: 'reliable'
                    };
                    notesStore.add(note);
                    metaStore.put({ key: 'revision', value: nextRev });

                    tx.oncomplete = () => {
                        this._notifyChange(nextRev);
                        resolve(note);
                    };
                };

                revReq.onerror = () => {
                    tx.abort();
                    reject(revReq.error || new Error('Failed to read revision for createNote'));
                };

                tx.onerror = (e) => reject(tx.error || (e.target && e.target.error) || new Error('Tabbypad create transaction error'));
                tx.onabort = () => reject(tx.error || new Error('Tabbypad create transaction aborted'));
            });
        },

        async updateNote(id, newContent, options = {}) {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE_NAME], 'readwrite');
                const notesStore = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE_NAME);

                const getReq = notesStore.get(id);
                const revReq = metaStore.get('revision');

                let noteLoaded = false;
                let revLoaded = false;
                let existingNote = null;
                let currentRev = 0;

                const checkAndApply = () => {
                    if (!noteLoaded || !revLoaded) return;
                    if (!existingNote) {
                        tx.abort();
                        reject(new Error('NOTE_NOT_FOUND'));
                        return;
                    }

                    if (options.expectedContent !== undefined && existingNote.content !== options.expectedContent) {
                        tx.abort();
                        reject(new Error('STALE_NOTE_CONTENT: Content changed concurrently'));
                        return;
                    }
                    if (options.expectedRecord) {
                        const recordMatches = existingNote.content === options.expectedRecord.content
                            && existingNote.color === options.expectedRecord.color
                            && (existingNote.updated_at || '') === (options.expectedRecord.updated_at || '')
                            && (existingNote.provenance || '') === (options.expectedRecord.provenance || '');
                        if (!recordMatches) {
                            tx.abort();
                            reject(new Error('STALE_RECORD: Note modified or deleted concurrently'));
                            return;
                        }
                    }

                    const targetColor = options.color !== undefined ? options.color : (existingNote.color || 'default-grid-color');
                    const isUnchanged = existingNote.content === newContent && (existingNote.color || 'default-grid-color') === targetColor;

                    if (isUnchanged) {
                        tx.oncomplete = () => {
                            resolve(existingNote);
                        };
                        return;
                    }

                    existingNote.content = newContent;
                    existingNote.color = targetColor;
                    existingNote.updated_at = new Date().toISOString();
                    existingNote.provenance = 'reliable';

                    notesStore.put(existingNote);

                    const nextRev = currentRev + 1;
                    metaStore.put({ key: 'revision', value: nextRev });

                    tx.oncomplete = () => {
                        this._notifyChange(nextRev);
                        resolve(existingNote);
                    };
                };
                getReq.onsuccess = () => {
                    existingNote = getReq.result;
                    noteLoaded = true;
                    checkAndApply();
                };
                getReq.onerror = () => {
                    tx.abort();
                    reject(getReq.error || new Error('Failed to read note for update'));
                };

                revReq.onsuccess = () => {
                    currentRev = revReq.result?.value ?? 0;
                    revLoaded = true;
                    checkAndApply();
                };
                revReq.onerror = () => {
                    tx.abort();
                    reject(revReq.error || new Error('Failed to read revision for update'));
                };

                tx.onerror = (e) => reject(tx.error || (e.target && e.target.error) || new Error('Tabbypad update transaction error'));
                tx.onabort = () => reject(tx.error || new Error('Tabbypad update transaction aborted'));
            });
        },

        async deleteNote(id, options = {}) {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE_NAME], 'readwrite');
                const notesStore = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE_NAME);

                const revReq = metaStore.get('revision');
                let currentRev = 0;

                const proceedDelete = () => {
                    if (options.expectedRecord) {
                        const getReq = notesStore.get(id);
                        getReq.onsuccess = () => {
                            const existingNote = getReq.result;
                            if (!existingNote) {
                                tx.abort();
                                reject(new Error('NOTE_NOT_FOUND'));
                                return;
                            }
                            const recordMatches = existingNote.content === options.expectedRecord.content
                                && existingNote.color === options.expectedRecord.color
                                && (existingNote.updated_at || '') === (options.expectedRecord.updated_at || '')
                                && (existingNote.provenance || '') === (options.expectedRecord.provenance || '');
                            if (!recordMatches) {
                                tx.abort();
                                reject(new Error('STALE_RECORD: Note modified concurrently'));
                                return;
                            }
                            notesStore.delete(id);
                            const nextRev = currentRev + 1;
                            metaStore.put({ key: 'revision', value: nextRev });
                        };
                        getReq.onerror = () => {
                            tx.abort();
                            reject(getReq.error || new Error('Failed to read note before delete'));
                        };
                    } else {
                        notesStore.delete(id);
                        const nextRev = currentRev + 1;
                        metaStore.put({ key: 'revision', value: nextRev });
                    }
                };

                revReq.onsuccess = () => {
                    currentRev = revReq.result?.value ?? 0;
                    proceedDelete();
                };
                revReq.onerror = () => {
                    tx.abort();
                    reject(revReq.error || new Error('Failed to read revision for delete'));
                };

                tx.oncomplete = () => {
                    this._notifyChange(currentRev + 1);
                    resolve(true);
                };
                tx.onerror = (e) => reject(tx.error || (e.target && e.target.error) || new Error('Tabbypad delete transaction error'));
                tx.onabort = () => reject(tx.error || new Error('Tabbypad delete transaction aborted'));
            });
        },

        async captureNotebookState() {
            const db = await this._openDB();
            const core = await getCore();

            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE_NAME], 'readonly');
                const notesStore = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE_NAME);

                const notesReq = notesStore.getAll();
                const revReq = metaStore.get('revision');

                let notesList = [];
                let revision = 0;
                tx.oncomplete = () => resolve({
                    revision,
                    notes: notesList,
                    canonicalText: core.canonicalizeNotesText(notesList)
                });
                tx.onabort = () => reject(tx.error || new Error('Notebook capture aborted'));

                notesReq.onsuccess = () => {
                    notesList = notesReq.result || [];
                };
                notesReq.onerror = () => reject(notesReq.error);

                revReq.onsuccess = () => {
                    revision = revReq.result?.value ?? 0;
                };
                revReq.onerror = () => reject(revReq.error);
            });
        },

        async applyRestore(plan, guard) {
            if (!guard || typeof guard.expectedRevision !== 'number' || typeof guard.expectedCanonicalText !== 'string') {
                throw new Error('MISSING_RESTORE_GUARD: applyRestore requires expectedRevision and expectedCanonicalText');
            }
            if (typeof guard.editorGuard === 'function' && !guard.editorGuard()) {
                throw new Error('UNSAVED_EDITOR_CHANGES: Active editor has unsaved changes');
            }
            const db = await this._openDB();
            const core = await getCore();

            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE_NAME], 'readwrite');
                const notesStore = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE_NAME);

                const notesReq = notesStore.getAll();
                const revReq = metaStore.get('revision');

                let notesLoaded = false;
                let revLoaded = false;
                let currentNotes = [];
                let currentRev = 0;

                const applyPlan = () => {
                    if (!notesLoaded || !revLoaded) return;

                    if (typeof guard.editorGuard === 'function' && !guard.editorGuard()) {
                        tx.abort();
                        reject(new Error('UNSAVED_EDITOR_CHANGES: Active editor has unsaved changes'));
                        return;
                    }
                    if (guard.expectedRevision !== undefined && currentRev !== guard.expectedRevision) {
                        tx.abort();
                        reject(new Error(`STALE_LOCAL_BASELINE: Revision changed (${currentRev} !== ${guard.expectedRevision})`));
                        return;
                    }

                    const currentCanonical = core.canonicalizeNotesText(currentNotes);
                    if (guard.expectedCanonicalText !== undefined && currentCanonical !== guard.expectedCanonicalText) {
                        tx.abort();
                        reject(new Error('STALE_LOCAL_BASELINE: Canonical notes content changed'));
                        return;
                    }

                    const targetCanonical = core.canonicalizeNotesText(plan.targetNotes);
                    const isNoOp = currentCanonical === targetCanonical;

                    if (isNoOp) {
                        tx.oncomplete = () => {
                            resolve({
                                success: true,
                                noOp: true,
                                newRevision: currentRev,
                                targetCount: plan.targetNotes.length
                            });
                        };
                        return;
                    }

                    const checkpointId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                        ? crypto.randomUUID()
                        : ('rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));

                    const recoveryCheckpoint = {
                        key: 'recovery',
                        checkpointId,
                        createdAt: new Date().toISOString(),
                        notes: currentNotes
                    };
                    metaStore.put(recoveryCheckpoint);

                    notesStore.clear();
                    for (const note of plan.targetNotes) {
                        notesStore.put(note);
                    }

                    const nextRev = currentRev + 1;
                    metaStore.put({ key: 'revision', value: nextRev });

                    tx.oncomplete = () => {
                        this._notifyChange(nextRev);
                        resolve({
                            success: true,
                            noOp: false,
                            checkpointId,
                            newRevision: nextRev,
                            targetCount: plan.targetNotes.length
                        });
                    };
                };

                notesReq.onsuccess = () => {
                    currentNotes = notesReq.result || [];
                    notesLoaded = true;
                    applyPlan();
                };
                notesReq.onerror = () => {
                    tx.abort();
                    reject(notesReq.error || new Error('Failed to read notes for restore'));
                };

                revReq.onsuccess = () => {
                    currentRev = revReq.result?.value ?? 0;
                    revLoaded = true;
                    applyPlan();
                };
                revReq.onerror = () => {
                    tx.abort();
                    reject(revReq.error || new Error('Failed to read revision for restore'));
                };

                tx.onerror = (e) => reject(tx.error || (e.target && e.target.error) || new Error('Restore transaction failed'));
                tx.onabort = () => reject(tx.error || new Error('Restore transaction aborted'));
            });
        },

        async undoRestore(guard) {
            if (!guard || typeof guard.expectedCheckpointId !== 'string' || !guard.expectedCheckpointId
                || typeof guard.expectedRevision !== 'number' || typeof guard.expectedCanonicalText !== 'string') {
                throw new Error('MISSING_UNDO_GUARD: undoRestore requires expectedCheckpointId, expectedRevision, and expectedCanonicalText');
            }
            if (typeof guard.editorGuard === 'function' && !guard.editorGuard()) {
                throw new Error('UNSAVED_EDITOR_CHANGES: Active editor has unsaved changes');
            }
            const db = await this._openDB();
            const core = await getCore();

            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE_NAME], 'readwrite');
                const notesStore = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE_NAME);

                const notesReq = notesStore.getAll();
                const revReq = metaStore.get('revision');
                const recReq = metaStore.get('recovery');

                let notesLoaded = false;
                let revLoaded = false;
                let recLoaded = false;
                let currentNotes = [];
                let currentRev = 0;
                let recovery = null;

                const applyUndo = () => {
                    if (!notesLoaded || !revLoaded || !recLoaded) return;

                    if (typeof guard.editorGuard === 'function' && !guard.editorGuard()) {
                        tx.abort();
                        reject(new Error('UNSAVED_EDITOR_CHANGES: Active editor has unsaved changes'));
                        return;
                    }
                    if (!recovery || !recovery.checkpointId) {
                        tx.abort();
                        reject(new Error('NO_RECOVERY_CHECKPOINT: No recovery checkpoint available to undo'));
                        return;
                    }

                    if (guard.expectedCheckpointId && recovery.checkpointId !== guard.expectedCheckpointId) {
                        tx.abort();
                        reject(new Error(`STALE_RECOVERY_TARGET: Checkpoint ID mismatch (${recovery.checkpointId} !== ${guard.expectedCheckpointId})`));
                        return;
                    }

                    if (guard.expectedRevision !== undefined && currentRev !== guard.expectedRevision) {
                        tx.abort();
                        reject(new Error(`STALE_LOCAL_BASELINE: Revision changed (${currentRev} !== ${guard.expectedRevision})`));
                        return;
                    }

                    const currentCanonical = core.canonicalizeNotesText(currentNotes);
                    if (guard.expectedCanonicalText !== undefined && currentCanonical !== guard.expectedCanonicalText) {
                        tx.abort();
                        reject(new Error('STALE_LOCAL_BASELINE: Canonical notes content changed'));
                        return;
                    }

                    notesStore.clear();
                    const restoredNotes = Array.isArray(recovery.notes) ? recovery.notes : [];
                    for (const note of restoredNotes) {
                        notesStore.put(note);
                    }

                    metaStore.delete('recovery');

                    const nextRev = currentRev + 1;
                    metaStore.put({ key: 'revision', value: nextRev });

                    tx.oncomplete = () => {
                        this._notifyChange(nextRev);
                        resolve({
                            success: true,
                            restoredCount: restoredNotes.length,
                            newRevision: nextRev
                        });
                    };
                };

                notesReq.onsuccess = () => {
                    currentNotes = notesReq.result || [];
                    notesLoaded = true;
                    applyUndo();
                };
                notesReq.onerror = () => {
                    tx.abort();
                    reject(notesReq.error);
                };

                revReq.onsuccess = () => {
                    currentRev = revReq.result?.value ?? 0;
                    revLoaded = true;
                    applyUndo();
                };
                revReq.onerror = () => {
                    tx.abort();
                    reject(revReq.error);
                };

                recReq.onsuccess = () => {
                    recovery = recReq.result || null;
                    recLoaded = true;
                    applyUndo();
                };
                recReq.onerror = () => {
                    tx.abort();
                    reject(recReq.error);
                };

                tx.onerror = (e) => reject(tx.error || (e.target && e.target.error) || new Error('Undo transaction failed'));
                tx.onabort = () => reject(tx.error || new Error('Undo transaction aborted'));
            });
        },

        async getRecoveryCheckpoint() {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.META_STORE_NAME], 'readonly');
                const store = tx.objectStore(this.META_STORE_NAME);
                const req = store.get('recovery');

                req.onsuccess = () => {
                    const result = req.result;
                    if (!result || !result.checkpointId) {
                        resolve(null);
                    } else {
                        resolve({
                            checkpointId: result.checkpointId,
                            createdAt: result.createdAt,
                            notes: result.notes || [],
                            noteCount: (result.notes || []).length
                        });
                    }
                };

                req.onerror = () => reject(req.error);
            });
        },

        async migrateNotesFromLocalStorage() {
            if (typeof localStorage === 'undefined' || typeof indexedDB === 'undefined') return;
            try {
                const source = localStorage.getItem('notes');
                if (!source) return;
                const rawNotes = JSON.parse(source);
                if (!Array.isArray(rawNotes) || rawNotes.length === 0) return;
                const core = await getCore();
                const hash = await core.sha256Hex(source);
                const notes = rawNotes.map((raw, index) =>
                    core.validateNote(createLegacyNoteRecord(raw, `legacy-${hash}-${index}`)));
                await importLegacyRecords(this, notes, `migration:localStorage:${hash}`);
                if (localStorage.getItem('notes') === source) localStorage.removeItem('notes');
            } catch (err) {
                console.warn('[Tabbypad Migration] LocalStorage source retained:', err);
            }
        },

        async migrateLegacySnapshots() {
            if (typeof indexedDB === 'undefined') return;
            let legacyDB;
            try {
                legacyDB = await new Promise((resolve) => {
                    const request = indexedDB.open('NotepadSnapshotsDB');
                    request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null); };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(null);
                });
                if (!legacyDB || !legacyDB.objectStoreNames.contains('snapshots')) return;
                const snapshots = await new Promise((resolve, reject) => {
                    const tx = legacyDB.transaction('snapshots', 'readonly');
                    const request = tx.objectStore('snapshots').getAll();
                    tx.oncomplete = () => resolve(request.result);
                    tx.onabort = () => reject(tx.error || new Error('Legacy snapshot read failed'));
                    tx.onerror = () => reject(tx.error || new Error('Legacy snapshot read failed'));
                });
                if (snapshots.length === 0) return;
                const source = JSON.stringify(snapshots);
                const core = await getCore();
                const hash = await core.sha256Hex(source);
                const notes = snapshots.map((snapshot, index) => {
                    if (!snapshot || typeof snapshot.content !== 'string') {
                        throw new TypeError('Unrecognized legacy snapshot; source retained');
                    }
                    const timestamp = typeof snapshot.timestamp === 'number' && Number.isFinite(snapshot.timestamp)
                        && !Number.isNaN(new Date(snapshot.timestamp).getTime()) ? snapshot.timestamp : null;
                    const note = {
                        id: timestamp ?? `snapshot-${hash}-${index}`,
                        content: snapshot.content,
                        color: 'default-grid-color'
                    };
                    if (timestamp !== null) note.created_at = new Date(timestamp).toISOString();
                    return core.validateNote(note);
                });
                await importLegacyRecords(this, notes, `migration:snapshots:${hash}`);
                await new Promise((resolve, reject) => {
                    const tx = legacyDB.transaction('snapshots', 'readwrite');
                    const store = tx.objectStore('snapshots');
                    const request = store.getAll();
                    request.onsuccess = () => {
                        if (JSON.stringify(request.result) === source) store.clear();
                    };
                    tx.oncomplete = resolve;
                    tx.onabort = () => reject(tx.error || new Error('Legacy source cleanup failed'));
                    tx.onerror = () => reject(tx.error || new Error('Legacy source cleanup failed'));
                });
            } catch (err) {
                console.warn('[Tabbypad Migration] Legacy snapshot source retained:', err);
            } finally {
                legacyDB?.close();
            }
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('load', () => {
            setTimeout(async () => {
                await TabbypadStorage.migrateNotesFromLocalStorage();
                await TabbypadStorage.migrateLegacySnapshots();
            }, 1000);
        });
    }

    if (typeof window !== 'undefined') {
        window.TabbypadStorage = TabbypadStorage;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.TabbypadStorage = TabbypadStorage;
    }
})();
