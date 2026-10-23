/** Lazy dictionary loading with an IndexedDB cache isolated from user notes. */
import { packDictionary, isPackedDictionary, createDictionaryIndex } from './dictionary-table.js';
/** @typedef {import('./core.js').BoshiamyDictionary} Dictionary */
/** @typedef {import('./dictionary-table.js').IndexedDictionary} IndexedDictionary */

const DB_NAME = 'lazydraft-ime-cache';
const DB_VERSION = 1;
const STORE_NAME = 'dictionaries';
const SOURCE_URL = new URL('./boshiamy-dict.json', import.meta.url).href;

/** @returns {Promise<IDBDatabase | null>} */
function openDatabase() {
    return new Promise(resolve => {
        /** @type {IDBOpenDBRequest} */
        let request;
        try {
            if (typeof indexedDB === 'undefined') {
                resolve(null);
                return;
            }
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }

        let abandoned = false;
        request.onblocked = () => {
            abandoned = true;
            resolve(null);
        };
        request.onerror = () => resolve(null);
        request.onupgradeneeded = () => {
            try {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                    request.result.createObjectStore(STORE_NAME);
                }
            } catch {
                request.transaction?.abort();
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            if (abandoned) db.close();
            else resolve(db);
        };
    });
}

// Only connection/schema setup happens at import; dictionary data stays unread
// until activation. Consume this connection once and close it after the request.
/** @type {Promise<IDBDatabase | null> | null} */
let initialConnection = openDatabase();

/**
 * Cache failures are misses, not input failures. Reads can use their snapshot
 * immediately; only writes must await commit before cold activation succeeds.
 * @template T
 * @param {'readonly' | 'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} operation
 * @returns {Promise<T | undefined>}
 */
async function cacheRequest(mode, operation) {
    const pending = initialConnection;
    initialConnection = null;
    const db = await (pending || openDatabase());
    if (!db) return undefined;
    try {
        return await new Promise(resolve => {
            const transaction = db.transaction(STORE_NAME, mode);
            /** @type {T | undefined} */
            let result;
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => resolve(undefined);
            const request = operation(transaction.objectStore(STORE_NAME));
            request.onsuccess = () => {
                result = request.result;
                if (mode === 'readonly') resolve(result);
            };
        });
    } catch {
        return undefined;
    } finally {
        db.close();
    }
}

/** @type {Promise<IndexedDictionary> | null} */
let dictionaryPromise = null;

/** @returns {Promise<IndexedDictionary>} */
export function loadDictionary() {
    if (!dictionaryPromise) {
        dictionaryPromise = (async () => {
            const cached = await cacheRequest('readonly', store => store.get(SOURCE_URL));
            if (isPackedDictionary(cached)) return createDictionaryIndex(cached);

            const response = await fetch(SOURCE_URL);
            if (!response.ok) throw new Error(`嘸蝦米字典載入失敗（HTTP ${response.status}）`);
            const dictionary = /** @type {Dictionary} */ (await response.json());
            const table = packDictionary(dictionary);
            await cacheRequest('readwrite', store => store.put(table, SOURCE_URL));
            return createDictionaryIndex(table);
        })().catch(error => {
            dictionaryPromise = null;
            throw error;
        });
    }
    return dictionaryPromise;
}
