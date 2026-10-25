import {
    planRestore
} from '../../js/tabbypad/backup-core.js';

import {
    driveClient
} from './drive-client.js';

/**
 * @typedef {'backup' | 'restore'} DialogMode
 */

/**
 * @typedef {Object} RestorePreviewContext
 * @property {number} generation
 * @property {number} accountSession
 * @property {string} backupId
 * @property {import('../../js/tabbypad/backup-core.js').RestoreMode} mode
 * @property {import('../../js/tabbypad/backup-core.js').NotebookState} baseline
 * @property {() => boolean} editorGuard
 * @property {import('../../js/tabbypad/backup-core.js').RestorePlan} plan
 */

/**
 * @typedef {Object} UndoConfirmationContext
 * @property {string} checkpointId
 * @property {import('../../js/tabbypad/backup-core.js').NotebookState} baseline
 * @property {() => boolean} editorGuard
 * @property {number} noteCount
 * @property {string} createdAt
 */

/**
 * @typedef {Object} DomElements
 * @property {HTMLElement} cloudModal
 * @property {HTMLElement} modalLabel
 * @property {HTMLButtonElement} backupBtn
 * @property {HTMLButtonElement} restoreBtn
 * @property {HTMLElement} cloudAuthBar
 * @property {HTMLElement} cloudConfigNotice
 * @property {HTMLElement} cloudDisconnectedState
 * @property {HTMLElement} cloudConnectedState
 * @property {HTMLElement} cloudConnectingState
 * @property {HTMLElement} cloudAccountDisplay
 * @property {HTMLButtonElement} cloudConnectBtn
 * @property {HTMLButtonElement} cloudDisconnectBtn
 * @property {HTMLElement} cloudStatusAlert
 * @property {HTMLElement} editorDirtyAlert
 * @property {HTMLButtonElement} saveEditorBtn
 * @property {HTMLElement} cloudBackupView
 * @property {HTMLElement} backupLocalNoteCount
 * @property {HTMLButtonElement} confirmBackupBtn
 * @property {HTMLElement} cloudRestoreView
 * @property {HTMLElement} localRecoverySection
 * @property {HTMLElement} recoveryCheckpointInfo
 * @property {HTMLButtonElement} undoRestoreBtn
 * @property {HTMLElement} undoConfirmSection
 * @property {HTMLElement} undoConfirmText
 * @property {HTMLButtonElement} confirmUndoBtn
 * @property {HTMLButtonElement} cancelUndoBtn
 * @property {HTMLElement} cloudRestoreSection
 * @property {HTMLElement} cloudBackupsLoading
 * @property {HTMLElement} cloudBackupsEmpty
 * @property {HTMLElement} cloudBackupsListContainer
 * @property {HTMLElement} restoreModeSection
 * @property {HTMLInputElement} restoreModeMerge
 * @property {HTMLInputElement} restoreModeOverwrite
 * @property {HTMLElement} overwriteConfirmSection
 * @property {HTMLElement} overwriteCountsText
 * @property {HTMLInputElement} confirmOverwriteCheckbox
 * @property {HTMLElement} restorePreviewSection
 * @property {HTMLButtonElement} recalculatePreviewBtn
 * @property {HTMLElement} previewLoading
 * @property {HTMLElement} previewContent
 * @property {HTMLElement} previewAddedCount
 * @property {HTMLElement} previewUpdatedCount
 * @property {HTMLElement} previewConflictCount
 * @property {HTMLElement} previewUnchangedCount
 * @property {HTMLElement} previewFinalCount
 * @property {HTMLElement} previewNoOpNotice
 * @property {HTMLButtonElement} applyRestoreBtn
 */

/** @type {DialogMode} */
let _currentMode = 'backup';

let _isModalTransitioning = false;
let _isOperationBusy = false;

let _previewGeneration = 0;
let _listGeneration = 0;
let _lastAuthSession = driveClient.getAuthSessionId();

/** @type {RestorePreviewContext | null} */
let _activePreview = null;

/** @type {UndoConfirmationContext | null} */
let _pendingUndo = null;

/** @type {string | null} */
let _selectedBackupId = null;

/** @type {import('../../js/tabbypad/backup-core.js').RestoreMode} */
let _selectedRestoreMode = 'merge';

