import { toTypedKey } from '../../js/tabbypad/backup-core.js';

const gridContainer = document.getElementById('gridContainer');
const noteModal = document.getElementById('noteModal');
const fullscreenNote = document.getElementById('fullscreenNote');
const closeModal = document.getElementsByClassName('close')[0];
const saveNoteBtn = document.getElementById('saveNoteBtn');
const deleteNoteBtn = document.getElementById('deleteNoteBtn');
const copyNoteBtn = document.getElementById('copyNoteBtn');
const downloadNoteBtn = document.getElementById('downloadNoteBtn');
const downloadAllNotesBtn = document.getElementById('downloadAllNotesBtn');
const sortToggleBtn = document.getElementById('sortToggleBtn');
const sortText = document.querySelector('.sort-text');
const themeToggleBtn = document.getElementById('themeToggle');
let currentNoteId = null;
let sortOrder = 'newest';

let notes = [];
let currentBaselineRecord = null;
let editorRevision = 1;
let editorSessionId = 1;
let isSaveInProgress = false;
const themeStorageKey = 'tabbypadTheme';
const darkMetaColor = '#0f131a';
const lightMetaColor = '#f8f9fa';
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function updateThemeToggle(theme) {
    if (!themeToggleBtn) return;
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeToggleBtn.setAttribute('aria-label', label);
    themeToggleBtn.setAttribute('title', label);
}

function applyTheme(theme, persist = true) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark', isDark);
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', isDark ? darkMetaColor : lightMetaColor);
    }
    updateThemeToggle(theme);
    if (persist) {
        localStorage.setItem(themeStorageKey, theme);
    }
}

function initTheme() {
    const storedTheme = localStorage.getItem(themeStorageKey);
    const hasStoredTheme = storedTheme === 'dark' || storedTheme === 'light';
    const initialTheme = hasStoredTheme
        ? storedTheme
        : (systemThemeQuery && systemThemeQuery.matches ? 'dark' : 'light');

    applyTheme(initialTheme, hasStoredTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const nextTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
            applyTheme(nextTheme, true);
        });
    }

    if (systemThemeQuery) {
        const handleDeviceChange = (event) => {
            if (!localStorage.getItem(themeStorageKey)) {
                applyTheme(event.matches ? 'dark' : 'light', false);
            }
        };
        if (typeof systemThemeQuery.addEventListener === 'function') {
            systemThemeQuery.addEventListener('change', handleDeviceChange);
        } else if (typeof systemThemeQuery.addListener === 'function') {
            systemThemeQuery.addListener(handleDeviceChange);
        }
    }
}


async function loadNotesFromStorage() {
    if (!window.TabbypadStorage) return;
    try {
        const notesFromDB = await window.TabbypadStorage.getAllNotes();
        notes = notesFromDB || [];
        renderNotes();
    } catch (err) {
        console.error('Failed to load notes from TabbypadStorage:', err);
    }
}

function initStorage() {
    if (window.TabbypadStorage && typeof window.TabbypadStorage.subscribe === 'function') {
        window.TabbypadStorage.subscribe(() => {
            loadNotesFromStorage();
        });
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('focus', () => {
            loadNotesFromStorage();
        });
    }

    loadNotesFromStorage();
}

