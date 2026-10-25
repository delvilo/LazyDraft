import {
    decodeSnapshot,
    encodeSnapshot,
    canonicalizeNotesText
} from '../../js/tabbypad/backup-core.js';

export const DRIVE_APP_PROPERTY_KEY = 'app';
export const DRIVE_APP_PROPERTY_VALUE = 'tabbypad';
export const DRIVE_SCHEMA_PROPERTY_KEY = 'schema';
export const DRIVE_SCHEMA_PROPERTY_VALUE = '1';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GSI_CLIENT_URL = 'https://accounts.google.com/gsi/client';
export const MAX_RETAINED_BACKUPS = 5;

/**
 * Thrown when a cloud backup payload is invalid, corrupted, or has an unsupported schema.
 * Transport errors (network, 429, 5xx) must NOT use this class.
 */
export class SnapshotCorruptionError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = 'SnapshotCorruptionError';
    }
}

/**
 * @typedef {Object} DriveAccount
 * @property {string} displayName
 * @property {string} emailAddress
 * @property {string} photoLink
 */

/**
 * @typedef {Object} DriveBackupFile
 * @property {string} id
 * @property {string} name
 * @property {string} createdTime
 * @property {string} size
 * @property {number | null} noteCount
 * @property {Record<string, string>} appProperties
 */

/**
 * @typedef {'idle' | 'loading' | 'configured' | 'unconfigured' | 'error'} DriveConfigStatus
 */

/**
 * @typedef {'idle' | 'loading' | 'ready' | 'error'} DriveSdkStatus
 */

/**
 * @typedef {Object} DriveConfigFile
 * @property {string} clientId
 */

/**
 * @typedef {Object} DriveStatus
 * @property {DriveConfigStatus} configStatus
 * @property {boolean} isConfigured
 * @property {DriveSdkStatus} sdkStatus
 * @property {boolean} isReadyToConnect
 * @property {boolean} isConnected
 * @property {boolean} isBusy
 * @property {DriveAccount | null} account
 */

/**
 * @typedef {Object} BackupOperationResult
 * @property {'success' | 'already_backed_up'} status
 * @property {string} fileId
 * @property {number} prunedCount
 * @property {boolean} cleanupIncomplete
 */

/** @type {string | null} */
let _accessToken = null;

/** @type {number} */
let _tokenExpiresAt = 0;

/** @type {DriveAccount | null} */
let _currentAccount = null;

/** @type {DriveConfigFile | null} */
let _config = null;

/** @type {DriveConfigStatus} */
let _configStatus = 'idle';

/** @type {DriveSdkStatus} */
let _sdkStatus = 'idle';

/** @type {(() => void) | null} */
let _pendingAuthCancel = null;

/** @type {boolean} */
let _isBusy = false;

/** @type {number} */
let _authSessionId = 0;

/** @type {Set<(status: DriveStatus) => void>} */
const _stateListeners = new Set();

function notifyStateChange() {
    const status = getClientStatus();
    for (const listener of _stateListeners) {
        try {
            listener(status);
        } catch {
            // Listener errors must not interrupt state transitions
        }
    }
}

/**
 * @returns {DriveStatus}
 */
function getClientStatus() {
    const isConnected = Boolean(_accessToken && _currentAccount && Date.now() < _tokenExpiresAt);
    return {
        configStatus: _configStatus,
        isConfigured: _configStatus === 'configured',
        sdkStatus: _sdkStatus,
        isReadyToConnect: _configStatus === 'configured' && _sdkStatus === 'ready',
        isConnected,
        isBusy: _isBusy,
        account: _currentAccount ? { ..._currentAccount } : null
    };
}

/**
 * @returns {string}
 */
function getValidAccessToken() {
    if (!_accessToken || !_currentAccount || Date.now() >= _tokenExpiresAt - 30000) {
        _accessToken = null;
        _tokenExpiresAt = 0;
        _currentAccount = null;
        notifyStateChange();
        throw new Error('Google Drive authorization has expired. Please connect again.');
    }
    return _accessToken;
}

/**
 * @param {string} token
 * @returns {Promise<DriveAccount>}
 */