/** @type {DomElements | null} */
let _dom = null;

/**
 * Validates and caches strongly-typed references to all required DOM elements
 * @returns {DomElements}
 */
function getDom() {
    if (_dom) return _dom;

    /**
     * @template {HTMLElement} T
     * @param {string} id
     * @param {new () => T} kind
     * @returns {T}
     */
    function req(id, kind) {
        const element = document.getElementById(id);
        if (!(element instanceof kind)) throw new Error(`Invalid required element #${id}`);
        return element;
    }

    _dom = {
        cloudModal: req('cloudModal', HTMLElement),
        modalLabel: req('cloudModalLabel', HTMLElement),
        backupBtn: req('backupBtn', HTMLButtonElement),
        restoreBtn: req('restoreBtn', HTMLButtonElement),
        cloudAuthBar: req('cloudAuthBar', HTMLElement),
        cloudConfigNotice: req('cloudConfigNotice', HTMLElement),
        cloudDisconnectedState: req('cloudDisconnectedState', HTMLElement),
        cloudConnectedState: req('cloudConnectedState', HTMLElement),
        cloudConnectingState: req('cloudConnectingState', HTMLElement),
        cloudAccountDisplay: req('cloudAccountDisplay', HTMLElement),
        cloudConnectBtn: req('cloudConnectBtn', HTMLButtonElement),
        cloudDisconnectBtn: req('cloudDisconnectBtn', HTMLButtonElement),
        cloudStatusAlert: req('cloudStatusAlert', HTMLElement),
        editorDirtyAlert: req('editorDirtyAlert', HTMLElement),
        saveEditorBtn: req('saveEditorBtn', HTMLButtonElement),
        cloudBackupView: req('cloudBackupView', HTMLElement),
        backupLocalNoteCount: req('backupLocalNoteCount', HTMLElement),
        confirmBackupBtn: req('confirmBackupBtn', HTMLButtonElement),
        cloudRestoreView: req('cloudRestoreView', HTMLElement),
        localRecoverySection: req('localRecoverySection', HTMLElement),
        recoveryCheckpointInfo: req('recoveryCheckpointInfo', HTMLElement),
        undoRestoreBtn: req('undoRestoreBtn', HTMLButtonElement),
        undoConfirmSection: req('undoConfirmSection', HTMLElement),
        undoConfirmText: req('undoConfirmText', HTMLElement),
        confirmUndoBtn: req('confirmUndoBtn', HTMLButtonElement),
        cancelUndoBtn: req('cancelUndoBtn', HTMLButtonElement),
        cloudRestoreSection: req('cloudRestoreSection', HTMLElement),
        cloudBackupsLoading: req('cloudBackupsLoading', HTMLElement),
        cloudBackupsEmpty: req('cloudBackupsEmpty', HTMLElement),
        cloudBackupsListContainer: req('cloudBackupsListContainer', HTMLElement),
        restoreModeSection: req('restoreModeSection', HTMLElement),
        restoreModeMerge: req('restoreModeMerge', HTMLInputElement),
        restoreModeOverwrite: req('restoreModeOverwrite', HTMLInputElement),
        overwriteConfirmSection: req('overwriteConfirmSection', HTMLElement),
        overwriteCountsText: req('overwriteCountsText', HTMLElement),
        confirmOverwriteCheckbox: req('confirmOverwriteCheckbox', HTMLInputElement),
        restorePreviewSection: req('restorePreviewSection', HTMLElement),
        recalculatePreviewBtn: req('recalculatePreviewBtn', HTMLButtonElement),
        previewLoading: req('previewLoading', HTMLElement),
        previewContent: req('previewContent', HTMLElement),
        previewAddedCount: req('previewAddedCount', HTMLElement),
        previewUpdatedCount: req('previewUpdatedCount', HTMLElement),
        previewConflictCount: req('previewConflictCount', HTMLElement),
        previewUnchangedCount: req('previewUnchangedCount', HTMLElement),
        previewFinalCount: req('previewFinalCount', HTMLElement),
        previewNoOpNotice: req('previewNoOpNotice', HTMLElement),
        applyRestoreBtn: req('applyRestoreBtn', HTMLButtonElement)
    };

    return _dom;
}