// Function to update the selected color in the UI and apply it to the modal
function updateSelectedColor(color) {
    const modalContent = document.querySelector('.custom-modal-content');
    
    // Remove all color classes from modal
    modalContent.classList.remove(
        'modal-pastel-yellow', 'modal-pastel-blue', 'modal-pastel-green',
        'modal-pastel-pink', 'modal-pastel-purple', 'modal-default-grid-color'
    );
    
    // Add the selected color class to modal
    const modalColorClass = `modal-${color}`;
    modalContent.classList.add(modalColorClass);
    
    // Update the selected color in the color picker
    document.querySelectorAll('.color-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    const selectedOption = document.querySelector(`.color-option[data-color="${color}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
}

function openFullscreen(note, index) {
    editorSessionId++;
    editorRevision++;

    if (typeof note === 'string') {
        fullscreenNote.value = note;
        updateSelectedColor('default-grid-color');
        currentNoteId = null;
        currentBaselineRecord = { id: null, content: note, color: 'default-grid-color' };
    } else if (note && typeof note === 'object') {
        fullscreenNote.value = note.content || '';
        const noteColor = note.color || 'default-grid-color';
        updateSelectedColor(noteColor);
        currentNoteId = note.id;
        currentBaselineRecord = { ...note };
    } else {
        fullscreenNote.value = '';
        updateSelectedColor('default-grid-color');
        currentNoteId = null;
        currentBaselineRecord = { id: null, content: '', color: 'default-grid-color' };
    }

    deleteNoteBtn.style.display = currentNoteId !== null ? 'inline-block' : 'none';
    copyNoteBtn.style.display = 'inline-block';
    downloadNoteBtn.style.display = 'inline-block';
    noteModal.style.display = "flex";
    fullscreenNote.focus();
}

function closeModalCleanly() {
    noteModal.style.display = "none";
    editorSessionId++;
    editorRevision++;
    currentNoteId = null;
    currentBaselineRecord = null;
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const color = option.getAttribute('data-color');
            updateSelectedColor(color);
            editorRevision++;
        });
    });
    updateSelectedColor('default-grid-color');
});

if (fullscreenNote) {
    fullscreenNote.addEventListener('input', () => {
        editorRevision++;
    });
}

async function performSave() {
    if (isSaveInProgress) return false;
    const saveSession = editorSessionId;
    const saveRev = editorRevision;
    const targetId = currentNoteId;
    const targetContent = fullscreenNote.value;
    const targetColor = document.querySelector('.color-option.selected')?.getAttribute('data-color') || 'default-grid-color';
    const baseline = currentBaselineRecord;

    if (!window.TabbypadStorage) {
        alert('儲存功能不可用，請重新整理頁面');
        return false;
    }

    isSaveInProgress = true;
    try {
        if (targetId !== null && targetId !== undefined) {
            const updated = await window.TabbypadStorage.updateNote(targetId, targetContent, {
                expectedRecord: baseline,
                color: targetColor
            });
            await loadNotesFromStorage();

            if (editorSessionId === saveSession && editorRevision === saveRev) {
                closeModalCleanly();
            } else if (editorSessionId === saveSession) {
                currentBaselineRecord = { ...updated };
            }
        } else {
            const created = await window.TabbypadStorage.createNote(targetContent, targetColor);
            await loadNotesFromStorage();

            if (editorSessionId === saveSession && editorRevision === saveRev) {
                closeModalCleanly();
            } else if (editorSessionId === saveSession) {
                currentNoteId = created.id;
                currentBaselineRecord = { ...created };
            }
        }
        return true;
    } catch (err) {
        console.error('Failed to save note:', err);
        const msg = err && err.message ? err.message : '';
        if (msg.includes('STALE')) {
            alert('此筆記已被其他視窗或分頁修改。目前編輯內容已保留，請檢查後另存。');
        } else if (msg.includes('NOTE_NOT_FOUND')) {
            alert('此筆記已被其他視窗或分頁刪除。目前編輯內容已保留，您可存為新項目。');
        } else {
            alert('儲存失敗，目前編輯內容已保留。');
        }
        return false;
    } finally {
        isSaveInProgress = false;
    }
}

saveNoteBtn.addEventListener('click', performSave);

closeModal.onclick = closeModalCleanly;
window.onclick = function(event) {
    if (event.target == noteModal) {
        closeModalCleanly();
    }
};
const fullscreenToggleBtn = document.getElementById('fullscreenToggleBtn');

fullscreenToggleBtn.addEventListener('click', () => {
    const modalContent = document.querySelector('.custom-modal-content');
    modalContent.classList.toggle('fullscreen');
    fullscreenNote.focus();
});

// Show the confirmation modal without animation
deleteNoteBtn.addEventListener('click', () => {
    $('#confirmDeleteModal').modal({ backdrop: 'static', keyboard: false });
    $('#confirmDeleteModal').modal('show');
});