async function fetchVerifiedAccount(token) {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)', {
        headers: {
            'Authorization': `Bearer ${token}`
        },
        cache: 'no-store'
    });

    if (!res.ok) {
        throw new Error(`Failed to verify Google account: HTTP ${res.status}`);
    }

    const data = await res.json();
    const user = data.user;
    if (!user || typeof user.emailAddress !== 'string' || !user.emailAddress) {
        throw new Error('Google Drive account verification returned no email address');
    }

    return {
        displayName: typeof user.displayName === 'string' && user.displayName ? user.displayName : user.emailAddress,
        emailAddress: user.emailAddress,
        photoLink: typeof user.photoLink === 'string' ? user.photoLink : ''
    };
}

/**
 * @param {string} token
 * @returns {Promise<{ files: DriveBackupFile[], incompleteSearch: boolean, invalidTimestamp: boolean }>}
 */
async function fetchAllBackupFiles(token) {
    let pageToken = undefined;
    /** @type {DriveBackupFile[]} */
    const validFiles = [];
    let hadIncompleteSearch = false;
    let hadInvalidTimestamp = false;
    const seenIds = new Set();
    const seenPageTokens = new Set();

    do {
        const params = new URLSearchParams({
            spaces: 'appDataFolder',
            q: `appProperties has { key='${DRIVE_APP_PROPERTY_KEY}' and value='${DRIVE_APP_PROPERTY_VALUE}' } and appProperties has { key='${DRIVE_SCHEMA_PROPERTY_KEY}' and value='${DRIVE_SCHEMA_PROPERTY_VALUE}' } and trashed = false`,
            fields: 'nextPageToken,incompleteSearch,files(id,name,createdTime,size,appProperties,trashed)',
            pageSize: '100',
            orderBy: 'createdTime desc'
        });
        if (pageToken) {
            params.set('pageToken', pageToken);
        }

        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error(`Failed to list backups from Google Drive: HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)
            || (data.files !== undefined && !Array.isArray(data.files))
            || (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')
            || (data.incompleteSearch !== undefined && typeof data.incompleteSearch !== 'boolean')) {
            throw new Error('Google Drive returned an invalid backup listing');
        }
        if (data.incompleteSearch) {
            hadIncompleteSearch = true;
        }

        if (Array.isArray(data.files)) {
            for (const file of data.files) {
                if (!file || typeof file !== 'object' || Array.isArray(file)) {
                    throw new Error('Google Drive returned invalid backup metadata');
                }
                if (file.trashed) continue;
                if (
                    file.appProperties?.[DRIVE_APP_PROPERTY_KEY] !== DRIVE_APP_PROPERTY_VALUE ||
                    file.appProperties?.[DRIVE_SCHEMA_PROPERTY_KEY] !== DRIVE_SCHEMA_PROPERTY_VALUE
                ) {
                    continue;
                }
                if (typeof file.id !== 'string' || !file.id || seenIds.has(file.id)) {
                    throw new Error('Google Drive returned missing or duplicate backup IDs');
                }
                seenIds.add(file.id);
                if (typeof file.createdTime !== 'string') {
                    hadInvalidTimestamp = true;
                    continue;
                }
                const createdTimeMs = Date.parse(file.createdTime);
                if (isNaN(createdTimeMs)) {
                    hadInvalidTimestamp = true;
                    continue;
                }

                let noteCount = null;
                const rawCount = file.appProperties?.noteCount;
                if (typeof rawCount === 'string' && /^\d+$/.test(rawCount)) {
                    const parsed = parseInt(rawCount, 10);
                    if (Number.isSafeInteger(parsed) && parsed >= 0) {
                        noteCount = parsed;
                    }
                }

                validFiles.push({
                    id: file.id,
                    name: typeof file.name === 'string' ? file.name : '',
                    createdTime: file.createdTime,
                    size: typeof file.size === 'string' ? file.size : '0',
                    noteCount,
                    appProperties: file.appProperties
                });
            }
        }

        pageToken = data.nextPageToken;
        if (pageToken) {
            if (seenPageTokens.has(pageToken)) throw new Error('Google Drive repeated a backup-list page token');
            seenPageTokens.add(pageToken);
        }
    } while (pageToken);

    validFiles.sort((a, b) => {
        const diff = Date.parse(b.createdTime) - Date.parse(a.createdTime);
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
    });

    return {
        files: validFiles,
        incompleteSearch: hadIncompleteSearch,
        invalidTimestamp: hadInvalidTimestamp
    };
}

/**
 * @param {string} token
 * @param {() => void} assertSessionActive
 * @returns {Promise<{ prunedCount: number, cleanupIncomplete: boolean }>}
 */
async function pruneOlderBackups(token, assertSessionActive) {
    let prunedCount = 0;
    let cleanupIncomplete = false;

    try {
        assertSessionActive();
        const listResult = await fetchAllBackupFiles(token);
        assertSessionActive();

        if (listResult.incompleteSearch || listResult.invalidTimestamp) {
            return { prunedCount: 0, cleanupIncomplete: true };
        }

        if (listResult.files.length <= MAX_RETAINED_BACKUPS) {
            return { prunedCount: 0, cleanupIncomplete: false };
        }

        const filesToPrune = listResult.files.slice(MAX_RETAINED_BACKUPS);
        for (const file of filesToPrune) {
            assertSessionActive();
            try {
                const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    cache: 'no-store'
                });
                if (delRes.status === 204 || delRes.status === 200) {
                    prunedCount++;
                } else if (delRes.status === 404) {
                    prunedCount++;
                } else {
                    cleanupIncomplete = true;
                }
            } catch {
                cleanupIncomplete = true;
            }
        }
    } catch {
        cleanupIncomplete = true;
    }

    return { prunedCount, cleanupIncomplete };
}

/**
 * Lazy loads Google Identity Services SDK
 * @returns {Promise<void>}
 */
async function loadGsiScript() {
    if (_sdkStatus === 'ready' || _sdkStatus === 'loading') return;
    _sdkStatus = 'loading';
    notifyStateChange();

    try {
        if (!window.google?.accounts?.oauth2) {
            await new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[src="${GSI_CLIENT_URL}"]`);
                if (existing) {
                    existing.addEventListener('load', () => resolve(undefined));
                    existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity SDK')));
                    return;
                }
                const script = document.createElement('script');
                script.src = GSI_CLIENT_URL;
                script.async = true;
                script.defer = true;
                script.onload = () => resolve(undefined);
                script.onerror = () => reject(new Error('Failed to load Google Identity SDK'));
                document.head.appendChild(script);
            });
        }

        if (!window.google?.accounts?.oauth2 || !_config?.clientId) {
            throw new Error('Google Identity Services SDK could not be initialized');
        }

        _sdkStatus = 'ready';
    } catch {
        _sdkStatus = 'error';
    }

    notifyStateChange();
}