function invalidatePreview() {
    _previewGeneration++;
    _activePreview = null;
    const dom = getDom();
    dom.confirmOverwriteCheckbox.checked = false;
    dom.overwriteConfirmSection.style.display = 'none';
    dom.applyRestoreBtn.disabled = true;
    dom.previewLoading.style.display = 'none';
    dom.previewContent.style.display = 'none';
}

function showModal() {
    const dom = getDom();
    if (_isModalTransitioning) return;
    $(dom.cloudModal).modal({ backdrop: 'static', keyboard: true });
    $(dom.cloudModal).modal('show');
}

/**
 * @param {string | null} message
 * @param {'info' | 'success' | 'warning' | 'danger'} [level]
 */
function setStatusAlert(message, level = 'info') {
    const dom = getDom();
    if (!message) {
        dom.cloudStatusAlert.style.display = 'none';
        dom.cloudStatusAlert.textContent = '';
        return;
    }
    dom.cloudStatusAlert.className = `alert alert-${level} mb-3`;
    dom.cloudStatusAlert.textContent = message;
    dom.cloudStatusAlert.style.display = 'block';
}

/**
 * @returns {boolean}
 */
function checkEditorDirtyState() {
    const dom = getDom();
    const isDirty = Boolean(window.TabbypadEditor && window.TabbypadEditor.hasUnsavedChanges());
    dom.editorDirtyAlert.style.display = isDirty ? 'block' : 'none';
    return isDirty;
}

/**
 * @param {string} isoString
 * @returns {string}
 */
function formatTimestamp(isoString) {
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return isoString;
        return date.toLocaleString();
    } catch {
        return isoString;
    }
}

/**
 * Renders auth controls without early return so offline local recovery is never blocked.
 * Avoids Bootstrap d-flex class conflicts that override display: none.
 * @param {import('./drive-client.js').DriveStatus} status
 */
function updateAuthUI(status) {
    const dom = getDom();
    const session = driveClient.getAuthSessionId();
    if (session !== _lastAuthSession || !status.isConnected) {
        _lastAuthSession = session;
        _listGeneration++;
        _selectedBackupId = null;
        invalidatePreview();
    }

    dom.cloudConfigNotice.hidden = true;
    dom.cloudConfigNotice.style.display = 'none';
    dom.cloudDisconnectedState.hidden = true;
    dom.cloudDisconnectedState.style.display = 'none';
    dom.cloudConnectedState.hidden = true;
    dom.cloudConnectedState.style.display = 'none';
    dom.cloudConnectingState.hidden = true;
    dom.cloudConnectingState.style.display = 'none';

    if (status.isBusy && !status.isConnected) {
        dom.cloudConnectingState.hidden = false;
        dom.cloudConnectingState.style.display = 'block';
    } else if (!status.isConfigured) {
        dom.cloudConfigNotice.hidden = false;
        dom.cloudConfigNotice.style.display = 'block';
    } else if (status.isConnected && status.account) {
        dom.cloudConnectedState.hidden = false;
        dom.cloudConnectedState.style.display = 'flex';
        dom.cloudAccountDisplay.textContent = `${status.account.displayName} (${status.account.emailAddress})`;
    } else {
        dom.cloudDisconnectedState.hidden = false;
        dom.cloudDisconnectedState.style.display = 'flex';
        dom.cloudConnectBtn.disabled = !status.isReadyToConnect;
    }

    refreshViewContent();
}

/**
 * Refreshes view-specific contents. Always renders local recovery in Restore view.
 */