// Handle confirmation of deletion
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    if (currentNoteId !== null && currentNoteId !== undefined) {
        const noteId = currentNoteId;

        if (!window.TabbypadStorage) {
            alert('刪除功能不可用');
            return;
        }

        try {
            await window.TabbypadStorage.deleteNote(noteId, {
                expectedRecord: currentBaselineRecord
            });
            closeModalCleanly();
            $('#confirmDeleteModal').modal('hide');
            await loadNotesFromStorage();
        } catch (err) {
            console.error('Error deleting note from IndexedDB:', err);
            alert('刪除失敗：此項目可能已在其他分頁被變更。');
            $('#confirmDeleteModal').modal('hide');
        }
    }
});

const searchInput = document.getElementById('searchInput');
const escToCancel = document.querySelector('.esc-to-cancel');

document.addEventListener('mousedown', function(e) {
  if (e.target instanceof Element && e.target.closest('.esc-to-cancel')) {
    searchInput.value = '';
    escToCancel.style.display = 'none';
    renderNotes();
  }
})

searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase();
    const filteredNotes = notes.filter(note => 
        note.content.toLowerCase().includes(searchTerm)
    );
    renderNotes(filteredNotes); // Pass the filtered notes to render function

    // show esc-to-cancel text when search input is focused
    if (searchInput.value !== '') {
        escToCancel.style.display = 'block';
    } else {
        escToCancel.style.display = 'none';
    }
});

// Close the modal when the Escape key is pressed
document.addEventListener('keydown', (event) => {
    if (event.key === "Escape") {
        if (!$('#confirmDeleteModal').is(':visible')) {
            if (noteModal.style.display === "flex") {
                closeModalCleanly();
            }
        }

        if (searchInput === document.activeElement) {
            searchInput.value = '';
            escToCancel.style.display = 'none';
            renderNotes();
        }
    }
});

// show esc-to-cancel text when search input is focused
searchInput.addEventListener('focus', () => {
    if (searchInput.value !== '') {
        escToCancel.style.display = 'block';
    }
});

searchInput.addEventListener('blur', () => {
    escToCancel.style.display = 'none';
});

// Sort toggle functionality
sortToggleBtn.addEventListener('click', () => {
    sortOrder = sortOrder === 'newest' ? 'oldest' : 'newest';
    updateSortButton();
    renderNotes();
});

function updateSortButton() {
    if (sortOrder === 'newest') {
        sortText.textContent = 'Newest';
        sortToggleBtn.classList.remove('descending');
        sortToggleBtn.title = 'Sort by oldest first';
    } else {
        sortText.textContent = 'Oldest';
        sortToggleBtn.classList.add('descending');
        sortToggleBtn.title = 'Sort by newest first';
    }
}

function getSortedNotes(notesToSort = notes) {
    return [...notesToSort].sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
}

// Modify renderNotes function to accept an optional parameter
function findNoteByTypedId(typedKey) {
    return notes.find(n => toTypedKey(n.id) === typedKey) || null;
}

