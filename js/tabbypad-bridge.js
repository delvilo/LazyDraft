/**
 * Tabbypad IndexedDB Storage Bridge
 * Interacts with 'NotesDB' (version 1) and objectStore 'notes'
 */
const TabbypadStorage = {
    DB_NAME: 'NotesDB',
    DB_VERSION: 1,
    STORE_NAME: 'notes',

    _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = function (event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('notes')) {
                    db.createObjectStore('notes', { keyPath: 'id' });
                }
            };

            request.onsuccess = function (event) {
                resolve(event.target.result);
            };

            request.onerror = function (event) {
                reject(event.target.error || new Error('Failed to open Tabbypad NotesDB'));
            };
        });
    },

    async getAllNotes() {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result || [];
                // Sort newest first by created_at or id
                results.sort((a, b) => {
                    const timeA = new Date(a.created_at || a.id).getTime();
                    const timeB = new Date(b.created_at || b.id).getTime();
                    return timeB - timeA;
                });
                resolve(results);
            };

            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getNoteById(id) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async createNote(content, color = 'default-grid-color') {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const note = {
                id: Date.now(),
                content: content,
                created_at: new Date().toISOString(),
                color: color || 'default-grid-color'
            };
            store.add(note);

            tx.oncomplete = () => resolve(note);
            tx.onerror = (e) => reject(e.target.error);
            tx.onabort = () => reject(tx.error || new Error('Tabbypad save transaction aborted'));
        });
    },

    async updateNote(id, newContent) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const getReq = store.get(id);

            getReq.onsuccess = () => {
                const existingNote = getReq.result;
                if (!existingNote) {
                    reject(new Error('NOTE_NOT_FOUND'));
                    return;
                }
                existingNote.content = newContent;
                existingNote.updated_at = new Date().toISOString();
                store.put(existingNote);
            };

            getReq.onerror = (e) => reject(e.target.error);

            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
            tx.onabort = () => reject(tx.error || new Error('Tabbypad update transaction aborted'));
        });
    },

    async deleteNote(id) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            store.delete(id);

            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    },
    /**
     * Migrates legacy NotepadSnapshotsDB data into Tabbypad NotesDB, then deletes the legacy database.
     * Safe to run on every startup (idempotent; no-op if legacy database is absent).
     */
    async migrateLegacySnapshots() {
        if (typeof indexedDB === 'undefined') return;
        try {
            // Check if legacy DB exists (or open it to check objectStore)
            const legacyDB = await new Promise((resolve, reject) => {
                const req = indexedDB.open('NotepadSnapshotsDB', 1);
                req.onupgradeneeded = (e) => {
                    // If upgradeneeded fires, it means the DB didn't exist before!
                    // Abort so we don't create an empty legacy DB
                    req.transaction?.abort();
                    resolve(null);
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = () => resolve(null);
            });

            if (!legacyDB) return;

            if (!legacyDB.objectStoreNames.contains('snapshots')) {
                legacyDB.close();
                indexedDB.deleteDatabase('NotepadSnapshotsDB');
                return;
            }

            // Read all snapshots
            const snapshots = await new Promise((resolve) => {
                try {
                    const tx = legacyDB.transaction(['snapshots'], 'readonly');
                    const store = tx.objectStore('snapshots');
                    const getReq = store.getAll();
                    getReq.onsuccess = () => resolve(getReq.result || []);
                    getReq.onerror = () => resolve([]);
                } catch (e) {
                    resolve([]);
                }
            });

            legacyDB.close();

            if (snapshots && snapshots.length > 0) {
                console.log(`[Tabbypad Migration] Migrating ${snapshots.length} legacy snapshots into Tabbypad...`);
                const destDB = await this._openDB();
                await new Promise((resolve, reject) => {
                    const tx = destDB.transaction([this.STORE_NAME], 'readwrite');
                    const store = tx.objectStore(this.STORE_NAME);
                    for (const snap of snapshots) {
                        const noteContent = snap.content || '';
                        if (!noteContent.trim()) continue;
                        const id = (snap.timestamp && !isNaN(snap.timestamp)) ? snap.timestamp : Date.now();
                        const note = {
                            id: id,
                            content: noteContent,
                            created_at: new Date(id).toISOString(),
                            color: 'default-grid-color'
                        };
                        store.put(note);
                    }
                    tx.oncomplete = () => resolve();
                    tx.onerror = (e) => reject(e.target.error);
                });
                console.log('[Tabbypad Migration] Migration completed successfully.');
            }

            // Clean up the legacy database completely
            indexedDB.deleteDatabase('NotepadSnapshotsDB');
        } catch (err) {
            console.warn('[Tabbypad Migration] Failed to migrate legacy snapshots:', err);
        }
    }
};

// Run migration in background after page load
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        setTimeout(() => {
            TabbypadStorage.migrateLegacySnapshots();
        }, 1000);
    });
}
window.TabbypadStorage = TabbypadStorage;