async function refreshViewContent() {
    const dom = getDom();
    checkEditorDirtyState();
    const status = driveClient.getStatus();
    const mode = _currentMode;
    const generation = _listGeneration;
    const isCurrent = () => mode === _currentMode && generation === _listGeneration;

    if (_currentMode === 'backup') {
        dom.modalLabel.textContent = 'Google Drive Backup';
        dom.cloudBackupView.hidden = false;
        dom.cloudBackupView.style.display = 'block';
        dom.cloudRestoreView.hidden = true;
        dom.cloudRestoreView.style.display = 'none';
        try {
            if (window.TabbypadStorage) {
                const notes = await window.TabbypadStorage.getAllNotes();
                if (!isCurrent()) return;
                const count = notes.length;
                dom.backupLocalNoteCount.textContent = String(count);
                dom.confirmBackupBtn.disabled = (!status.isConnected || count === 0 || _isOperationBusy);
            }
        } catch {
            if (!isCurrent()) return;
            dom.backupLocalNoteCount.textContent = '0';
            dom.confirmBackupBtn.disabled = true;
        }
    } else {
        dom.modalLabel.textContent = 'Google Drive Restore & Recovery';
        dom.cloudBackupView.hidden = true;
        dom.cloudBackupView.style.display = 'none';
        dom.cloudRestoreView.hidden = false;
        dom.cloudRestoreView.style.display = 'block';
        await updateLocalRecoveryUI();
        if (!isCurrent()) return;

        if (status.isConnected) {
            dom.cloudRestoreSection.hidden = false;
            dom.cloudRestoreSection.style.display = 'block';
            await loadCloudBackupsList();
        } else {
            dom.cloudRestoreSection.hidden = true;
            dom.cloudBackupsListContainer.replaceChildren();
            dom.cloudBackupsEmpty.style.display = 'none';
            dom.restoreModeSection.style.display = 'none';
            dom.restorePreviewSection.style.display = 'none';
            dom.overwriteConfirmSection.style.display = 'none';
            dom.applyRestoreBtn.disabled = true;
            _activePreview = null;
            _selectedBackupId = null;
        }
    }
}

/**
 * Checks and renders local recovery checkpoint info independently of Google connection
 */
async function updateLocalRecoveryUI() {
    const dom = getDom();

    if (!window.TabbypadStorage) {
        dom.recoveryCheckpointInfo.textContent = 'Storage unavailable';
        dom.undoRestoreBtn.disabled = true;
        return;
    }

    try {
        const checkpoint = await window.TabbypadStorage.getRecoveryCheckpoint();
        if (checkpoint) {
            const formattedDate = formatTimestamp(checkpoint.createdAt);
            dom.recoveryCheckpointInfo.textContent = `Checkpoint available: ${checkpoint.noteCount} notes from ${formattedDate}`;
            dom.undoRestoreBtn.disabled = _isOperationBusy;
        } else {
            dom.recoveryCheckpointInfo.textContent = 'No local recovery point available.';
            dom.undoRestoreBtn.disabled = true;
        }
    } catch {
        dom.recoveryCheckpointInfo.textContent = 'Failed to inspect recovery checkpoint.';
        dom.undoRestoreBtn.disabled = true;
    }
}

/**
 * Loads cloud backups into the list group with both date and note counts
 */
async function loadCloudBackupsList() {
    const dom = getDom();
    const generation = ++_listGeneration;
    const accountSession = driveClient.getAuthSessionId();
    const isCurrent = () => generation === _listGeneration
        && accountSession === driveClient.getAuthSessionId()
        && _currentMode === 'restore'
        && dom.cloudModal.style.display !== 'none';

    dom.cloudBackupsLoading.style.display = 'block';
    dom.cloudBackupsEmpty.style.display = 'none';
    dom.cloudBackupsListContainer.replaceChildren();

    try {
        const backups = await driveClient.listBackups();
        if (!isCurrent()) return;
        dom.cloudBackupsLoading.style.display = 'none';

        if (backups.length === 0) {
            dom.cloudBackupsEmpty.style.display = 'block';
            dom.restoreModeSection.style.display = 'none';
            dom.restorePreviewSection.style.display = 'none';
            dom.applyRestoreBtn.disabled = true;
            _activePreview = null;
            _selectedBackupId = null;
            return;
        }

        dom.cloudBackupsListContainer.replaceChildren();
        dom.restoreModeSection.style.display = 'block';

        let firstItem = true;
        for (const backup of backups) {
            const item = document.createElement('div');
            item.className = 'list-group-item d-flex justify-content-between align-items-center py-2';
            item.setAttribute('data-id', backup.id);

            const leftDiv = document.createElement('div');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'selectedCloudBackup';
            radio.value = backup.id;
            radio.className = 'mr-2';
            radio.id = `backupRadio_${backup.id}`;

            const label = document.createElement('label');
            label.htmlFor = `backupRadio_${backup.id}`;
            label.className = 'mb-0 font-weight-bold cursor-pointer';
            label.textContent = formatTimestamp(backup.createdTime);

            leftDiv.appendChild(radio);
            leftDiv.appendChild(label);

            const metaSpan = document.createElement('span');
            const noteCountText = backup.noteCount !== null ? `${backup.noteCount} notes` : 'Notes: ?';
            const sizeNum = parseInt(backup.size || '0', 10);
            const sizeText = sizeNum > 1024 ? `${(sizeNum / 1024).toFixed(1)} KB` : `${sizeNum} B`;

            const countBadge = document.createElement('span');
            countBadge.className = 'badge badge-info mr-1';
            countBadge.textContent = noteCountText;

            const sizeBadge = document.createElement('span');
            sizeBadge.className = 'badge badge-secondary badge-pill';
            sizeBadge.textContent = sizeText;

            metaSpan.appendChild(countBadge);
            metaSpan.appendChild(sizeBadge);

            item.appendChild(leftDiv);
            item.appendChild(metaSpan);

            item.addEventListener('click', (e) => {
                if (e.target !== radio) {
                    radio.checked = true;
                }
                onSelectBackup(backup.id);
            });

            dom.cloudBackupsListContainer.appendChild(item);

            if (firstItem) {
                radio.checked = true;
                _selectedBackupId = backup.id;
                firstItem = false;
            }
        }

        if (_selectedBackupId) {
            await scheduleRestorePreview();
        }
    } catch {
        if (!isCurrent()) return;
        dom.cloudBackupsLoading.style.display = 'none';
        setStatusAlert('Failed to load cloud backups list.', 'danger');
    }
}