export const driveClient = {
    /**
     * @returns {Promise<DriveStatus>}
     */
    async init() {
        if (_configStatus === 'loading') {
            return getClientStatus();
        }
        if (_configStatus !== 'idle') {
            return getClientStatus();
        }

        _configStatus = 'loading';
        notifyStateChange();

        try {
            const configUrl = new URL('../drive-config.json', import.meta.url).href;
            const res = await fetch(configUrl, { cache: 'no-store' });
            if (!res.ok) {
                _configStatus = 'unconfigured';
                _config = null;
            } else {
                const data = await res.json();
                if (data && typeof data.clientId === 'string' && data.clientId.trim().length > 0) {
                    _config = { clientId: data.clientId.trim() };
                    _configStatus = 'configured';
                } else {
                    _configStatus = 'unconfigured';
                    _config = null;
                }
            }
        } catch {
            _configStatus = 'unconfigured';
            _config = null;
        }

        notifyStateChange();

        if (_configStatus === 'configured' && _config) {
            await loadGsiScript();
        }

        return getClientStatus();
    },

    /**
     * @returns {DriveStatus}
     */
    getStatus() {
        return getClientStatus();
    },

    /**
     * Monotonic session generation id to guard async requests across account switches
     * @returns {number}
     */
    getAuthSessionId() {
        return _authSessionId;
    },

    /**
     * @returns {DriveAccount | null}
     */
    getAccount() {
        return _currentAccount ? { ..._currentAccount } : null;
    },

    /**
     * @param {(status: DriveStatus) => void} listener
     * @returns {() => void}
     */
    onStateChange(listener) {
        _stateListeners.add(listener);
        return () => {
            _stateListeners.delete(listener);
        };
    },

    /**
     * Connects Google account.
     * initTokenClient and requestAccessToken run synchronously from the user gesture.
     * Candidate token remains uncommitted until about.get verification succeeds.
     * @returns {Promise<DriveAccount>}
     */
    connect() {
        const clientId = _config?.clientId;
        const oauth2 = window.google?.accounts?.oauth2;
        if (_configStatus !== 'configured' || !clientId) {
            return Promise.reject(new Error('Google Drive is not configured. Missing Client ID.'));
        }
        if (_sdkStatus !== 'ready' || !oauth2) {
            return Promise.reject(new Error('Google Identity Services SDK is not ready yet.'));
        }
        if (_isBusy) {
            return Promise.reject(new Error('A cloud operation or authorization is already in progress.'));
        }

        const attemptId = ++_authSessionId;
        _isBusy = true;
        notifyStateChange();

        return new Promise((resolve, reject) => {
            let attemptActive = true;
            _pendingAuthCancel = () => {
                if (!attemptActive) return;
                attemptActive = false;
                reject(new Error('Authorization attempt cancelled'));
            };

            const client = oauth2.initTokenClient({
                client_id: clientId,
                scope: DRIVE_APPDATA_SCOPE,
                include_granted_scopes: false,
                callback: async (response) => {
                    if (!attemptActive || attemptId !== _authSessionId) return;

                    if (response.error) {
                        attemptActive = false;
                        _isBusy = false;
                        notifyStateChange();
                        reject(new Error(`Google authorization failed: ${response.error_description || response.error}`));
                        return;
                    }

                    if (!response.access_token) {
                        attemptActive = false;
                        _isBusy = false;
                        notifyStateChange();
                        reject(new Error('Google authorization returned no access token'));
                        return;
                    }

                    if (!window.google?.accounts?.oauth2?.hasGrantedAllScopes(response, DRIVE_APPDATA_SCOPE)) {
                        attemptActive = false;
                        _isBusy = false;
                        notifyStateChange();
                        reject(new Error('Permission to Google Drive app data was denied'));
                        return;
                    }

                    const candidateToken = response.access_token;
                    const expiresInSec = typeof response.expires_in === 'number'
                        ? response.expires_in
                        : parseInt(String(response.expires_in || '3600'), 10);
                    const candidateExpiresAt = Date.now() + (Number.isFinite(expiresInSec) ? expiresInSec : 3600) * 1000;

                    try {
                        const verifiedAccount = await fetchVerifiedAccount(candidateToken);

                        if (!attemptActive || attemptId !== _authSessionId) {
                            return;
                        }

                        _accessToken = candidateToken;
                        _tokenExpiresAt = candidateExpiresAt;
                        _currentAccount = verifiedAccount;
                        _isBusy = false;
                        attemptActive = false;
                        notifyStateChange();
                        resolve(verifiedAccount);
                    } catch (err) {
                        if (!attemptActive || attemptId !== _authSessionId) return;
                        attemptActive = false;
                        _isBusy = false;
                        notifyStateChange();
                        reject(err instanceof Error ? err : new Error(String(err)));
                    }
                },
                error_callback: (err) => {
                    if (!attemptActive || attemptId !== _authSessionId) return;
                    attemptActive = false;
                    _isBusy = false;
                    notifyStateChange();
                    reject(new Error(err?.message || 'Google authorization window closed or failed'));
                }
            });

            try {
                client.requestAccessToken({ prompt: '' });
            } catch (err) {
                attemptActive = false;
                _isBusy = false;
                notifyStateChange();
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    },

    /**
     * Clears local RAM session state without revoking or deleting cloud data.
     */
    disconnect() {
        _authSessionId++;
        if (_pendingAuthCancel) {
            _pendingAuthCancel();
            _pendingAuthCancel = null;
        }
        _accessToken = null;
        _tokenExpiresAt = 0;
        _currentAccount = null;
        _isBusy = false;
        notifyStateChange();
    },

    /**
     * @returns {Promise<DriveBackupFile[]>}
     */
    async listBackups() {
        const token = getValidAccessToken();
        const { files } = await fetchAllBackupFiles(token);
        return files;
    },

    /**
     * Reads a backup snapshot. Throws SnapshotCorruptionError on malformed/unsupported snapshots.
     * Throws standard Error on transport/network/auth failures.
     * Note: spaces belongs to files.list, not files.get.
     * @param {string} fileId
     * @returns {Promise<{ metadata: DriveBackupFile, snapshot: import('../../js/tabbypad/backup-core.js').CloudSnapshot }>}
     */
    async readBackup(fileId) {
        if (typeof fileId !== 'string' || !fileId.trim()) {
            throw new TypeError('File ID must be a non-empty string');
        }
        const token = getValidAccessToken();

        const metaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,createdTime,size,appProperties,trashed`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                cache: 'no-store'
            }
        );

        if (metaRes.status === 404) {
            throw new SnapshotCorruptionError('Backup file was deleted or not found');
        }

        if (!metaRes.ok) {
            throw new Error(`Failed to fetch backup metadata: HTTP ${metaRes.status}`);
        }

        const meta = await metaRes.json();
        if (meta.trashed) {
            throw new SnapshotCorruptionError('Selected backup file is trashed');
        }
        if (
            meta.appProperties?.[DRIVE_APP_PROPERTY_KEY] !== DRIVE_APP_PROPERTY_VALUE ||
            meta.appProperties?.[DRIVE_SCHEMA_PROPERTY_KEY] !== DRIVE_SCHEMA_PROPERTY_VALUE
        ) {
            throw new SnapshotCorruptionError('File does not belong to Tabbypad or uses an unsupported schema');
        }

        const contentRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                cache: 'no-store'
            }
        );

        if (contentRes.status === 404) {
            throw new SnapshotCorruptionError('Backup file content was deleted or not found');
        }

        if (!contentRes.ok) {
            throw new Error(`Failed to download backup content: HTTP ${contentRes.status}`);
        }

        const text = await contentRes.text();
        let snapshot;
        try {
            snapshot = decodeSnapshot(text);
        } catch (err) {
            throw new SnapshotCorruptionError(err instanceof Error ? err.message : 'Corrupt snapshot payload');
        }

        let noteCount = null;
        const rawCount = meta.appProperties?.noteCount;
        if (typeof rawCount === 'string' && /^\d+$/.test(rawCount)) {
            const parsed = parseInt(rawCount, 10);
            if (Number.isSafeInteger(parsed) && parsed >= 0) {
                noteCount = parsed;
            }
        }

        return {
            metadata: {
                id: meta.id,
                name: typeof meta.name === 'string' ? meta.name : '',
                createdTime: meta.createdTime,
                size: typeof meta.size === 'string' ? meta.size : String(text.length),
                noteCount,
                appProperties: meta.appProperties
            },
            snapshot
        };
    },

    /**
     * @param {import('../../js/tabbypad/backup-core.js').Note[]} committedNotes
     * @returns {Promise<BackupOperationResult>}
     */
    async backup(committedNotes) {
        if (!Array.isArray(committedNotes) || committedNotes.length === 0) {
            throw new Error('Cannot backup an empty notebook');
        }

        const token = getValidAccessToken();
        const opSessionId = _authSessionId;
        const opAccountEmail = _currentAccount?.emailAddress;

        const assertSessionActive = () => {
            if (_authSessionId !== opSessionId || _currentAccount?.emailAddress !== opAccountEmail) {
                throw new Error('Google Drive account or session changed during operation');
            }
        };

        const snapshotText = encodeSnapshot(committedNotes);
        const committedCanonicalText = canonicalizeNotesText(committedNotes);

        const listResult = await fetchAllBackupFiles(token);
        assertSessionActive();

        let latestValidSnapshot = null;
        let latestValidFile = null;

        for (const file of listResult.files) {
            try {
                assertSessionActive();
                const readResult = await this.readBackup(file.id);
                latestValidSnapshot = readResult.snapshot;
                latestValidFile = file;
                break;
            } catch (err) {
                if (err instanceof SnapshotCorruptionError) {
                    continue;
                }
                throw err;
            }
        }

        if (latestValidSnapshot && latestValidFile) {
            const latestCanonicalText = canonicalizeNotesText(latestValidSnapshot.notes);
            if (latestCanonicalText === committedCanonicalText) {
                const pruneResult = await pruneOlderBackups(token, assertSessionActive);
                assertSessionActive();
                return {
                    status: 'already_backed_up',
                    fileId: latestValidFile.id,
                    prunedCount: pruneResult.prunedCount,
                    cleanupIncomplete: pruneResult.cleanupIncomplete
                };
            }
        }

        assertSessionActive();

        const genRes = await fetch('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=appDataFolder', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-store'
        });

        if (!genRes.ok) {
            throw new Error(`Failed to generate Drive file ID: HTTP ${genRes.status}`);
        }

        const genData = await genRes.json();
        if (!Array.isArray(genData.ids) || genData.ids.length === 0 || typeof genData.ids[0] !== 'string' || !genData.ids[0]) {
            throw new Error('Drive generateIds returned empty or invalid IDs');
        }
        const generatedId = genData.ids[0];

        assertSessionActive();

        const timestampIso = new Date().toISOString();
        /** @type {Record<string, unknown>} */
        const fileMetadata = {
            id: generatedId,
            name: `tabbypad-backup-${timestampIso.replace(/[:.]/g, '-')}.json`,
            parents: ['appDataFolder'],
            mimeType: 'application/json',
            appProperties: {
                [DRIVE_APP_PROPERTY_KEY]: DRIVE_APP_PROPERTY_VALUE,
                [DRIVE_SCHEMA_PROPERTY_KEY]: DRIVE_SCHEMA_PROPERTY_VALUE,
                noteCount: String(committedNotes.length)
            }
        };

        const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': 'application/json'
            },
            body: JSON.stringify(fileMetadata),
            cache: 'no-store'
        });

        if (!initRes.ok) {
            throw new Error(`Failed to initiate resumable backup upload: HTTP ${initRes.status}`);
        }

        const locationHeader = initRes.headers.get('Location');
        if (!locationHeader) {
            throw new Error('Resumable upload response missing Location header');
        }

        const locationUrl = new URL(locationHeader);
        if (locationUrl.protocol !== 'https:') {
            throw new Error('Resumable upload URL must use HTTPS');
        }
        const isAllowedHost = (locationUrl.hostname === 'www.googleapis.com' || locationUrl.hostname === 'googleapis.com');
        const isStandardPort = (locationUrl.port === '' || locationUrl.port === '443');
        if (!isAllowedHost || !isStandardPort) {
            throw new Error('Resumable upload URL origin must be googleapis.com on standard HTTPS port');
        }
        if (!/^\/upload\/drive\/v3\/files(\/|\?|$)/.test(locationUrl.pathname)) {
            throw new Error('Resumable upload URL path must be a Drive upload path');
        }

        assertSessionActive();

        // Browser derives Content-Length automatically; session URL authorizes content upload
        const uploadRes = await fetch(locationUrl.href, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: snapshotText,
            cache: 'no-store'
        });

        if (!uploadRes.ok) {
            throw new Error(`Failed to upload backup payload: HTTP ${uploadRes.status}`);
        }

        const uploadData = await uploadRes.json();
        const uploadedFileId = uploadData.id || generatedId;
        if (!uploadedFileId) {
            throw new Error('Created backup file ID missing from upload response');
        }

        assertSessionActive();

        const readBack = await this.readBackup(uploadedFileId);
        const readBackCanonical = canonicalizeNotesText(readBack.snapshot.notes);
        if (readBackCanonical !== committedCanonicalText) {
            throw new Error('Readback verification failed: cloud data does not match committed notes');
        }

        assertSessionActive();
        const pruneResult = await pruneOlderBackups(token, assertSessionActive);
        assertSessionActive();

        return {
            status: 'success',
            fileId: uploadedFileId,
            prunedCount: pruneResult.prunedCount,
            cleanupIncomplete: pruneResult.cleanupIncomplete
        };
    }
};