function renderNotes(filteredNotes = null) {
    const notesToRender = filteredNotes !== null ? getSortedNotes(filteredNotes) : getSortedNotes();
    
    const existing = new Map();
    gridContainer.querySelectorAll('.grid-item').forEach(el => {
        if (el.dataset.typedId) existing.set(el.dataset.typedId, el);
    });

    const emptyState = gridContainer.querySelector('.empty-state');
    if (notesToRender.length === 0) {
        if (!emptyState) {
            const emptyStateDiv = document.createElement('div');
            emptyStateDiv.className = 'empty-state';
            emptyStateDiv.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p>No notes added yet</p>
                <p class="empty-state-subtitle">Click the + button to create your first note</p>
            `;
            gridContainer.appendChild(emptyStateDiv);
        }
        existing.forEach(el => el.remove());
        return;
    } else if (emptyState) {
        emptyState.remove();
    }

    function createNoteElement(note, index) {
        const noteDiv = document.createElement('div');
        noteDiv.className = `grid-item ${note.color || 'default-grid-color'}`;
        const typedKey = toTypedKey(note.id);
        noteDiv.dataset.typedId = typedKey;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'note-content';
        contentDiv.textContent = note.content;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'note-actions';

        const dateDiv = document.createElement('div');
        dateDiv.className = 'note-date';
        const hasValidDate = typeof note.created_at === 'string' && note.created_at && !Number.isNaN(new Date(note.created_at).getTime());
        const relativeTime = hasValidDate ? getRelativeTime(note.created_at) : 'Undated';
        const formattedDate = hasValidDate ? getFormattedDate(note.created_at) : 'Undated';
        dateDiv.textContent = relativeTime;
        dateDiv.title = formattedDate;

        const actionButtonsDiv = document.createElement('div');
        actionButtonsDiv.className = 'action-buttons';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-btn';
        copyBtn.title = 'Copy note';
        copyBtn.innerHTML = `
            <svg class="action-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            <svg class="checkmark-icon" style="display:none" width="20" height="20" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
        `;
        copyBtn.addEventListener('click', e => {
            e.stopPropagation();
            const current = findNoteByTypedId(typedKey) || note;
            navigator.clipboard.writeText(current.content).then(() => {
                copyBtn.classList.add('copied');
                setTimeout(() => copyBtn.classList.remove('copied'), 800);
            });
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'action-btn';
        downloadBtn.title = 'Download note';
        downloadBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
        `;
        downloadBtn.addEventListener('click', e => {
            e.stopPropagation();
            const current = findNoteByTypedId(typedKey) || note;
            const a = document.createElement('a');
            const file = new Blob([current.content], { type: 'text/plain' });
            a.href = URL.createObjectURL(file);
            const datePart = (typeof current.created_at === 'string' && current.created_at && !Number.isNaN(new Date(current.created_at).getTime()))
                ? new Date(current.created_at).toISOString().split('T')[0]
                : 'undated';
            a.download = `note-${encodeURIComponent(String(current.id))}-${datePart}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        });

        actionButtonsDiv.append(copyBtn, downloadBtn);
        actionsDiv.append(dateDiv, actionButtonsDiv);
        noteDiv.append(contentDiv, actionsDiv);

        contentDiv.addEventListener('click', () => {
            const current = findNoteByTypedId(typedKey) || note;
            openFullscreen(current);
        });

        return noteDiv;
    }

    const incomingKeys = new Set(notesToRender.map(n => toTypedKey(n.id)));
    existing.forEach((el, key) => {
        if (!incomingKeys.has(key)) el.remove();
    });

    notesToRender.forEach((note, index) => {
        const key = toTypedKey(note.id);
        let el = existing.get(key);

        if (!el) {
            el = createNoteElement(note, index);
        } else {
            el.className = `grid-item ${note.color || 'default-grid-color'}`;
            const contentEl = el.querySelector('.note-content');
            if (contentEl) contentEl.textContent = note.content;
            const dateEl = el.querySelector('.note-date');
            if (dateEl) {
                const hasValidDate = typeof note.created_at === 'string' && note.created_at && !Number.isNaN(new Date(note.created_at).getTime());
                dateEl.textContent = hasValidDate ? getRelativeTime(note.created_at) : 'Undated';
                dateEl.title = hasValidDate ? getFormattedDate(note.created_at) : 'Undated';
            }
        }

        const ref = gridContainer.children[index];
        if (ref !== el) {
            gridContainer.insertBefore(el, ref || null);
        }
    });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.querySelector('.toast-body').textContent = message;
    toast.style.display = 'block';

    setTimeout(() => {
        toast.style.display = 'none';
    }, 2000);
}

copyNoteBtn.addEventListener('click', () => {
    const noteContent = fullscreenNote.value;
    navigator.clipboard.writeText(noteContent).then(() => {
        // Add 'copied' class to show checkmark
        copyNoteBtn.classList.add('copied');
        
        // Remove the class after animation completes
        setTimeout(() => {
            copyNoteBtn.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
});

downloadNoteBtn.addEventListener('click', () => {
    const noteContent = fullscreenNote.value;
    const noteId = currentNoteId !== null ? currentNoteId : 'undated';
    const blob = new Blob([noteContent], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `note-${encodeURIComponent(String(noteId))}.txt`;
    link.click();
    URL.revokeObjectURL(link.href); 
});

downloadAllNotesBtn.addEventListener('click', async () => {
    downloadAllNotesBtn.disabled = true;
    try {
        const savedNotes = await window.TabbypadStorage.getAllNotes();
        if (savedNotes.length === 0) {
            showToast('No notes to download!');
            return;
        }

        const date = new Date();
        const folderName = `tabbypad-notes-bundle-${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
        const zip = new window.JSZip();
        const folder = zip.folder(folderName);
        savedNotes.forEach((note, index) => {
            folder.file(`note_${index + 1}.txt`, note.content);
        });

        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `${folderName}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
    } catch (err) {
        console.error('Failed to download notes:', err);
        showToast('Failed to download notes. Please try again.');
    } finally {
        downloadAllNotesBtn.disabled = false;
    }
});


let lastUsedColor = null;

function getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) {
        return seconds <= 1 ? 'just now' : `${seconds} secs ago`;
    }
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return minutes === 1 ? '1 min ago' : `${minutes} mins ago`;
    }
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
    
    const days = Math.floor(hours / 24);
    if (days < 30) {
        return days === 1 ? '1 day ago' : `${days} days ago`;
    }
    
    const months = Math.floor(days / 30);
    if (months < 12) {
        return months === 1 ? '1 month ago' : `${months} months ago`;
    }
    
    const years = Math.floor(months / 12);
    return years === 1 ? '1 year ago' : `${years} years ago`;
}

function getFormattedDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getRandomPastelColor() {
    const pastelColors = ['pastel-yellow', 'pastel-blue', 'pastel-green', 'pastel-pink', 'pastel-purple'];
    
    // If there's only one color, return it
    if (pastelColors.length === 1) return pastelColors[0];
    
    // Filter out the last used color
    const availableColors = pastelColors.filter(color => color !== lastUsedColor);
    
    // Select a random color from the remaining options
    const randomColor = availableColors[Math.floor(Math.random() * availableColors.length)];
    
    // Update the last used color
    lastUsedColor = randomColor;
    
    return randomColor;
}

function createNewNote() {
    openFullscreen(null);
}

document.onkeydown = function (event) {
    event = event || window.event;
    
    if (event.altKey && event.code === 'KeyN') {
        createNewNote();
        event.preventDefault();
    }
};


// Floating Add Note Button
document.getElementById('floatingAddBtn').addEventListener('click', () => {
    createNewNote();
});

// Initialize theme
initTheme();


// Initialize IndexedDB
initStorage();

// Initialize sort button
updateSortButton();

// Initial rendering of notes on page load
renderNotes();
window.TabbypadEditor = {
    hasUnsavedChanges() {
        const isModalOpen = (noteModal && noteModal.style.display === 'flex');
        if (!isModalOpen) return false;
        const currentContent = fullscreenNote ? fullscreenNote.value : '';
        const selectedColor = document.querySelector('.color-option.selected')?.getAttribute('data-color') || 'default-grid-color';
        if (currentBaselineRecord && currentBaselineRecord.id !== null) {
            return currentContent !== currentBaselineRecord.content || selectedColor !== currentBaselineRecord.color;
        }
        return currentContent.length > 0 || selectedColor !== 'default-grid-color';
    },
    getEditorState() {
        const isModalOpen = (noteModal && noteModal.style.display === 'flex');
        return {
            isOpen: isModalOpen,
            noteId: currentNoteId,
            isDirty: this.hasUnsavedChanges(),
            revision: editorRevision,
            sessionId: editorSessionId
        };
    },
    getEditorGuard() {
        const capturedSession = editorSessionId;
        const capturedRev = editorRevision;
        const wasModalOpen = (noteModal && noteModal.style.display === 'flex');
        return () => {
            const isModalOpen = (noteModal && noteModal.style.display === 'flex');
            if (!wasModalOpen && isModalOpen) return false;
            if (wasModalOpen && !isModalOpen) return false;
            if (editorSessionId !== capturedSession || editorRevision !== capturedRev) return false;
            if (isModalOpen && window.TabbypadEditor.hasUnsavedChanges()) return false;
            return true;
        };
    },
    closeEditorIfClean() {
        if (!this.hasUnsavedChanges()) {
            closeModalCleanly();
            return true;
        }
        return false;
    },
    saveCurrentNote() {
        return performSave();
    },
    reloadNotes() {
        return loadNotesFromStorage();
    }
};