/**
 * @param {string} backupId
 */
async function onSelectBackup(backupId) {
    const dom = getDom();
    _selectedBackupId = backupId;
    const items = dom.cloudBackupsListContainer.querySelectorAll('.list-group-item');
    items.forEach((el) => {
        if (el.getAttribute('data-id') === backupId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    await scheduleRestorePreview();
}

/**
 * Recalculates restore preview under monotonic generation token and immutable context
 */
async function scheduleRestorePreview() {
    const dom = getDom();
    if (!_selectedBackupId || !window.TabbypadStorage) return;

    invalidatePreview();
    const generation = _previewGeneration;
    const targetBackupId = _selectedBackupId;
    const targetMode = _selectedRestoreMode;
    const accountSession = driveClient.getAuthSessionId();
    const isCurrent = () => generation === _previewGeneration
        && targetBackupId === _selectedBackupId
        && targetMode === _selectedRestoreMode
        && accountSession === driveClient.getAuthSessionId()
        && _currentMode === 'restore'
        && dom.cloudModal.style.display !== 'none';


    if (checkEditorDirtyState()) {
        setStatusAlert('Save your open note or cancel this restore.', 'warning');
        return;
    }

    dom.restorePreviewSection.hidden = false;
    dom.restorePreviewSection.style.display = 'block';
    dom.previewLoading.style.display = 'block';
    dom.previewContent.style.display = 'none';

    try {
        const editorGuard = window.TabbypadEditor ? window.TabbypadEditor.getEditorGuard() : () => true;
        const baseline = await window.TabbypadStorage.captureNotebookState();

        if (!isCurrent()) return;

        const { snapshot } = await driveClient.readBackup(targetBackupId);

        if (!isCurrent()) return;

        const postDownloadBaseline = await window.TabbypadStorage.captureNotebookState();
        if (!isCurrent()) return;
        if (
            postDownloadBaseline.revision !== baseline.revision ||
            postDownloadBaseline.canonicalText !== baseline.canonicalText
        ) {
            setStatusAlert('Local notes changed during download. Recalculate the preview before restoring.', 'warning');
            dom.previewLoading.style.display = 'none';
            return;
        }

        if (!editorGuard()) {
            setStatusAlert('Editor changed during download. Please regenerate preview.', 'warning');
            dom.previewLoading.style.display = 'none';
            return;
        }

        if (snapshot.notes.length === 0 && targetMode === 'overwrite') {
            setStatusAlert('Cannot overwrite with an empty cloud backup.', 'danger');
            dom.previewLoading.style.display = 'none';
            return;
        }

        const plan = await planRestore(baseline.notes, snapshot.notes, targetMode);

        if (!isCurrent()) return;

        _activePreview = {
            generation,
            accountSession,
            backupId: targetBackupId,
            mode: targetMode,
            baseline,
            editorGuard,
            plan
        };

        dom.previewAddedCount.textContent = String(plan.addedCount);
        dom.previewUpdatedCount.textContent = String(plan.updatedCount);
        dom.previewConflictCount.textContent = String(plan.conflictCount);
        dom.previewUnchangedCount.textContent = String(plan.unchangedCount);
        dom.previewFinalCount.textContent = String(plan.targetNotes.length);
        dom.previewNoOpNotice.style.display = plan.isNoOp ? 'block' : 'none';

        dom.previewLoading.style.display = 'none';
        dom.previewContent.style.display = 'block';

        if (targetMode === 'overwrite') {
            dom.overwriteConfirmSection.style.display = 'block';
            dom.overwriteCountsText.textContent = `Current local notes: ${baseline.notes.length} → After overwrite: ${plan.targetNotes.length}`;
            dom.confirmOverwriteCheckbox.checked = false;
            dom.applyRestoreBtn.disabled = true;
        } else {
            dom.overwriteConfirmSection.style.display = 'none';
            dom.applyRestoreBtn.disabled = false;
        }
    } catch {
        if (!isCurrent()) return;
        dom.previewLoading.style.display = 'none';
        setStatusAlert('Failed to generate restore preview.', 'danger');
    }
}

/**
 * Applies the active restore plan bound to its captured preview context
 */
async function applyActiveRestore() {
    const dom = getDom();
    if (_isOperationBusy) return;

    if (!_activePreview) {
        setStatusAlert('No valid restore plan to apply.', 'warning');
        return;
    }

    const context = _activePreview;

    if (context.accountSession !== driveClient.getAuthSessionId()) {
        setStatusAlert('Google Drive account changed. Preview invalidated.', 'warning');
        await scheduleRestorePreview();
        return;
    }

    if (checkEditorDirtyState()) {
        setStatusAlert('Save your open note or cancel this restore.', 'warning');
        return;
    }

    if (context.mode === 'overwrite' && !dom.confirmOverwriteCheckbox.checked) {
        setStatusAlert('Please confirm the overwrite warning checkbox before proceeding.', 'warning');
        return;
    }

    _isOperationBusy = true;
    dom.applyRestoreBtn.disabled = true;
    setStatusAlert('Applying restore to notebook...', 'info');

    try {
        if (!context.editorGuard()) {
            _isOperationBusy = false;
            setStatusAlert('Editor state changed. Preview invalidated, recalculating...', 'warning');
            await scheduleRestorePreview();
            return;
        }

        if (!window.TabbypadStorage) {
            throw new Error('TabbypadStorage is not available');
        }

        const result = await window.TabbypadStorage.applyRestore(context.plan, {
            expectedRevision: context.baseline.revision,
            expectedCanonicalText: context.baseline.canonicalText,
            editorGuard: context.editorGuard
        });

        if (result.success) {
            setStatusAlert(`Restore applied successfully! (${context.plan.targetNotes.length} total notes)`, 'success');
            if (window.TabbypadEditor) {
                await window.TabbypadEditor.reloadNotes();
            }
            await updateLocalRecoveryUI();
            invalidatePreview();
        }
    } catch {
        setStatusAlert('Restore aborted: local notes or editor changed concurrently. Please preview again.', 'danger');
        invalidatePreview();
    } finally {
        _isOperationBusy = false;
        await updateLocalRecoveryUI();
    }
}

/**
 * Executes guarded undo using the pre-captured checkpoint identity and baseline
 */
async function executeUndo() {
    const dom = getDom();
    if (_isOperationBusy || !window.TabbypadStorage || !_pendingUndo) return;

    const undoTarget = _pendingUndo;
    _pendingUndo = null;

    if (checkEditorDirtyState()) {
        setStatusAlert('Save your open note or cancel this recovery.', 'warning');
        dom.undoConfirmSection.style.display = 'none';
        return;
    }

    _isOperationBusy = true;
    dom.undoRestoreBtn.disabled = true;
    setStatusAlert('Reverting to recovery checkpoint...', 'info');

    try {
        if (!undoTarget.editorGuard()) {
            setStatusAlert('Editor changed before undo confirmation. Undo aborted.', 'warning');
            return;
        }

        const result = await window.TabbypadStorage.undoRestore({
            expectedCheckpointId: undoTarget.checkpointId,
            expectedRevision: undoTarget.baseline.revision,
            expectedCanonicalText: undoTarget.baseline.canonicalText,
            editorGuard: undoTarget.editorGuard
        });

        if (result.success) {
            setStatusAlert(`Undo successful! Restored ${result.restoredCount} notes.`, 'success');
            if (window.TabbypadEditor) {
                await window.TabbypadEditor.reloadNotes();
            }
            dom.undoConfirmSection.style.display = 'none';
            invalidatePreview();
        }
    } catch {
        setStatusAlert('Undo failed: notebook state was modified concurrently.', 'danger');
    } finally {
        _isOperationBusy = false;
        await updateLocalRecoveryUI();
    }
}

/**
 * Creates notebook backup with duplicate submission prevention
 */
async function executeBackup() {
    const dom = getDom();
    if (_isOperationBusy || !window.TabbypadStorage) return;

    _isOperationBusy = true;
    dom.confirmBackupBtn.disabled = true;
    setStatusAlert('Creating backup to Google Drive...', 'info');

    try {
        const { notes } = await window.TabbypadStorage.captureNotebookState();
        if (notes.length === 0) {
            setStatusAlert('Cannot backup an empty notebook.', 'warning');
            _isOperationBusy = false;
            return;
        }

        const result = await driveClient.backup(notes);

        if (result.status === 'already_backed_up') {
            let msg = 'Notes are already backed up. No changes since latest backup.';
            if (result.cleanupIncomplete) {
                msg += ' (Warning: Cleanup of older backups was incomplete)';
            }
            setStatusAlert(msg, result.cleanupIncomplete ? 'warning' : 'success');
        } else {
            let msg = `Backup completed successfully! (${notes.length} notes saved)`;
            if (result.cleanupIncomplete) {
                msg += ' (Warning: Cleanup of older backups was incomplete)';
            }
            setStatusAlert(msg, result.cleanupIncomplete ? 'warning' : 'success');
        }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown backup error';
        setStatusAlert(`Backup failed: ${errorMsg}`, 'danger');
    } finally {
        _isOperationBusy = false;
        const status = driveClient.getStatus();
        dom.confirmBackupBtn.disabled = !status.isConnected;
    }
}

export function openBackupDialog() {
    _currentMode = 'backup';
    _listGeneration++;
    invalidatePreview();
    setStatusAlert(null);
    showModal();
    updateAuthUI(driveClient.getStatus());
}

export function openRestoreDialog() {
    _currentMode = 'restore';
    _listGeneration++;
    invalidatePreview();
    _selectedRestoreMode = 'merge';
    getDom().restoreModeMerge.checked = true;
    setStatusAlert(null);
    showModal();
    updateAuthUI(driveClient.getStatus());
}

export function initDriveUI() {
    const dom = getDom();

    $(dom.cloudModal).on('show.bs.modal', () => {
        _isModalTransitioning = true;
    });
    $(dom.cloudModal).on('shown.bs.modal', () => {
        _isModalTransitioning = false;
        checkEditorDirtyState();
    });
    $(dom.cloudModal).on('hide.bs.modal', () => {
        _isModalTransitioning = true;
    });
    $(dom.cloudModal).on('hidden.bs.modal', () => {
        _isModalTransitioning = false;
        _listGeneration++;
        invalidatePreview();
        setStatusAlert(null);
        _activePreview = null;
        _pendingUndo = null;
        dom.undoConfirmSection.style.display = 'none';
        dom.confirmOverwriteCheckbox.checked = false;
        dom.applyRestoreBtn.disabled = true;
    });

    dom.backupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openBackupDialog();
    });

    dom.restoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openRestoreDialog();
    });

    dom.cloudConnectBtn.addEventListener('click', () => {
        setStatusAlert(null);
        driveClient.connect().catch((err) => {
            setStatusAlert(`Authorization failed: ${err.message}`, 'danger');
        });
    });

    dom.cloudDisconnectBtn.addEventListener('click', () => {
        driveClient.disconnect();
        _activePreview = null;
        _pendingUndo = null;
        _selectedBackupId = null;
        dom.cloudBackupsListContainer.replaceChildren();
        dom.restorePreviewSection.style.display = 'none';
        dom.undoConfirmSection.style.display = 'none';
        dom.confirmOverwriteCheckbox.checked = false;
        dom.applyRestoreBtn.disabled = true;
        setStatusAlert('Disconnected from Google Drive.', 'info');
    });

    dom.saveEditorBtn.addEventListener('click', async () => {
        if (window.TabbypadEditor && typeof window.TabbypadEditor.saveCurrentNote === 'function') {
            const saved = await window.TabbypadEditor.saveCurrentNote();
            if (saved) {
                checkEditorDirtyState();
                if (_currentMode === 'restore') {
                    await scheduleRestorePreview();
                } else {
                    await refreshViewContent();
                }
            }
        }
    });

    dom.confirmBackupBtn.addEventListener('click', () => {
        executeBackup();
    });

    dom.undoRestoreBtn.addEventListener('click', async () => {
        if (checkEditorDirtyState()) {
            setStatusAlert('Save your open note or cancel this recovery.', 'warning');
            return;
        }

        if (!window.TabbypadStorage) return;

        try {
            const checkpoint = await window.TabbypadStorage.getRecoveryCheckpoint();
            if (!checkpoint) {
                setStatusAlert('No recovery checkpoint available.', 'warning');
                return;
            }

            const editorGuard = window.TabbypadEditor ? window.TabbypadEditor.getEditorGuard() : () => true;
            const baseline = await window.TabbypadStorage.captureNotebookState();

            _pendingUndo = {
                checkpointId: checkpoint.checkpointId,
                baseline,
                editorGuard,
                noteCount: checkpoint.noteCount,
                createdAt: checkpoint.createdAt
            };

            dom.undoConfirmText.textContent = `Revert notebook to checkpoint from ${formatTimestamp(checkpoint.createdAt)} (${checkpoint.noteCount} notes)?`;
            dom.undoConfirmSection.style.display = 'block';
        } catch {
            setStatusAlert('Failed to capture recovery state.', 'danger');
        }
    });

    dom.cancelUndoBtn.addEventListener('click', () => {
        _pendingUndo = null;
        dom.undoConfirmSection.style.display = 'none';
    });

    dom.confirmUndoBtn.addEventListener('click', () => {
        executeUndo();
    });

    dom.restoreModeMerge.addEventListener('change', () => {
        if (dom.restoreModeMerge.checked) {
            _selectedRestoreMode = 'merge';
            scheduleRestorePreview();
        }
    });

    dom.restoreModeOverwrite.addEventListener('change', () => {
        if (dom.restoreModeOverwrite.checked) {
            _selectedRestoreMode = 'overwrite';
            scheduleRestorePreview();
        }
    });

    dom.confirmOverwriteCheckbox.addEventListener('change', () => {
        if (_activePreview && _activePreview.mode === 'overwrite') {
            dom.applyRestoreBtn.disabled = !dom.confirmOverwriteCheckbox.checked;
        }
    });

    dom.recalculatePreviewBtn.addEventListener('click', () => {
        scheduleRestorePreview();
    });

    dom.applyRestoreBtn.addEventListener('click', () => {
        applyActiveRestore();
    });

    driveClient.onStateChange((status) => {
        updateAuthUI(status);
    });

    if (window.TabbypadStorage && typeof window.TabbypadStorage.subscribe === 'function') {
        window.TabbypadStorage.subscribe(() => {
            if ($(dom.cloudModal).is(':visible')) {
                if (_currentMode === 'backup') {
                    refreshViewContent();
                } else if (_currentMode === 'restore') {
                    updateLocalRecoveryUI();
                    if (_activePreview && !_isOperationBusy) {
                        invalidatePreview();
                        setStatusAlert('Local notes changed. Recalculate the preview before restoring.', 'warning');
                    }
                }
            }
        });
    }

    driveClient.init().then((status) => {
        updateAuthUI(status);
    }).catch(() => {
        setStatusAlert('Google Drive could not initialize.', 'warning');
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initDriveUI());
    } else {
        initDriveUI();
    }
}
